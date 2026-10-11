import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	realpathSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHutchExecutable } from "../../../scripts/hutch-exe.mjs";

const trayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// A concrete release version: X.Y.Z with an optional pre-release segment
// (e.g. 0.7.2-canary.6). Rejects "latest", bare "0.7", path fragments, etc.
const COTTONTAIL_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// A capability name is joined as a single path segment under
// cottontail-stdlib, so it must stay a plain one-segment name: ASCII letters,
// digits, dots, underscores and dashes (starting alnum), 1-64 chars, no ".",
// ".." or embedded "..". Windows reserved device names (with or without an
// extension) and trailing dots/spaces resolve to device files or are mangled
// by the OS, so they are rejected on every platform: the check stays
// deterministic and fail-closed regardless of where the build runs.
const WINDOWS_RESERVED_DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function isValidCapabilityName(name) {
	if (typeof name !== "string" || name.length < 1 || name.length > 64) return false;
	if (name === "." || name === ".." || name.includes("..")) return false;
	if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) return false;
	if (WINDOWS_RESERVED_DEVICE_RE.test(name)) return false;
	if (name.endsWith(".") || name.endsWith(" ")) return false;
	return true;
}

/**
 * Defense in depth for the capability copy: after names are validated as
 * single segments, a resolved source/dest path must still sit inside its base
 * dir, or throw before anything is written. Unreachable for valid names; a
 * throw here means name validation was bypassed or broken.
 */
export function assertContainedPath(base, candidatePath) {
	const baseResolved = resolve(base);
	const prefix = baseResolved.endsWith(sep) ? baseResolved : baseResolved + sep;
	const candidate = resolve(candidatePath);
	if (!candidate.startsWith(prefix)) {
		throw new Error(
			`post-build: Cottontail runtime path ${candidate} escapes its base ${baseResolved}; capability paths must stay inside their base dir`,
		);
	}
	return candidate;
}

function canonicallyEqual(baseCanonical, entryCanonical) {
	if (process.platform === "win32") return baseCanonical.toLowerCase() === entryCanonical.toLowerCase();
	return baseCanonical === entryCanonical;
}

function canonicallyInside(baseCanonical, entryCanonical) {
	const prefix = baseCanonical.endsWith(sep) ? baseCanonical : baseCanonical + sep;
	if (process.platform === "win32") return entryCanonical.toLowerCase().startsWith(prefix.toLowerCase());
	return entryCanonical.startsWith(prefix);
}

/**
 * Canonical counterpart of assertContainedPath (SY-1): both paths must exist
 * and the candidate's resolved (realpath.native) location must sit inside
 * the base's resolved location, so an entry cannot claim a lexical path
 * inside the base while resolving to a different place (a symlinked or
 * junctioned chain resolves to its target). Case-insensitive on win32,
 * where file system paths are case-insensitive. The base itself counts as
 * contained (the destination root check passes for the staged bin dir).
 * Throw means a link or case mismatch put the entry outside the base.
 */
export function assertCanonicallyContained(base, candidatePath) {
	const baseCanonical = realpathSync.native(base);
	const candidateCanonical = realpathSync.native(candidatePath);
	if (!canonicallyEqual(baseCanonical, candidateCanonical) && !canonicallyInside(baseCanonical, candidateCanonical)) {
		throw new Error(
			`post-build: Cottontail runtime path ${candidatePath} resolves to ${candidateCanonical} outside its base ${baseCanonical}; capability paths must stay inside their base dir`,
		);
	}
	return candidateCanonical;
}

/**
 * Plan a source tree for the link-safe copy (SY-1): walk it with lstat
 * (never following a link), reject any symbolic link (including Windows
 * junctions) and any entry that is neither a regular file nor a directory,
 * and canonicalize every entry against the release bin base so a link
 * cannot claim a path inside the base while resolving outside it. Returns
 * the relative directories (to create) and files (to copy). No writes
 * happen here.
 */
