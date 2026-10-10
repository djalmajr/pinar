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

// A concrete release version: X.Y.Z with an optional pre-release segment
// (e.g. 0.7.2-canary.6). Rejects "latest", bare "0.7", path fragments, etc.
const COTTONTAIL_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// Default dependency injection: node's spawnSync and the real platform. Tests
// inject their own so no real Hutch / filesystem layout is touched.
export const defaultDeps = {
	platform: process.platform,
	configPath: join(trayRoot, "electrobun.config.ts"),
	resolveReleaseBin: resolveCottontailReleaseBin,
	spawnSync,
};

/**
 * Sync the Cottontail 0.7.x runtime layout into the staged app.
 *
 * Returns a "skipped (...)" string ONLY when there is nothing to sync here
 * (the legitimate wrapper / post-wrap no-op): the build dir is missing, or no
 * staged Cottontail runtime executable is present. Once a staged runtime IS
 * present, every missing/malformed piece throws and fails the build loudly
 * instead of shipping a tray whose JSC runtime cannot initialize.
 */
export function syncCottontailRuntime(buildDir, deps = defaultDeps) {
	const d = { ...defaultDeps, ...deps };
	const resolveReleaseBin =
		deps.resolveReleaseBin ?? ((version) => resolveCottontailReleaseBin(version, d));

	if (!existsSync(buildDir)) return `skipped (build dir not found: ${buildDir})`;
	const stagedBin = findStagedCottontailBin(buildDir, d);
	if (!stagedBin) return `skipped (no staged Cottontail runtime executable in ${buildDir})`;
	// The staged Resources/ sits next to the bin dir (Pinar/Resources on
	// Windows, <App>.app/Contents/Resources on macOS).
	const buildJsonPath = join(dirname(stagedBin), "Resources", "build.json");
	if (!existsSync(buildJsonPath)) {
		throw new Error(
			`post-build: staged Cottontail runtime at ${stagedBin} has no ${buildJsonPath}; missing runtime metadata next to a staged runtime is an error, not a skip`,
		);
	}
	let buildJson;
	try {
		buildJson = JSON.parse(readFileSync(buildJsonPath, "utf8"));
	} catch (error) {
		throw new Error(`post-build: cannot parse ${buildJsonPath}: ${error.message}`);
	}
	const version = buildJson?.runtimeVersions?.cottontail;
	if (typeof version !== "string" || !COTTONTAIL_VERSION_RE.test(version)) {
		throw new Error(
			`post-build: staged Cottontail runtime at ${stagedBin} has no valid runtimeVersions.cottontail in ${buildJsonPath} (got ${JSON.stringify(version ?? null)}; expected a release such as 0.7.2-canary.6)`,
		);
	}

	// Required capabilities come from build.cottontail.capabilities in
	// electrobun.config.ts (single source of truth, parsed, not duplicated).
	const configText = readFileSync(d.configPath, "utf8");
	const capabilities = readRequiredCapabilities(configText);

	const releaseBin = resolveReleaseBin(version);
	const coreSource = join(releaseBin, "cottontail-core");
	// Every supported runtime ships the core/stdlib layout (pin: Electrobun
	// 2.0.3-beta.11 -> Cottontail 0.7.2-canary.6). No supported configuration
	// stages a pre-core 0.5.x runtime here, so a release without
	// bin/cottontail-core is a cache/staging miss, not a legitimate older
	// release: fail the build loudly for EVERY version.
	if (!existsSync(coreSource) || !statSync(coreSource).isDirectory()) {
		throw new Error(
			`post-build: Cottontail ${version} release has no ${coreSource}; a 0.7.x tray without the JSC core cannot run its JavaScript`,
		);
	}
	if (readdirSync(coreSource).length === 0) {
		throw new Error(`post-build: Cottontail ${version} release ${coreSource} is empty`);
	}
	if (capabilities.length === 0) {
		throw new Error(
			`post-build: Cottontail ${version} ships bin/cottontail-core but ${d.configPath} declares no build.cottontail.capabilities; a 0.7.x runtime without capabilities would ship a tray that cannot load ffi`,
		);
	}
	const stdlibSource = join(releaseBin, "cottontail-stdlib");
	const stdlibDest = join(stagedBin, "cottontail-stdlib");
	const catalogSource = join(stdlibSource, "capabilities.json");
	if (!existsSync(catalogSource)) {
		throw new Error(`post-build: Cottontail ${version} release has bin/cottontail-core but no ${catalogSource}`);
	}
	let catalog;
	try {
		catalog = JSON.parse(readFileSync(catalogSource, "utf8"));
	} catch (error) {
		throw new Error(`post-build: cannot parse ${catalogSource}: ${error.message}`);
	}
	const capabilityCatalog = catalog?.capabilities;
	if (typeof capabilityCatalog !== "object" || capabilityCatalog === null) {
		throw new Error(`post-build: ${catalogSource} has no "capabilities" object`);
	}

	// Resolve the requested capabilities plus their transitive `requires` in
	// visit order (requested order, then transitive) before copying, so a
	// capability that is absent from the catalog (requested or transitive) is
	// caught before any file is written.
	const visited = [];
	const visit = (name) => {
		if (visited.includes(name)) return;
		visited.push(name);
		if (!Object.prototype.hasOwnProperty.call(capabilityCatalog, name)) {
			throw new Error(
				`post-build: required Cottontail capability "${name}" (Cottontail ${version}) is not in the ${catalogSource} catalog`,
			);
		}
		for (const dep of capabilityCatalog[name]?.requires ?? []) visit(dep);
	};
	for (const name of capabilities) visit(name);

	const copied = [];
	copyTree(coreSource, join(stagedBin, "cottontail-core"));
	copied.push("cottontail-core/");
	mkdirSync(stdlibDest, { recursive: true });
	copyFileSync(catalogSource, join(stdlibDest, "capabilities.json"));
	copied.push("capabilities.json");
	for (const name of visited) {
		const source = join(stdlibSource, name);
		if (!existsSync(source)) {
			throw new Error(`post-build: required Cottontail capability "${name}" missing from ${stdlibSource}`);
		}
		copyTree(source, join(stdlibDest, name));
		copied.push(name);
	}

	// Verify the copied bytes match the source before declaring success.
	verifyTreeEqual(coreSource, join(stagedBin, "cottontail-core"));
	const catalogDest = join(stdlibDest, "capabilities.json");
	if (readFileSync(catalogSource).compare(readFileSync(catalogDest)) !== 0) {
		throw new Error(`post-build: copied ${catalogDest} does not match ${catalogSource}`);
	}
	for (const name of visited) {
		verifyTreeEqual(join(stdlibSource, name), join(stdlibDest, name));
	}

	return `ok (synced Cottontail ${version}: ${copied.join(", ")})`;
}

