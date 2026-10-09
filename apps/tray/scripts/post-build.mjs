import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const trayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Hutch 0.25.0 + Electrobun 2.0.2+ do not ship the Cottontail 0.7.x runtime
 * layout: the staged app `bin/` gets only `cottontail(.exe)`, while the
 * Cottontail release also provides `bin/cottontail-core` (JSC host bootstrap)
 * and `bin/cottontail-stdlib` (capability modules). Without them the bundled
 * runtime exits with "failed to initialize the embedded JavaScriptCore
 * runtime" and the tray never runs its JavaScript.
 *
 * This runs in every post-build hook stage, but only acts at the stage where
 * the staged runtime executable is present:
 *   - Windows: <buildDir>/Pinar/bin/cottontail.exe (the pre-wrap app tree);
 *   - macOS:   <buildDir>/<App>.app/Contents/MacOS/cottontail.
 * After wrapping, the bin holds only the launcher stub and the function
 * returns a "skipped (...)" string instead.
 *
 * The exact Cottontail release is resolved through Hutch (`hutch cottontail
 * path <version>`, where `<version>` is `runtimeVersions.cottontail` from the
 * staged `Resources/build.json`); the command prints the cached release
 * executable and its dirname is the release `bin/`. Missing pieces fail the
 * build loudly instead of shipping a broken tray.
 */
function syncCottontailRuntime(buildDir) {
	if (!existsSync(buildDir)) return `skipped (build dir not found: ${buildDir})`;
	const stagedBin = findStagedCottontailBin(buildDir);
	if (!stagedBin) return `skipped (no staged Cottontail runtime executable in ${buildDir})`;
	// The staged Resources/ sits next to the bin dir (Pinar/Resources on
	// Windows, <App>.app/Contents/Resources on macOS).
	const buildJsonPath = join(dirname(stagedBin), "Resources", "build.json");
	if (!existsSync(buildJsonPath)) return `skipped (no ${buildJsonPath})`;
	let buildJson;
	try {
		buildJson = JSON.parse(readFileSync(buildJsonPath, "utf8"));
	} catch (error) {
		throw new Error(`post-build: cannot parse ${buildJsonPath}: ${error.message}`);
	}
	const version = buildJson?.runtimeVersions?.cottontail;
	if (!version) return `skipped (no runtimeVersions.cottontail in ${buildJsonPath})`;

	// Required capabilities come from build.cottontail.capabilities in
	// electrobun.config.ts (single source of truth, parsed, not duplicated).
	const configPath = join(trayRoot, "electrobun.config.ts");
	const configText = readFileSync(configPath, "utf8");
	const match = /capabilities:\s*\[([^\]]*)\]/u.exec(configText);
	const capabilities = match
		? match[1].split(",").map((entry) => entry.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
		: [];

	const releaseBin = resolveCottontailReleaseBin(version);
	const coreSource = join(releaseBin, "cottontail-core");
	if (!existsSync(coreSource)) {
		// 0.5.x releases predate the core/stdlib layout; nothing to sync there.
		return `ok (Cottontail ${version} ships no bin/cottontail-core; nothing to sync)`;
	}
	if (capabilities.length === 0) {
		throw new Error(
			`post-build: Cottontail ${version} ships bin/cottontail-core but ${configPath} declares no build.cottontail.capabilities; a 0.7.x runtime without capabilities would ship a tray that cannot load ffi`,
		);
	}
	const stdlibSource = join(releaseBin, "cottontail-stdlib");
	const stdlibDest = join(stagedBin, "cottontail-stdlib");
	const catalogSource = join(stdlibSource, "capabilities.json");
	if (!existsSync(catalogSource)) {
		throw new Error(`post-build: Cottontail ${version} release has bin/cottontail-core but no ${catalogSource}`);
	}

	const copied = [];
	copyTree(coreSource, join(stagedBin, "cottontail-core"));
	copied.push("cottontail-core/");
	mkdirSync(stdlibDest, { recursive: true });
	copyFileSync(catalogSource, join(stdlibDest, "capabilities.json"));
	copied.push("capabilities.json");
	const catalog = JSON.parse(readFileSync(catalogSource, "utf8")).capabilities ?? {};
	const needed = new Set();
	const visit = (name) => {
		if (needed.has(name)) return;
		needed.add(name);
		for (const dep of catalog[name]?.requires ?? []) visit(dep);
	};
	for (const name of capabilities) visit(name);
	for (const name of needed) {
		const source = join(stdlibSource, name);
		if (!existsSync(source)) {
			throw new Error(`post-build: required Cottontail capability "${name}" missing from ${stdlibSource}`);
		}
		copyTree(source, join(stdlibDest, name));
		copied.push(name);
	}
	return `ok (synced Cottontail ${version}: ${copied.join(", ")})`;
}