function planSourceTree(root, baseDir) {
	const rootStat = lstatSync(root);
	if (rootStat.isSymbolicLink()) {
		throw new Error(
			`post-build: Cottontail runtime source ${root} is a symbolic link; refusing to copy through links into the staged runtime tree`,
		);
	}
	if (!rootStat.isDirectory()) {
		throw new Error(
			`post-build: Cottontail runtime source ${root} is not a directory; refusing to plan it as a core or capability tree`,
		);
	}
	assertCanonicallyContained(baseDir, root);
	const dirs = [];
	const files = [];
	const stack = [root];
	while (stack.length > 0) {
		const dir = stack.pop();
		for (const name of readdirSync(dir)) {
			const entry = join(dir, name);
			const entryStat = lstatSync(entry);
			if (entryStat.isSymbolicLink()) {
				throw new Error(
					`post-build: Cottontail runtime source ${entry} is a symbolic link; refusing to copy through links into the staged runtime tree`,
				);
			}
			if (entryStat.isDirectory()) {
				dirs.push(relative(root, entry).split(/[\\/]/).join("/"));
				assertCanonicallyContained(baseDir, entry);
				stack.push(entry);
			} else if (entryStat.isFile()) {
				files.push(relative(root, entry).split(/[\\/]/).join("/"));
				assertCanonicallyContained(baseDir, entry);
			} else {
				throw new Error(
					`post-build: Cottontail runtime source ${entry} is neither a regular file nor a directory; refusing to copy it`,
				);
			}
		}
	}
	return { dirs, files };
}

/**
 * Assert a planned destination path is safe to write (SY-1): it must resolve
 * lexically inside the staged bin dir (assertContainedPath); the path itself
 * must not be a pre-existing symbolic link (a write would go through it);
 * and every pre-existing directory on the way from the staged bin dir down
 * (including a pre-existing planned dir) must be a real (not a link)
 * directory that resolves canonically inside it. No writes happen here.
 * A pre-existing regular file at a planned file path is fine: the copy
 * replaces it and verification re-hashes the bytes.
 */