/**
 * Resolve the cached Cottontail release bin dir through Hutch:
 * `hutch cottontail path <version>` prints the release executable; the
 * dirname of the trimmed last non-empty stdout line is the release `bin/`
 * (already platform-specific). The default resolver uses `deps.spawnSync` so
 * a test can inject a fake process runner.
 */
export function resolveCottontailReleaseBin(version, deps = defaultDeps) {
	const spawn = deps.spawnSync ?? spawnSync;
	const args = ["cottontail", "path", version];
	const result = spawn("hutch", args, { encoding: "utf8", windowsHide: true });
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
 * Parse `capabilities: [ ... ]` from the Electrobun config source. Returns the
 * capability names (strings in single or double quotes), duplicates removed
 * preserving first order, or `[]` when the block is absent.
 */
export function readRequiredCapabilities(configText) {
	const match = /capabilities:\s*\[([^\]]*)\]/u.exec(configText);
	if (!match) return [];
	const seen = new Set();
	const out = [];
	for (const entry of match[1].split(",")) {
		const name = entry.trim().replace(/^["']|["']$/g, "");
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}

/**
 * Locate the staged runtime executable per platform:
 *   - Windows: <buildDir>/Pinar/bin/cottontail.exe
 *   - macOS:   <buildDir>/<App>.app/Contents/MacOS/cottontail (the only
 *              *.app holding one; two such bundles throw as ambiguous)
 * Returns the bin dir, or null when the staged runtime is not present (e.g. a
 * post-wrap hook stage holding only the launcher stub).
 */
export function findStagedCottontailBin(buildDir, deps = defaultDeps) {
	const platform = deps.platform ?? process.platform;
	if (platform === "win32") {
		const bin = join(buildDir, "Pinar", "bin");
		return existsSync(join(bin, "cottontail.exe")) ? bin : null;
	}
	if (platform === "darwin") {
		let entries;
		try {
			entries = readdirSync(buildDir, { withFileTypes: true });
		} catch {
			return null;
		}
		const staged = entries
			.filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
			.map((entry) => join(buildDir, entry.name, "Contents", "MacOS"))
			.filter((macos) => existsSync(join(macos, "cottontail")));
		// Two staged runtimes are ambiguous: fail loudly instead of skipping.
		if (staged.length > 1) {
			throw new Error(`post-build: more than one staged Cottontail runtime in ${buildDir}: ${staged.join(", ")}`);
		}
		return staged[0] ?? null;
	}
	return null;
}

export function copyTree(source, dest) {
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

/**
 * Compare a copied tree against its source: the destination relative file list
 * and each file's byte size must equal the source's. Mismatch -> throw.
 */
function verifyTreeEqual(source, dest) {
	const sourceFiles = relativeFiles(source);
	const destFiles = relativeFiles(dest);
	if (sourceFiles.length !== destFiles.length || sourceFiles.join("\0") !== destFiles.join("\0")) {
		throw new Error(`post-build: copied tree ${dest} does not match source ${source} (file list differs)`);
	}
	for (const rel of sourceFiles) {
		const sourceSize = statSync(join(source, rel)).size;
		const destSize = statSync(join(dest, rel)).size;
		if (sourceSize !== destSize) {
			throw new Error(
				`post-build: copied ${join(dest, rel)} has size ${destSize} but source ${join(source, rel)} has ${sourceSize}`,
			);
		}
	}
}

function relativeFiles(root) {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else out.push(path.slice(root.length + 1).split(/[\\/]/).join("/"));
		}
	};
	walk(root);
	return out.sort();
}