/**
 * Resolve the cached Cottontail release bin dir through Hutch:
 * `hutch cottontail path <version>` prints the release executable; the
 * dirname of the trimmed last non-empty stdout line is the release `bin/`
 * (already platform-specific).
 */
function resolveCottontailReleaseBin(version) {
	const args = ["cottontail", "path", version];
	const result = spawnSync("hutch", args, {
		encoding: "utf8",
		windowsHide: true,
	});
	const command = `hutch ${args.join(" ")}`;
	if (result.error || result.status !== 0) {
		throw new Error(
			`post-build: cannot resolve the Cottontail ${version} release: ${command} failed` +
				` (exit status ${result.status ?? "n/a"}${result.error ? `, spawn error: ${result.error.message}` : ""};` +
				` stderr: ${(result.stderr ?? "").trim() || "<empty>"})`,
		);
	}
	const stdout = (result.stdout ?? "").trim();
	const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const executable = lines.length > 0 ? lines[lines.length - 1] : "";
	const binDir = executable ? dirname(executable) : "";
	let binExists = false;
	try {
		binExists = statSync(binDir).isDirectory();
	} catch {
		binExists = false;
	}
	if (!executable || !binExists) {
		throw new Error(
			`post-build: cannot resolve the Cottontail ${version} release: ${command} did not yield an existing bin dir` +
				` (last non-empty stdout line: ${JSON.stringify(executable || "<none>")}, bin dir: ${JSON.stringify(binDir || "<n/a>")})`,
		);
	}
	return binDir;
}

/**
 * Locate the staged runtime executable per platform:
 *   - Windows: <buildDir>/Pinar/bin/cottontail.exe
 *   - macOS:   <buildDir>/<App>.app/Contents/MacOS/cottontail (the single
 *              *.app under buildDir)
 * Returns the bin dir, or null when the staged runtime is not present (e.g. a
 * post-wrap hook stage holding only the launcher stub).
 */
function findStagedCottontailBin(buildDir) {
	if (process.platform === "win32") {
		const bin = join(buildDir, "Pinar", "bin");
		return existsSync(join(bin, "cottontail.exe")) ? bin : null;
	}
	if (process.platform === "darwin") {
		let entries;
		try {
			entries = readdirSync(buildDir, { withFileTypes: true });
		} catch {
			return null;
		}
		const apps = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
		if (apps.length !== 1) return null;
		const macos = join(buildDir, apps[0].name, "Contents", "MacOS");
		return existsSync(join(macos, "cottontail")) ? macos : null;
	}
	return null;
}

function copyTree(source, dest) {
	const stat = statSync(source);
	if (stat.isDirectory()) {
		mkdirSync(dest, { recursive: true });
		for (const entry of readdirSync(source)) {
			copyTree(join(source, entry), join(dest, entry));
		}
		return;
	}
	mkdirSync(dirname(dest), { recursive: true });
	copyFileSync(source, dest);
}

if (process.platform === "darwin") {
  const buildDir = process.env.ELECTROBUN_BUILD_DIR ?? join(trayRoot, "build", "stable-macos-" + (process.arch === "arm64" ? "arm64" : "x64"));
  console.log(`post-build: cottontail runtime sync: ${syncCottontailRuntime(buildDir)}`);
  await import("./macos-agent-app.mjs");
}

if (process.platform === "win32") {
  const buildDir = process.env.ELECTROBUN_BUILD_DIR ?? join(trayRoot, "build", "stable-win-x64");
  console.log(`post-build: cottontail runtime sync: ${syncCottontailRuntime(buildDir)}`);
  const setup = join(trayRoot, "build", "stable-win-x64", "Pinar-Setup.exe");
  if (existsSync(setup)) {
    const artifacts = join(trayRoot, "artifacts");
    mkdirSync(artifacts, { recursive: true });
    copyFileSync(setup, join(artifacts, "win-x64-Pinar-Setup.exe"));
  }
}