function assertPlannedDestinationSafe(stagedBin, destPath) {
	assertContainedPath(stagedBin, destPath);
	const stagedResolved = resolve(stagedBin);
	const destResolved = resolve(destPath);
	let destStat = null;
	try {
		destStat = lstatSync(destResolved);
	} catch (error) {
		if ((error instanceof Error) && error.code !== "ENOENT") throw error;
	}
	if (destStat !== null && destStat.isSymbolicLink()) {
		throw new Error(
			`post-build: staged Cottontail runtime path ${destResolved} is a symbolic link; refusing to write through or under it`,
		);
	}
	// Parent chain: from the deepest existing directory on the path (the dest
	// itself when it is an existing planned dir) up to the staged bin dir.
	const chain = [stagedResolved];
	for (let dir = dirname(destResolved); ; ) {
		if (dir === stagedResolved || !existsSync(dir)) break;
		chain.push(dir);
		const up = dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	for (const dir of chain) {
		const stat = lstatSync(dir);
		if (stat.isSymbolicLink() || !stat.isDirectory()) {
			throw new Error(
				`post-build: staged Cottontail runtime path ${dir} is ${stat.isSymbolicLink() ? "a symbolic link" : "not a plain directory"}; refusing to write through or under it`,
			);
		}
		assertCanonicallyContained(stagedResolved, dir);
	}
}

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
	// caught before any file is written. Every name is validated as a single
	// capability segment first (requested or transitive): a name is joined
	// under cottontail-stdlib below, so it must not be able to escape it, and
	// a malformed `requires` value (not an array of strings) is rejected here
	// as well. Capability dirs live next to the catalog file
	// capabilities.json on a case-insensitive file system (Windows, macOS):
	// a name that equals the catalog file name case-insensitively is
	// reserved (it would overwrite the catalog on copy), and two names that
	// are equal case-insensitively resolve to the same dir and collide.
	// The whole walk completes before copyTree / mkdirSync / copyFileSync
	// run, so a rejected name leaves the staged tree untouched.
	const visited = [];
	const visitedCase = new Map();
	const visit = (name, where) => {
		if (!isValidCapabilityName(name)) {
			throw new Error(
				`post-build: invalid Cottontail capability name ${JSON.stringify(name)} (Cottontail ${version}) in ${where}`,
			);
		}
		if (visited.includes(name)) return;
		const caseKey = String(name).toLowerCase();
		if (caseKey === "capabilities.json") {
			throw new Error(
				`post-build: reserved Cottontail capability name ${JSON.stringify(name)} (Cottontail ${version}) in ${where}: it equals the catalog file name capabilities.json case-insensitively and would collide with the catalog in the staged tree`,
			);
		}
		const firstOfCase = visitedCase.get(caseKey);
		if (firstOfCase !== undefined) {
			throw new Error(
				`post-build: Cottontail capability name ${JSON.stringify(name)} (Cottontail ${version}) in ${where} collides with the already-resolved capability ${JSON.stringify(firstOfCase)}: case-insensitively equal names resolve to the same directory in the release and staged trees`,
			);
		}
		visited.push(name);
		visitedCase.set(caseKey, name);
		if (!Object.prototype.hasOwnProperty.call(capabilityCatalog, name)) {
			throw new Error(
				`post-build: required Cottontail capability "${name}" (Cottontail ${version}) is not in the ${catalogSource} catalog`,
			);
		}
		const requires = capabilityCatalog[name]?.requires;
		if (requires !== undefined && !Array.isArray(requires)) {
			throw new Error(
				`post-build: invalid Cottontail capability name ${JSON.stringify(requires)} (Cottontail ${version}) in "${name}".requires of the ${catalogSource} catalog`,
			);
		}
		for (const dep of requires ?? []) visit(dep, `"${name}".requires of the ${catalogSource} catalog`);
	};
	for (const name of capabilities) visit(name, "the requested capabilities");

	// Plan the whole copy before any write (SY-1): every source tree that
	// will be copied is walked with lstat (links rejected, canonicalized
	// against the release bin base) and every planned destination path is
	// checked against the staged bin base. A rejected input throws before
	// mkdirSync / copyFileSync run, so the destination stays untouched.
	const stagedResolved = resolve(stagedBin);
	realpathSync.native(stagedResolved); // must exist (the staged runtime is there)
	const coreDest = join(stagedResolved, "cottontail-core");
	const corePlan = planSourceTree(coreSource, releaseBin);
	const capabilityPlans = [];
	for (const name of visited) {
		// Defense in depth: the validated name must still resolve inside its
		// base dir before anything is copied (unreachable for valid names).
		const source = assertContainedPath(stdlibSource, join(stdlibSource, name));
		if (!existsSync(source)) {
			throw new Error(`post-build: required Cottontail capability "${name}" missing from ${stdlibSource}`);
		}
		const dest = assertContainedPath(stdlibDest, join(stdlibDest, name));
		capabilityPlans.push({ name, source, dest, plan: planSourceTree(source, releaseBin) });
	}
	// The catalog file is copied as a single regular file: it must not be a
	// link and must resolve canonically inside the release bin.
	const catalogDest = join(stdlibDest, "capabilities.json");
	const catalogStat = lstatSync(catalogSource);
	if (catalogStat.isSymbolicLink()) {
		throw new Error(
			`post-build: Cottontail ${version} catalog ${catalogSource} is a symbolic link; refusing to copy through links into the staged runtime tree`,
		);
	}
	if (!catalogStat.isFile()) {
		throw new Error(
			`post-build: Cottontail ${version} catalog ${catalogSource} is not a regular file; refusing to copy it`,
		);
	}
	assertCanonicallyContained(releaseBin, catalogSource);
	// Every planned destination path (root, subdir and file) must resolve
	// lexically inside the staged bin, and every pre-existing directory on
	// the way down must be a real directory inside it canonically.
	assertPlannedDestinationSafe(stagedResolved, coreDest);
	assertPlannedDestinationSafe(stagedResolved, stdlibDest);
	for (const { plan, dest } of capabilityPlans) {
		assertPlannedDestinationSafe(stagedResolved, dest);
		for (const rel of plan.dirs) assertPlannedDestinationSafe(stagedResolved, join(dest, rel));
		for (const rel of plan.files) assertPlannedDestinationSafe(stagedResolved, join(dest, rel));
	}
	assertPlannedDestinationSafe(stagedResolved, catalogDest);

	// Copy phase: only the planned regular files are copied and only the
	// planned directories are created (the plan above already verified every
	// path on the way is a real directory inside the staged bin).
	const mkdirPlanned = (dir) => {
		if (!existsSync(dir)) mkdirSync(dir);
	};
	mkdirPlanned(coreDest);
	for (const rel of corePlan.dirs) mkdirPlanned(join(coreDest, rel));
	for (const rel of corePlan.files) copyFileSync(join(coreSource, rel), join(coreDest, rel));
	mkdirPlanned(stdlibDest);
	copyFileSync(catalogSource, catalogDest);
	for (const { name, source, dest, plan } of capabilityPlans) {
		mkdirPlanned(dest);
		for (const rel of plan.dirs) mkdirPlanned(join(dest, rel));
		for (const rel of plan.files) copyFileSync(join(source, rel), join(dest, rel));
	}
	const copied = ["cottontail-core/", "capabilities.json", ...capabilityPlans.map(({ name }) => name)];

	// Verify the copied bytes match the source before declaring success:
	// the relative file lists and the SHA-256 of every file must equal, and
	// the destination is re-walked with lstat, so a link planted in the
	// staged tree (or a file swapped after the copy) fails verification.
	verifyTreeEqual(coreSource, coreDest);
	if (sha256OfFile(catalogSource) !== sha256OfFile(catalogDest)) {
		throw new Error(
			`post-build: copied ${catalogDest} does not match ${catalogSource} (SHA-256 ${sha256OfFile(catalogDest)} != ${sha256OfFile(catalogSource)})`,
		);
	}
	for (const { source, dest } of capabilityPlans) {
		verifyTreeEqual(source, dest);
	}

	return `ok (synced Cottontail ${version}: ${copied.join(", ")})`;
}

/**
 * Resolve the cached Cottontail release bin dir through Hutch:
 * `hutch cottontail path <version>` prints the release executable; the
 * dirname of the trimmed last non-empty stdout line is the release `bin/`
 * (already platform-specific). The Hutch executable is spawned by absolute
 * path (SY-3): a bare `hutch` goes through libuv's search, which on Windows
 * looks in the working directory first, so a hutch.exe / hutch.cmd planted
 * in the cwd would run instead of the installed Hutch. The executable is
 * `deps.hutchExecutable` when injected (an absolute path string or a
 * resolver function, for tests); otherwise resolveHutchExecutable() resolves
 * it from absolute PATH entries only, and a resolver throw becomes the
 * existing "cannot resolve the Cottontail … release" error with the reason.
 * The default resolver uses `deps.spawnSync` so a test can inject a fake
 * process runner.
 */
export function resolveCottontailReleaseBin(version, deps = defaultDeps) {
	const spawn = deps.spawnSync ?? spawnSync;
	let hutchExe;
	try {
		const injected = deps.hutchExecutable;
		hutchExe = typeof injected === "function" ? injected() : injected ?? resolveHutchExecutable();
	} catch (error) {
		throw new Error(
			`post-build: cannot resolve the Cottontail ${version} release: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const args = ["cottontail", "path", version];
	const result = spawn(hutchExe, args, { encoding: "utf8", shell: false, windowsHide: true });
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
 * Compare a copied tree against its source: the destination relative file
 * list and the SHA-256 of every file must equal the source's. The
 * destination is re-walked with lstat, so a symbolic link planted in it
 * (or an entry that is neither a regular file nor a directory) fails the
 * verification, and a same-size byte swap fails the hash compare.
 * Mismatch -> throw.
 */
export function verifyTreeEqual(source, dest) {
	const sourceFiles = relativeFiles(source);
	const destFiles = relativeFilesNoLinks(dest);
	if (sourceFiles.length !== destFiles.length || sourceFiles.join("\0") !== destFiles.join("\0")) {
		throw new Error(`post-build: copied tree ${dest} does not match source ${source} (file list differs)`);
	}
	for (const rel of sourceFiles) {
		const sourceHash = sha256OfFile(join(source, rel));
		const destHash = sha256OfFile(join(dest, rel));
		if (sourceHash !== destHash) {
			throw new Error(
				`post-build: copied ${join(dest, rel)} does not match source ${join(source, rel)} (SHA-256 ${destHash} != ${sourceHash})`,
			);
		}
	}
}

function relativeFilesNoLinks(root) {
	const out = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			const stat = lstatSync(path);
			if (stat.isSymbolicLink()) {
				throw new Error(
					`post-build: ${path} in the copied tree is a symbolic link; verification of the staged runtime tree fails on links`,
				);
			}
			if (stat.isDirectory()) walk(path);
			else if (stat.isFile()) out.push(relative(root, path).split(/[\\/]/).join("/"));
			else {
				throw new Error(
					`post-build: ${path} in the copied tree is neither a regular file nor a directory; verification fails`,
				);
			}
		}
	};
	walk(root);
	return out.sort();
}

function sha256OfFile(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
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
