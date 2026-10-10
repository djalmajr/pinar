#!/usr/bin/env bun
/**
 * Tray startup smoke — proves a built Pinar tray actually starts and EXECUTES
 * its JavaScript on the current platform.
 *
 * A low memory footprint or an idle process is never proof of JS execution.
 * The marker is a fresh `tray.pid` (mtime at or after the launch) in
 * `$PINAR_HOME/tray.pid` whose content is a live PID that belongs to the
 * process tree this script launched, plus a healthy local helper on the
 * pinned port. The script refuses to launch when the pinned port is already
 * in use by ANY process (not only a healthy pinar), and it never kills a
 * PID it did not start: the tray PID and the helper on the port are only
 * terminated when they are inside the launched process tree or their image
 * lies inside the launched build dir.
 *
 * Usage:
 *   bun scripts/tray-smoke.mjs [--app-dir <dir>] [--port <n>]
 *                              [--timeout-ms <n>] [--log <file>] [--keep-home]
 *
 * The launcher runs in a throwaway sandbox: PINAR_HOME, HOME, USERPROFILE
 * (and LOCALAPPDATA/APPDATA on Windows) all point inside the sandbox, and
 * `$PINAR_HOME/desktop.json` is pre-seeded with login disabled so the tray
 * never writes the HKCU Run key or a LaunchAgent. `PINAR_PORT` pins the
 * helper to the smoke port, which must be free before the launch.
 *
 * The win32 and darwin build dirs are Electrobun self-extracting wrappers
 * (the wrapper `launcher` installs the real app OVER the build-dir bundle
 * and relaunches it through the OS, so the tray would parent to launchd / the
 * init process and the smoke would always fail with "outside the launched
 * process tree" while silently rewriting the build artifact). The script
 * detects the wrapper payload (win32: `Pinar/Resources/<hash>.tar.zst` next
 * to the launcher stub; darwin: `Pinar.app/Contents/Resources/<hash>.tar.zst`
 * with the stub `Contents/MacOS/launcher` and no `Contents/Resources/app`)
 * with a fail-closed predicate (two or more payloads throw), decompresses it
 * in-process (Bun.zstdDecompressSync, 2 GiB cap — no `zstd` binary, no bsdtar
 * zstd assumption), validates the plain tar (absolute/drive names, `..`
 * segments, unsupported entry types, escaping symlinks, bad checksums,
 * truncation) before ANY byte is written, and extracts it into this run's
 * sandbox (`<sandbox>/extracted`) with the platform tar. The inner launcher
 * is spawned directly (never the wrapper launcher, never `open`); on darwin
 * the extracted payload must not itself be wrapper-shaped. Detection or
 * extraction failures fail closed BEFORE the spawn: nothing is spawned,
 * nothing is killed, the sandbox is removed (or kept with --keep-home).
 *
 * A fresh live tray PID that is outside the launched tree additionally
 * reports `trayAncestry` (the PID chain upward via the same parent probe,
 * at most 8 hops, stopping at null/0/1/a repeat) in the final JSON: a
 * diagnostic that never changes decide(), jsExecuted, ok, or the cleanup
 * kills.
 *
 * Cleanup ownership: a PID is only killed when this run actually spawned
 * the launcher (the pinned port was verified free right before the spawn)
 * AND the PID is inside the launched process tree or its image lies inside
 * the CANONICAL launch dir. A refused pre-busy-port launch or any
 * pre-spawn failure kills nothing. Containment is decided on canonical
 * paths (`realpathSync.native`, which resolves symlinks/junctions and
 * expands 8.3 short names to the long form on Windows), so a short
 * TEMP (C:\Users\RUNNER~1\...) and a long-form Win32_Process
 * ExecutablePath of the same tree compare equal. Every kill refusal and
 * cleanup error is reported instead of throwing.
 *
 * Exit 0 only when the startup succeeded AND the cleanup left no residue
 * (killed pids gone, pinned port free, sandbox removed or retained on
 * purpose). stdout always ends with exactly one JSON line:
 *   { ok, platform, appDir, launchDir, launcher, launcherPid, port,
 *     jsExecuted, trayPid, health, elapsedMs, reason,
 *     cleanup: { ok, killed, refused, errors, sandboxRemoved },
 *     sandbox?, sandboxRetained, trayAncestry? }
 */
import { spawn, spawnSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PORT = 17390;
export const DEFAULT_TIMEOUT_MS = 90_000;
export const DEFAULT_POLL_MS = 1_000;

/** Hard cap on a wrapper payload's decompressed plain-tar size (2 GiB). */
export const MAX_WRAPPER_DECOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

/** Hard cap on the number of entries a wrapper payload's plain tar may hold. */
export const MAX_WRAPPER_ENTRIES = 200_000;

/** Pre-seeded desktop prefs: login already configured and disabled, so the
 * tray never adds the HKCU Run key / LaunchAgent. */
export const DESKTOP_PREFS = { loginConfigured: true, loginEnabled: false };

/** Parse the CLI arguments. Throws on unknown flags or invalid values. */
export function parseArgs(argv) {
	const args = {
		appDir: null,
		port: DEFAULT_PORT,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		log: null,
		keepHome: false,
		help: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const flag = argv[i];
		const value = () => {
			const next = argv[i + 1];
			if (next == null || next.startsWith("--")) {
				throw new Error(`missing value for ${flag}`);
			}
			i += 1;
			return next;
		};
		switch (flag) {
			case "--app-dir":
				args.appDir = value();
				break;
			case "--port":
				args.port = parsePort(value());
				break;
			case "--timeout-ms": {
				const raw = value();
				const ms = Number(raw);
				if (!Number.isInteger(ms) || ms < 1_000) {
					throw new Error(`--timeout-ms must be an integer >= 1000 (got ${raw})`);
				}
				args.timeoutMs = ms;
				break;
			}
			case "--log":
				args.log = value();
				break;
			case "--keep-home":
				args.keepHome = true;
				break;
			case "--help":
			case "-h":
				args.help = true;
				break;
			default:
				throw new Error(`unknown argument ${flag}`);
		}
	}
	return args;
}

/** Strict port: digits only, 1-65535. */
export function parsePort(raw) {
	if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
		throw new Error(`invalid port: ${String(raw)}`);
	}
	const port = Number(raw);
	if (port < 1 || port > 65535) {
		throw new Error(`port out of range 1-65535: ${raw}`);
	}
	return port;
}

/** Health body is healthy only when ok === true AND service === "pinar". */
export function isHealthyHealth(body) {
	return body != null && typeof body === "object" && body.ok === true && body.service === "pinar";
}

/**
 * Success/failure decision from the observed facts:
 *  - freshPidFile: tray.pid exists with an mtime at/after the launch
 *  - pidAlive:     the PID written in tray.pid is a live process
 *  - inTree:       that PID is inside the process tree we launched
 *  - healthOk:     GET /api/health on the pinned port says ok/pinar
 * JS execution is proven only by freshPidFile && pidAlive && inTree; success
 * additionally requires the helper health.
 */
export function decide({ freshPidFile, pidAlive, inTree, healthOk, timeoutMs = DEFAULT_TIMEOUT_MS, trayPid = null }) {
	if (!freshPidFile) {
		return { jsExecuted: false, ok: false, reason: `no tray.pid after ${timeoutMs}ms` };
	}
	if (!pidAlive) {
		return { jsExecuted: false, ok: false, reason: `tray.pid pid ${trayPid} is not alive` };
	}
	if (!inTree) {
		return {
			jsExecuted: false,
			ok: false,
			reason: `tray.pid pid ${trayPid} is outside the launched process tree`,
		};
	}
	if (!healthOk) {
		return { jsExecuted: true, ok: false, reason: "health not ok on the pinned port" };
	}
	return { jsExecuted: true, ok: true, reason: null };
}

/**
 * Launcher executable candidates for a tray build directory, by platform.
 * `resolveLauncher` returns the first that exists (or null).
 */
export function launcherCandidates(appDir, platform = process.platform) {
	const root = appDir;
	if (platform === "win32") {
		return [
			join(root, "bin", "launcher.exe"),
			join(root, "Pinar", "bin", "launcher.exe"),
			join(root, "app", "bin", "launcher.exe"),
			join(root, "launcher.exe"),
			join(root, "Pinar", "launcher.exe"),
			join(root, "app", "launcher.exe"),
			join(root, "Pinar.exe"),
			join(root, "app", "Pinar.exe"),
			join(root, "bin", "cottontail.exe"),
			join(root, "Pinar", "bin", "cottontail.exe"),
			join(root, "app", "bin", "cottontail.exe"),
		];
	}
	if (platform === "darwin") {
		// Electrobun mac build layout: stable-macos-<arch>/Pinar.app with the
		// main executable under Contents/MacOS/ (a "launcher" binary, with the
		// product-named executable as fallback).
		return [
			join(root, "Pinar.app", "Contents", "MacOS", "launcher"),
			join(root, "Pinar.app", "Contents", "MacOS", "Pinar"),
			join(root, "app", "Pinar.app", "Contents", "MacOS", "launcher"),
			join(root, "app", "Pinar.app", "Contents", "MacOS", "Pinar"),
		];
	}
	return [
		join(root, "Pinar"),
		join(root, "app", "Pinar"),
		join(root, "Pinar-dev"),
		join(root, "app", "Pinar-dev"),
	];
}

export function resolveLauncher(appDir, platform = process.platform) {
	return launcherCandidates(appDir, platform).find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * The Windows build dir holds a self-extracting wrapper (`Pinar/` with a
 * launcher.exe stub and the real app in `Resources/<hash>.tar.zst`). Return
 * the payload tar when `appDir` is (or contains) such a wrapper, else null.
 * A wrapper with TWO OR MORE payloads is ambiguous and fails closed (throw).
 */
export function wrapperPayloadTarZst(appDir) {
	const appRoots = [
		join(appDir, "Pinar"),
		appDir,
	];
	for (const appRoot of appRoots) {
		const hasStub = existsSync(join(appRoot, "bin", "launcher.exe"));
		const hasRuntime = existsSync(join(appRoot, "bin", "cottontail.exe"));
		if (!hasStub || hasRuntime) continue;
		const resources = join(appRoot, "Resources");
		let entries = [];
		try {
			entries = readdirSync(resources);
		} catch {
			continue;
		}
		const payloads = entries.filter((entry) => entry.endsWith(".tar.zst"));
		if (payloads.length === 0) continue;
		if (payloads.length > 1) {
			throw new Error(`ambiguous wrapper payload: ${payloads.length} .tar.zst in ${resources} (${payloads.join(", ")})`);
		}
		return join(resources, payloads[0]);
	}
	return null;
}

/**
 * The macOS build dir holds a self-extracting wrapper: a `Pinar.app` whose
 * `Contents/MacOS/launcher` is the Electrobun extractor stub and the real
 * app lives in `Contents/Resources/<hash>.tar.zst`. For each candidate
 * bundle (`<appDir>/Pinar.app`, and `appDir` itself when it IS a `.app`
 * bundle) a bundle is a wrapper iff the stub launcher exists, `Contents/
 * Resources/app` does NOT (an extracted app), and `Contents/Resources` holds
 * `.tar.zst` files. Exactly one payload → its path; two or more → throw
 * (ambiguous; fail closed); not a wrapper → null.
 */
export function darwinWrapperPayloadTarZst(appDir) {
	const bundles = [join(appDir, "Pinar.app")];
	if (basename(appDir).endsWith(".app")) bundles.push(appDir);
	for (const bundle of bundles) {
		if (!existsSync(join(bundle, "Contents", "MacOS", "launcher"))) continue;
		if (existsSync(join(bundle, "Contents", "Resources", "app"))) continue;
		const resources = join(bundle, "Contents", "Resources");
		let entries = [];
		try {
			entries = readdirSync(resources);
		} catch {
			continue;
		}
		const payloads = entries.filter((entry) => entry.endsWith(".tar.zst"));
		if (payloads.length === 0) continue;
		if (payloads.length > 1) {
			throw new Error(`ambiguous wrapper payload: ${payloads.length} .tar.zst in ${resources} (${payloads.join(", ")})`);
		}
		return join(resources, payloads[0]);
	}
	return null;
}

/* ---------------- wrapper payload extraction (fail closed) --------------- */

/** The tar used to extract a validated plain tar, by platform: win32 prefers
 * the System32 bsdtar, darwin the stock /usr/bin/tar (its zstd support is NOT
 * assumed — the payload is decompressed in-process first), others `tar`.
 * `options.tarCommand` (tests only) overrides the choice. */
function tarCommandFor(platform) {
	if (platform === "win32") {
		const exe = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
		return existsSync(exe) ? exe : "tar";
	}
	if (platform === "darwin") return existsSync("/usr/bin/tar") ? "/usr/bin/tar" : "tar";
	return "tar";
}

/** Decode a NUL-terminated field of a 512-byte tar header; non-zero bytes
 * after the terminator mean a malformed header (throw). */
function tarField(block, start, length, label) {
	let end = start;
	while (end < start + length && block[end] !== 0) end += 1;
	const text = block.subarray(start, end).toString("latin1");
	if (block.subarray(end + 1, start + length).some((byte) => byte !== 0)) {
		throw new Error(`${label}: stray non-NUL bytes after the field terminator`);
	}
	return text;
}

/** Parse an octal tar header field (space/NUL padded). */
function tarOctalField(block, start, length, label) {
	const text = block.subarray(start, start + length).toString("latin1");
	const match = text.match(/^[0-7]+/);
	if (match == null) throw new Error(`${label}: not an octal field: ${JSON.stringify(text)}`);
	const rest = text.slice(match[0].length);
	if (rest.replace(/[\0 ]/g, "") !== "") {
		throw new Error(`${label}: malformed octal field: ${JSON.stringify(text)}`);
	}
	const value = parseInt(match[0], 8);
	if (!Number.isSafeInteger(value)) throw new Error(`${label}: octal field out of range: ${JSON.stringify(text)}`);
	return value;
}

/**
 * Every path check a tar entry name (and a symlink target) must pass
 * before any of its bytes may be written: no NUL/empty names, no `\` or `:`
 * (absolute `\\x` and drive `C:…` names included), no absolute names, no
 * `..` segment.
 */
function assertSafeTarName(name, label) {
	if (name === "") throw new Error(`${label}: empty entry name`);
	if (name.includes("\0")) throw new Error(`${label}: NUL in entry name`);
	if (name.includes("\\")) throw new Error(`${label}: backslash in entry name: ${name}`);
	if (name.includes(":")) throw new Error(`${label}: colon in entry name: ${name}`);
	if (name.startsWith("/") || name.startsWith("\\")) {
		throw new Error(`${label}: absolute entry name: ${name}`);
	}
	if (/^[A-Za-z]:/.test(name)) throw new Error(`${label}: drive-qualified entry name: ${name}`);
	for (const segment of name.split("/")) {
		if (segment === "..") throw new Error(`${label}: ".." segment in entry name: ${name}`);
	}
}

/**
 * Validate a plain (uncompressed) ustar archive BEFORE any of its bytes are
 * written to the destination. Rejects (throw, naming the offending entry):
 * absolute names, any `..` segment, names containing `\` or `:`, NUL/empty
 * names, entry types other than regular file (`0`/NUL), directory (`5`) and
 * symlink (`2`) — so hardlinks (`1`), fifos, devices, pax headers (`x`,`g`)
 * and GNU long name/link (`L`,`K`) entries are rejected — a symlink whose
 * target fails the same name checks (absolute, `..` segment, `\`, `:`), so
 * it cannot point outside the archive root, a bad header checksum and a
 * truncated archive,
 * and more than MAX_WRAPPER_ENTRIES entries. The ustar `prefix` field is
 * joined with the name (`prefix + "/" + name`) when the magic at 257 is
 * `ustar`, and the joined name goes through every path check as one path.
 */
export function validatePlainTar(input) {
	const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
	if (bytes.length === 0) throw new Error("truncated tar archive: empty input");
	if (bytes.length % 512 !== 0) {
		throw new Error(`truncated tar archive: ${bytes.length} bytes is not a multiple of 512`);
	}
	let offset = 0;
	let entryCount = 0;
	let terminatorSeen = false;
	while (offset < bytes.length) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) {
			// The standard end is two zero blocks; extra padding is fine.
			terminatorSeen = true;
			offset += 512;
			continue;
		}
		if (terminatorSeen) {
			throw new Error(`tar entry ${entryCount + 1}: data after the terminator block`);
		}
		entryCount += 1;
		if (entryCount > MAX_WRAPPER_ENTRIES) {
			throw new Error(`tar archive has more than ${MAX_WRAPPER_ENTRIES} entries`);
		}
		const label = `tar entry ${entryCount}`;
		let name = tarField(header, 0, 100, `${label}: name`);
		const prefix = tarField(header, 345, 155, `${label}: prefix`);
		const magic = header.subarray(257, 262).toString("latin1");
		const linkname = tarField(header, 157, 100, `${label}: linkname`);
		const typeflag = header[156];
		// Header checksum: sum of the 512 bytes with the chksum field (148–155)
		// treated as spaces (0x20).
		let sum = 0;
		for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 0x20 : header[i];
		if (tarOctalField(header, 148, 8, `${label}: chksum`) !== sum) {
			throw new Error(`${label}: bad header checksum`);
		}
		if (typeflag !== 0x00 && typeflag !== 0x30 && typeflag !== 0x35 && typeflag !== 0x32) {
			throw new Error(
				`${label} (${name || "unnamed"}): unsupported tar entry type ${typeflag === 0 ? "NUL" : JSON.stringify(String.fromCharCode(typeflag))} (only regular file, directory and symlink entries are allowed)`,
			);
		}
		if (prefix !== "" && magic.startsWith("ustar")) name = `${prefix}/${name}`;
		assertSafeTarName(name, label);
		// A symlink target gets the same checks as a name: no absolute target
		// and no `..` segment, so it can never resolve outside the archive root.
		if (typeflag === 0x32) assertSafeTarName(linkname, `${label}: symlink target`);
		const size = tarOctalField(header, 124, 12, `${label}: size`);
		const dataEnd = offset + 512 + Math.ceil(size / 512) * 512;
		if (dataEnd > bytes.length) {
			throw new Error(
				`${label} (${name}): truncated archive (size ${size} needs ${dataEnd - offset} bytes, ${bytes.length - offset} remain)`,
			);
		}
		offset = dataEnd;
	}
	return entryCount;
}

/**
 * Post-extraction containment check: walk `destDir` (lstat) and require
 * every entry to canonically live inside the canonical `destDir`; a symlink
 * whose resolved (or, when broken, lexical) target escapes throws.
 */
function postCheckExtraction(destDir) {
	let root;
	try {
		root = realpathSync.native(destDir);
	} catch (error) {
		throw new Error(`post-extraction check: cannot canonicalize ${destDir}: ${errorText(error)}`);
	}
	const win = process.platform === "win32";
	const p = win ? path.win32 : path.posix;
	const canon = (value) => (win ? value.replace(/\//g, "\\").toLowerCase() : value);
	const inside = (value) => {
		const rel = p.relative(canon(root), canon(value));
		return rel === "" || (rel !== ".." && !rel.startsWith(".." + p.sep) && !p.isAbsolute(rel));
	};
	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch (error) {
			throw new Error(`post-extraction check: cannot read ${dir}: ${errorText(error)}`);
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			let resolved;
			try {
				resolved = realpathSync.native(full);
			} catch (error) {
				if (!entry.isSymbolicLink()) {
					throw new Error(`post-extraction check: cannot canonicalize ${full}: ${errorText(error)}`);
				}
				// Broken symlink: resolve the target lexically; a relative
				// target must still stay inside destDir.
				let target;
				try {
					target = readlinkSync(full);
				} catch (readError) {
					throw new Error(`post-extraction check: cannot read symlink ${full}: ${errorText(readError)}`);
				}
				const lexical = path.resolve(dirname(full), target);
				if (!inside(lexical)) {
					throw new Error(`post-extraction check: symlink ${full} points outside ${destDir} (target ${target})`);
				}
				continue;
			}
			if (!inside(resolved)) {
				throw new Error(`post-extraction check: entry ${full} resolves outside ${destDir} (${resolved})`);
			}
			if (entry.isDirectory()) walk(resolved);
		}
	};
	walk(root);
}

/**
 * Materialize a wrapper payload (a `Resources/<hash>.tar.zst`) into
 * `destDir` without ever trusting its bytes: decompress in-process with
 * Bun.zstdDecompressSync (no `zstd` binary, no bsdtar zstd assumption), cap
 * the decompressed size at 2 GiB, validate the plain tar headers BEFORE
 * anything is written (see validatePlainTar), write the plain tar to the
 * caller's sandbox (NOT inside `destDir`; default: `dirname(destDir)`),
 * extract it with the platform tar (args exactly
 * `[-xf, <plainTar>, -C, destDir]`, no -P) and post-check every extracted
 * entry with lstat/realpath. Any violation throws (fail closed).
 * `options.platform` selects the tar the way `runSmoke`'s platform does;
 * `options.tarCommand` overrides it (tests only).
 */
export async function extractWrapperPayload(payloadTarZst, destDir, options = {}) {
	const platform = options.platform ?? process.platform;
	const zstd = globalThis.Bun?.zstdDecompressSync;
	if (typeof zstd !== "function") {
		throw new Error("Bun.zstdDecompressSync is unavailable; cannot decompress the wrapper payload in-process");
	}
	let compressed;
	try {
		compressed = readFileSync(payloadTarZst);
	} catch (error) {
		throw new Error(`cannot read wrapper payload ${payloadTarZst}: ${errorText(error)}`);
	}
	let plain;
	try {
		plain = Buffer.from(zstd(compressed));
	} catch (error) {
		throw new Error(`zstd decompression of ${payloadTarZst} failed: ${errorText(error)}`);
	}
	if (plain.byteLength > MAX_WRAPPER_DECOMPRESSED_BYTES) {
		throw new Error(
			`wrapper payload expands to ${plain.byteLength} bytes, above the 2 GiB (${MAX_WRAPPER_DECOMPRESSED_BYTES} byte) cap`,
		);
	}
	validatePlainTar(plain);
	const scratchDir = options.scratchDir ?? dirname(destDir);
	const plainTar = join(scratchDir, "wrapper-payload.tar");
	writeFileSync(plainTar, plain);
	const tar = options.tarCommand ?? tarCommandFor(platform);
	const out = spawnSync(tar, ["-xf", plainTar, "-C", destDir], { stdio: "pipe", windowsHide: true });
	try {
		rmSync(plainTar, { force: true });
	} catch {
		// Best effort: the sandbox cleanup removes any residue.
	}
	if (out.status !== 0) {
		throw new Error(`tar -xf exited with ${out.status}: ${String(out.stderr ?? "").trim().slice(0, 300)}`);
	}
	postCheckExtraction(destDir);
}


/**
 * Default --app-dir: the current platform's tray build under apps/tray/build/.
 * The script lives in <repo>/scripts/, so the repo root is one level up.
 */
export function defaultAppDir(scriptDir, platform = process.platform, arch = process.arch) {
	const root = resolve(dirname(scriptDir));
	const builds = join(root, "apps", "tray", "build");
	if (platform === "win32") return join(builds, `stable-win-${arch === "arm64" ? "arm64" : "x64"}`);
	if (platform === "darwin") return join(builds, `stable-macos-${arch === "arm64" ? "arm64" : "x64"}`);
	return join(builds, `stable-linux-${arch === "arm64" ? "arm64" : "x64"}`);
}

/**
 * Env for the sandboxed launcher: PINAR_HOME/HOME/USERPROFILE (and
 * LOCALAPPDATA/APPDATA on Windows) inside the sandbox, PINAR_PORT pinned.
 */
export function smokeEnv(sandbox, port, options = {}) {
	const { platform = process.platform, baseEnv = process.env } = options;
	const home = join(sandbox, "home");
	const env = {
		...baseEnv,
		PINAR_HOME: join(sandbox, ".pinar"),
		HOME: home,
		USERPROFILE: home,
		PINAR_PORT: String(port),
	};
	if (platform === "win32") {
		env.LOCALAPPDATA = join(home, "AppData", "Local");
		env.APPDATA = join(home, "AppData", "Roaming");
	}
	return env;
}

/** Read `$PINAR_HOME/tray.pid`; report existence, parsed PID and freshness. */
export function readTrayPid(path, startMs) {
	if (!existsSync(path)) return { exists: false, pid: null, fresh: false };
	let content = "";
	try {
		content = readFileSync(path, "utf8").trim();
	} catch {
		content = "";
	}
	const pid = Number(content);
	const valid = Number.isInteger(pid) && pid > 0;
	let fresh = false;
	try {
		fresh = valid && statSync(path).mtimeMs >= startMs;
	} catch {
		fresh = false;
	}
	return { exists: true, pid: valid ? pid : null, fresh };
}

/** True when a PID is a (transitive) descendant of an ancestor PID. */
async function inProcessTree(pid, ancestorPid, parentOf, seen = new Set(), hops = 0) {
	if (pid === ancestorPid) return true;
	if (hops > 32 || seen.has(pid)) return false;
	seen.add(pid);
	const parent = await parentOf(pid);
	if (parent == null) return false;
	return inProcessTree(parent, ancestorPid, parentOf, seen, hops + 1);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------- platform-specific probes (main path only) ------------- */

let cachedPsExe = null;

function psExe() {
	if (cachedPsExe != null) return cachedPsExe;
	for (const candidate of ["pwsh", "powershell"]) {
		const probe = spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"], {
			stdio: "ignore",
			windowsHide: true,
		});
		if (!probe.error) {
			cachedPsExe = candidate;
			return candidate;
		}
	}
	cachedPsExe = "powershell";
	return cachedPsExe;
}

async function psScript(file, args, timeoutMs = 20_000) {
	return await new Promise((resolve) => {
		const child = spawn(psExe(), ["-NoProfile", "-File", file, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => (stdout += chunk));
		child.stderr?.on("data", (chunk) => (stderr += chunk));
		const timer = setTimeout(() => {
			try {
				if (process.platform === "win32") {
					spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
				} else {
					process.kill(child.pid, "SIGKILL");
				}
			} catch {
				// already gone
			}
		}, timeoutMs);
		child.on("error", () => {
			clearTimeout(timer);
			resolve({ ok: false, stdout: "", stderr: `spawn failed: ${stderr}` });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ ok: code === 0, stdout, stderr });
		});
	});
}

/** Kill a process and its descendants. */
async function killTree(pid) {
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
	} else {
		for (const signal of ["SIGTERM", "SIGKILL"]) {
			try {
				process.kill(-pid, signal);
			} catch {
				// Not a group leader or already gone; try the bare pid.
			}
			try {
				process.kill(pid, signal);
			} catch {
				// already gone
			}
			await sleep(500);
		}
	}
	await sleep(300);
}

/**
 * Main entry. `hooks` lets tests substitute probes, but the defaults are the
 * real platform probes below. Resolves (never rejects): every cleanup fault
 * is recorded in `result.cleanup` instead of throwing.
 */
export async function runSmoke(args, hooks = {}) {
	// The default parent/image probes write their .ps1 into the sandbox so the
	// sandbox cleanup removes them; tests inject their own probes (and spawn).
	const isAlive = hooks.isAlive ?? defaultIsAlive();
	const killTreeFn = hooks.killTree ?? killTree;
	const listeningPid = hooks.listeningPid ?? findListeningPid;
	const spawnFn = hooks.spawn ?? spawn;
	const probeHealthFn = hooks.probeHealth ?? probeHealth;
	const removeDirFn = hooks.removeDir ?? removeDir;
	const realpathFn = hooks.realpath ?? realpathSync.native;
	let parentOf = hooks.parentOf ?? null;
	let imageOf = hooks.imageOf ?? null;

const start = Date.now();
	const platform = hooks.platform ?? process.platform;
	const appDir = args.appDir != null ? resolve(args.appDir) : defaultAppDir(dirname(fileURLToPath(import.meta.url)), platform, process.arch);
	const result = {
		ok: false,
		platform,
		appDir,
		launchDir: appDir,
		launcher: null,
		port: args.port,
		jsExecuted: false,
		trayPid: null,
		health: false,
		elapsedMs: 0,
		reason: null,
		cleanup: { ok: false, killed: [], refused: [], errors: [], sandboxRemoved: false },
	};
	const cleanup = result.cleanup;
	let sandbox = null;
	let launchRoot = appDir;
	let child = null;
	let startMs = 0;
	let outBuf = "";
	let errBuf = "";

	try {
		const created = mkdtempSync(join(tmpdir(), "pinar-tray-smoke-"));
		try {
			sandbox = realpathFn(created);
		} catch (error) {
			// Still removable: fall back to the raw mkdtemp path.
			sandbox = created;
			result.reason = `failed to canonicalize the sandbox ${created}: ${errorText(error)}`;
			return finish();
		}
		const probeDir = join(sandbox, "probes");
		mkdirSync(probeDir, { recursive: true });
		parentOf = parentOf ?? defaultParentOf(probeDir);
		imageOf = imageOf ?? defaultImageOf(probeDir);

		// The win32 and darwin build dirs are Electrobun self-extracting
		// wrappers (the wrapper `launcher` installs the real app OVER the
		// build-dir bundle and relaunches it through the OS, so the tray would
		// parent to launchd / the init process and the smoke would always fail
		// "outside the launched process tree" while rewriting the build
		// artifact). Materialize the real app from the payload into THIS run's
		// sandbox and spawn the inner launcher directly (never the wrapper
		// launcher, never `open`); the build artifact stays byte-for-byte
		// unchanged. Detection and extraction fail closed BEFORE the spawn:
		// nothing is spawned, nothing is killed, the sandbox is removed (or
		// retained on --keep-home).
		let payloadTar = null;
		try {
			payloadTar =
				platform === "win32"
					? wrapperPayloadTarZst(appDir)
					: platform === "darwin"
						? darwinWrapperPayloadTarZst(appDir)
						: null;
		} catch (error) {
			result.reason = `unsafe or ambiguous wrapper payload under ${appDir}: ${errorText(error)}`;
			return finish();
		}
		if (payloadTar != null) {
			const extracted = join(sandbox, "extracted");
			mkdirSync(extracted, { recursive: true });
			try {
				await extractWrapperPayload(payloadTar, extracted, { platform, scratchDir: sandbox });
			} catch (error) {
				result.reason = `failed to extract wrapper payload ${payloadTar}: ${errorText(error)}`;
				return finish();
			}
			launchRoot = extracted;
			if (platform === "darwin") {
				// The inner app must not itself be a wrapper: Electrobun never
				// nests, so a wrapper-shaped payload is a different (unsafe)
				// thing and fails closed.
				let innerWrapper = null;
				let innerAmbiguous = null;
				try {
					innerWrapper = darwinWrapperPayloadTarZst(launchRoot);
				} catch (error) {
					innerAmbiguous = errorText(error);
				}
				if (innerWrapper != null || innerAmbiguous != null) {
					result.reason = innerAmbiguous != null
						? `extracted payload is still a self-extracting wrapper (ambiguous: ${innerAmbiguous})`
						: "extracted payload is still a self-extracting wrapper";
					return finish();
				}
			}
		}
		try {
			launchRoot = realpathFn(launchRoot);
		} catch (error) {
			result.reason = `failed to canonicalize the launch dir ${launchRoot}: ${errorText(error)}`;
			return finish();
		}
		result.launchDir = launchRoot;
		const launcher = resolveLauncher(launchRoot, platform);
		if (launcher == null) {
			result.reason = `launcher not found under ${launchRoot}`;
			return finish();
		}
		result.launcher = launcher;

		const pinarHome = join(sandbox, ".pinar");
		const home = join(sandbox, "home");
		mkdirSync(pinarHome, { recursive: true });
		mkdirSync(home, { recursive: true });
		writeFileSync(join(pinarHome, "desktop.json"), `${JSON.stringify(DESKTOP_PREFS)}\n`);
		const env = smokeEnv(sandbox, args.port, { platform });

		if (args.log != null) {
			mkdirSync(dirname(resolve(args.log)), { recursive: true });
		}

		// Refuse to launch when the pinned port is in use by ANY process — a
		// success on top of a foreign helper (or a kill of it in cleanup) would
		// be a false result. This pre-spawn refusal is also what makes the
		// cleanup kills conditional below: a refusal means this run spawned
		// nothing and must kill nothing.
		const prePid = listeningPid(args.port);
		if (prePid != null) {
			result.reason = `port ${args.port} is already in use by pid ${prePid}; free the port or choose another with --port`;
			return finish();
		}
		const pre = await probeHealthFn(args.port);
		if (pre.healthy) {
			// Backstop for hosts without netstat/lsof: a healthy pinar helper
			// already answers on the pinned port.
			result.reason = `port ${args.port} already serves a healthy pinar helper before launch`;
			return finish();
		}

		startMs = Date.now();
		let spawnError = null;
		try {
			child = spawnFn(launcher, [], {
				cwd: dirname(launcher),
				env,
				stdio: ["ignore", "pipe", "pipe"],
				detached: platform !== "win32",
				windowsHide: true,
			});
		} catch (error) {
			// A synchronous throw out of the spawn (hook or runtime) means
			// nothing was started: nothing may be killed. Record it and fall
			// through to the normal cleanup/finish — the result (including
			// sandbox/sandboxRetained) is returned, never thrown.
			spawnError = error instanceof Error ? error : new Error(String(error));
			child = null;
		}
		if (child == null || child.pid == null) {
			result.reason = spawnError != null
				? `launcher spawn failed: ${spawnError.message}`
				: "launcher spawn failed (no pid)";
			return finish();
		}
		result.launcherPid = child.pid;
		child.on?.("error", (error) => {
			spawnError = error instanceof Error ? error : new Error(String(error));
		});
		const log = (buffer) => (chunk) => {
			const text = chunk.toString();
			if (buffer === "out") outBuf += text;
			else errBuf += text;
			if (args.log != null) appendFileSync(args.log, text);
		};
		child.stdout?.on("data", log("out"));
		child.stderr?.on("data", log("err"));

		const pidFile = join(pinarHome, "tray.pid");
		const deadline = startMs + args.timeoutMs;
		while (Date.now() < deadline) {
			await sleep(DEFAULT_POLL_MS);
			if (spawnError != null) {
				result.reason = `launcher spawn failed: ${spawnError.message}`;
				break;
			}
			const pidInfo = readTrayPid(pidFile, startMs);
			let pidAlive = false;
			let inTree = false;
			if (pidInfo.fresh && pidInfo.pid != null) {
				result.trayPid = pidInfo.pid;
				pidAlive = await isAlive(pidInfo.pid);
				if (pidAlive) inTree = await inProcessTree(pidInfo.pid, child.pid, parentOf);
			}
			const healthOk = (await probeHealthFn(args.port)).healthy;
			result.health = healthOk;
			const decision = decide({
				freshPidFile: pidInfo.fresh,
				pidAlive,
				inTree,
				healthOk,
				timeoutMs: args.timeoutMs,
				trayPid: pidInfo.pid,
			});
			result.jsExecuted = decision.jsExecuted;
			result.reason = decision.reason;
			if (decision.ok) {
				result.ok = true;
				break;
			}
		}
		if (!result.ok && result.reason == null) {
			result.reason = `timeout after ${args.timeoutMs}ms`;
		}
		// Ancestry diagnostic (narrow): when the final result is a fresh live
		// tray PID that is NOT in the launched tree, report the PID chain from
		// that PID upward (at most 8 hops, stopping at null/0/1/a repeat). The
		// field is diagnostic only — decide(), jsExecuted, ok, and what the
		// cleanup may kill are never influenced by it.
		if (
			!result.ok &&
			result.trayPid != null &&
			result.reason === `tray.pid pid ${result.trayPid} is outside the launched process tree`
		) {
			result.trayAncestry = await pidAncestry(result.trayPid, parentOf);
		}
	} finally {
		await cleanupAfterRun();
	}

	return finish();

	/**
	 * Cleanup ownership (all kills): a PID may be killed only when ALL of:
	 *  (a) this run actually spawned the launcher (the pinned port was
	 *      verified free right before the spawn),
	 *  (b) the PID is inside the launched process tree, or its image (via
	 *      imageOf) is inside the CANONICAL launchRoot (isInsideAppDir),
	 *  (c) the PID is still alive at the moment of the kill (PID-reuse guard:
	 *      liveness and ownership are re-checked immediately before each kill).
	 * A refused pre-busy-port launch or any pre-spawn failure kills NOTHING,
	 * even when a pre-existing process image lies under appDir: such a PID is
	 * recorded in `cleanup.refused` instead. The tray PID candidate comes only
	 * from a FRESH tray.pid (mtime >= startMs); a stale one is trusted for
	 * nothing. Nothing in here throws: killTree faults, residual live pids or
	 * port listeners, and sandbox-removal failures all land in `cleanup`
	 * diagnostics. Startup facts (jsExecuted, trayPid, health, launcherPid,
	 * launcher, launchDir) are preserved unchanged; result.ok additionally
	 * requires a clean cleanup.
	 */
	async function cleanupAfterRun() {
		const spawned = child != null && child.pid != null;
		// The process tree proves ownership only while the launcher is still
		// RUNNING at the moment of the check: once the launcher has exited its
		// PID can be reused by an unrelated process and Windows never updates
		// ParentProcessId, so neither `pid === launcher pid` nor a recorded
		// parent edge is evidence any more. Only canonical image containment
		// inside launchRoot still qualifies then. (The main loop's inTree is a
		// startup fact for decide() and is untouched.)
		const launcherRunning = () =>
			child != null && child.exitCode === null && child.signalCode === null;
		const ownership = async (pid) => {
			// "tree" / "image" when the live pid is ours, null otherwise.
			const alive = await isAlive(pid).catch(() => false);
			if (!alive) return null;
			if (parentOf != null && launcherRunning()) {
				try {
					if (await inProcessTree(pid, child.pid, parentOf)) return "tree";
				} catch {
					// tree probe failed: fall through to the image check
				}
			}
			if (imageOf != null) {
				try {
					// Path containment compares REAL fs paths: the actual OS's
					// path semantics (the injected `platform` drives the
					// spawn/detection branches, not this host's paths).
					if (isInsideAppDir(await imageOf(pid), launchRoot, { platform: process.platform, realpath: realpathFn })) return "image";
				} catch {
					// image probe failed: not provably ours
				}
			}
			return null;
		};
		const tryKill = async (label, pid) => {
			// PID-reuse guard: re-check liveness and ownership immediately
			// before signalling.
			if ((await ownership(pid)) == null) {
				cleanup.refused.push(`${label} pid ${pid}: not alive or no longer inside the launched tree / ${launchRoot}`);
				return;
			}
			try {
				await killTreeFn(pid);
				cleanup.killed.push(pid);
			} catch (error) {
				cleanup.errors.push(`killTree(${label} pid ${pid}) failed: ${errorText(error)}`);
			}
		};
		if (spawned) {
			// The JS runtime process (cottontail) may outlive the launcher.
			// Only a FRESH tray.pid (mtime at/after this launch) is a cleanup
			// candidate; a stale one is trusted for nothing.
			const info = readTrayPid(join(sandbox, ".pinar", "tray.pid"), startMs);
			if (info.fresh && info.pid != null && info.pid !== child.pid) {
				if ((await ownership(info.pid)) != null) {
					await tryKill("tray.pid", info.pid);
				} else {
					cleanup.refused.push(`tray.pid pid ${info.pid}: not inside the launched tree nor ${launchRoot}`);
				}
			}
			// Never signal the launcher once it has exited on its own: by
			// cleanup time its PID may have been reused by an unrelated
			// process.
			if (child.exitCode === null && child.signalCode === null) {
				await tryKill("launcher", child.pid);
			}
		}
		const helperPid = listeningPid(args.port);
		if (helperPid != null) {
			if (spawned) {
				if ((await ownership(helperPid)) != null) {
					await tryKill(`port ${args.port}`, helperPid);
				} else {
					cleanup.refused.push(`pid ${helperPid} on port ${args.port}: not inside the launched tree nor ${launchRoot}; not killed`);
				}
			} else {
				// Not spawned by this run (e.g. a production helper, or a
				// pre-busy port): never kill, just report.
				cleanup.refused.push(`pid ${helperPid} holds port ${args.port} but was not spawned by this run; not killed`);
			}
		}
		if (child != null) {
			await waitClose(child, 5_000);
		}
		// Bounded poll until every killed pid is gone and (we launched, so)
		// the pinned port is free again.
		if (spawned || cleanup.killed.length > 0) {
			const pollDeadline = Date.now() + 10_000;
			for (;;) {
				let settled = true;
				for (const pid of cleanup.killed) {
					if (await isAlive(pid).catch(() => true)) {
						settled = false;
						break;
					}
				}
				if (settled && spawned) {
					settled = listeningPid(args.port) == null;
				}
				if (settled || Date.now() >= pollDeadline) break;
				await sleep(250);
			}
			for (const pid of cleanup.killed) {
				if (await isAlive(pid).catch(() => true)) {
					cleanup.errors.push(`pid ${pid} still alive after cleanup`);
				}
			}
			if (spawned) {
				const lingering = listeningPid(args.port);
				if (lingering != null) cleanup.errors.push(`port ${args.port} still held by pid ${lingering} after cleanup`);
			}
		}
		if (sandbox != null) {
			if (args.keepHome) {
				result.sandbox = sandbox;
				result.sandboxRetained = true;
			} else {
				try {
					removeDirFn(sandbox);
					cleanup.sandboxRemoved = true;
					result.sandboxRetained = false;
				} catch (error) {
					cleanup.errors.push(`sandbox removal failed: ${errorText(error)}`);
					// Kept on disk as evidence.
					result.sandbox = sandbox;
					result.sandboxRetained = true;
				}
			}
		}
		const startupOk = result.ok;
		cleanup.ok = cleanup.errors.length === 0;
		result.ok = startupOk && cleanup.ok;
		if (result.ok) {
			result.reason = null;
		} else if (startupOk && !cleanup.ok) {
			result.reason = `cleanup failed: ${cleanup.errors[0] ?? "unknown cleanup failure"}`;
		}
		// When startup already failed the startup reason is kept as-is; the
		// cleanup diagnostics stay in result.cleanup.
	}

	function finish() {
		result.elapsedMs = Date.now() - start;
		// Keep the buffers for the caller (40-line tail on failure).
		result.__tail = () => [...lastLines(errBuf, 20), ...lastLines(outBuf, 20)];
		return result;
	}
}

/**
 * The PID chain from `pid` upward via `parentOf`: at most 8 hops, stopping
 * at null/0/1/a repeat or a probe failure (the stopping value is not
 * included). Returns `[pid]` alone when the first probe fails. Diagnostic
 * only; never throws.
 */
async function pidAncestry(pid, parentOf) {
	const chain = [pid];
	if (parentOf == null) return chain;
	const seen = new Set([pid]);
	for (let hops = 0; hops < 8; hops += 1) {
		let parent = null;
		try {
			parent = await parentOf(chain[chain.length - 1]);
		} catch {
			break;
		}
		if (parent == null || parent === 0 || parent === 1 || seen.has(parent)) break;
		seen.add(parent);
		chain.push(parent);
	}
	return chain;
}

/** GET /api/health on the pinned port; healthy only for ok/pinar. */
async function probeHealth(port) {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
			signal: AbortSignal.timeout(3_000),
		});
		const body = await response.json();
		return { healthy: response.ok && isHealthyHealth(body) };
	} catch {
		return { healthy: false };
	}
}

/** Default sandbox removal (hooks may substitute; tests drive failures). */
function removeDir(sandboxPath) {
	rmSync(sandboxPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Compact "CODE: message" text for diagnostics. */
function errorText(error) {
	const message = error instanceof Error ? error.message : String(error);
	const code = error != null && typeof error === "object" && "code" in error ? ` ${error.code}` : "";
	return code.trim() === "" ? message : `${code.trim()}: ${message}`;
}

function defaultParentOf(probeDir) {
	if (process.platform === "win32") {
		return async (pid) => {
			mkdirSync(probeDir, { recursive: true });
			const file = join(probeDir, `parent-${pid}.ps1`);
			writeFileSync(
				file,
				`param([int]$Target)\n` +
					`$p = Get-CimInstance Win32_Process -Filter "ProcessId=$Target" -ErrorAction SilentlyContinue\n` +
					`if ($null -eq $p) { exit 1 }\n` +
					`Write-Output $p.ParentProcessId\n`,
			);
			const out = await psScript(file, [String(pid)]);
			const value = Number(out.stdout.trim());
			return out.ok && Number.isInteger(value) && value > 0 ? value : null;
		};
	}
	return async (pid) => {
		const out = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" });
		const value = Number(String(out.stdout ?? "").trim());
		return Number.isInteger(value) && value > 0 ? value : null;
	};
}

/**
 * Parse a tasklist CSV row ("Image Name","PID","Session Name","Session#","Mem Usage").
 * All fields are double-quoted with no escaped quotes; tasklist emits a bare
 * "INFO: No tasks..." line (no quoted fields) when nothing matches.
 */
export function parseTasklistCsvLine(line) {
	const trimmed = String(line ?? "").trim();
	if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return null;
	const fields = trimmed.slice(1, -1).split('","');
	if (fields.length < 2) return null;
	return { image: fields[0], pid: Number(fields[1]) };
}

/** True when tasklist's CSV output lists the given PID as a live task. */
export function tasklistCsvHasPid(stdout, pid) {
	for (const line of String(stdout ?? "").split(/\r?\n/)) {
		const parsed = parseTasklistCsvLine(line);
		if (parsed !== null && parsed.pid === Number(pid)) {
			return true;
		}
	}
	return false;
}

function defaultIsAlive() {
	if (process.platform === "win32") {
		return async (pid) => {
			const out = spawnSync("tasklist", ["/NH", "/FI", `PID eq ${pid}`, "/FO", "CSV"], {
				encoding: "utf8",
				windowsHide: true,
			});
			return out.status === 0 && tasklistCsvHasPid(out.stdout, pid);
		};
	}
	return async (pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
}

/** Windows image lookup: CIM ExecutablePath probe through PowerShell. */
function imageOfWin32(probeDir) {
	return async (pid) => {
		mkdirSync(probeDir, { recursive: true });
		const file = join(probeDir, `image-${pid}.ps1`);
		writeFileSync(
			file,
			`param([int]$Target)\n` +
				`$p = Get-CimInstance Win32_Process -Filter "ProcessId=$Target" -ErrorAction SilentlyContinue\n` +
				`if ($null -eq $p) { exit 1 }\n` +
				`Write-Output $p.ExecutablePath\n`,
		);
		const out = await psScript(file, [String(pid)]);
		const path = String(out.stdout ?? "").trim();
		return out.ok && path.length > 0 ? path : null;
	};
}

/**
 * Platform-selected image-path resolver for cleanup:
 *   win32  → CIM ExecutablePath probe (PowerShell)
 *   darwin → `ps -p <pid> -o comm=` (trimmed; empty output → null)
 *   linux  → /proc/<pid>/exe
 * `platform` and the `ps` runner are injectable so tests can drive any
 * branch without spawning real processes.
 */
export function imageOfFor(platform, { probeDir, ps, procDir = "/proc" } = {}) {
	if (platform === "win32") {
		return imageOfWin32(probeDir);
	}
	if (platform === "darwin") {
		const runPs =
			ps ??
			((pid) =>
				spawnSync("ps", ["-p", String(pid), "-o", "comm="], {
					encoding: "utf8",
					windowsHide: true,
				}));
		return async (pid) => {
			const out = runPs(pid);
			if (out.status !== 0) return null;
			const path = String(out.stdout ?? "").trim();
			return path === "" ? null : path;
		};
	}
	return async (pid) => {
		try {
			return readlinkSync(join(procDir, String(pid), "exe"));
		} catch {
			return null;
		}
	};
}

function defaultImageOf(probeDir) {
	return imageOfFor(process.platform, { probeDir });
}

/* ---------------- canonical paths and the containment guard ------------- */

/**
 * Is `imagePath` inside the build dir? (The guard for the cleanup kills.)
 * Both sides are canonicalized with `realpath` — default
 * `realpathSync.native`, which resolves symlinks/junctions and expands 8.3
 * short names to the long form on Windows — and compared with the platform's
 * path module (both must be EXISTING paths; any failure fails closed to
 * false), never with a lexical prefix check. win32 compares
 * case-insensitively (both canonical strings are normalized to `\`
 * separators and lowercased); posix case-sensitively. A different drive on
 * win32 makes `relative` return an absolute path → not inside.
 */
export function isInsideAppDir(imagePath, dirPath, { platform = process.platform, realpath = realpathSync.native } = {}) {
	if (imagePath == null || imagePath === "" || dirPath == null || dirPath === "") return false;
	let canonImage;
	let canonDir;
	try {
		canonImage = realpath(imagePath);
	} catch {
		return false;
	}
	try {
		canonDir = realpath(dirPath);
	} catch {
		return false;
	}
	if (canonImage == null || canonImage === "" || canonDir == null || canonDir === "") return false;
	const p = platform === "win32" ? path.win32 : path.posix;
	if (platform === "win32") {
		// path.win32.relative is case-insensitive but keeps input casing in
		// the segments it returns; normalize both sides so an injected
		// realpath with mixed case or / separators still compares right.
		canonImage = canonImage.replace(/\//g, "\\").toLowerCase();
		canonDir = canonDir.replace(/\//g, "\\").toLowerCase();
	}
	const rel = p.relative(canonDir, canonImage);
	return rel === "" || (rel !== ".." && !rel.startsWith(".." + p.sep) && !p.isAbsolute(rel));
}

export function parseNetstatListeningPid(stdout, port) {
	const suffix = `:${port}`;
	for (const line of String(stdout ?? "").split(/\r?\n/)) {
		if (!/LISTENING/i.test(line)) continue;
		const cols = line.trim().split(/\s+/);
		const local = cols[1] ?? "";
		if (!local.endsWith(suffix)) continue;
		const pid = Number(cols[cols.length - 1]);
		if (Number.isInteger(pid) && pid > 0) return pid;
	}
	return null;
}

function findListeningPid(port) {
	if (process.platform === "win32") {
		const out = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
		return parseNetstatListeningPid(out.stdout, port);
	}
	const out = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
	const pid = Number(String(out.stdout ?? "").trim().split(/\s+/)[0]);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function waitClose(child, timeoutMs) {
	return new Promise((resolve) => {
		if (child.exitCode != null || child.signalCode != null) return resolve();
		const timer = setTimeout(resolve, timeoutMs);
		child.on("close", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

function printHelp(stream) {
	stream.write(
		[
			"Usage: bun scripts/tray-smoke.mjs [--app-dir <dir>] [--port <n>]",
			"                          [--timeout-ms <n>] [--log <file>] [--keep-home]",
			"",
			"  --app-dir <dir>     tray build dir (default: apps/tray/build/stable-<platform>-<arch>)",
			`  --port <n>          pinned helper port, free before launch (default ${DEFAULT_PORT})`,
			`  --timeout-ms <n>    max wait for tray.pid + health (default ${DEFAULT_TIMEOUT_MS})`,
			"  --log <file>        append the launcher stdout/stderr to <file>",
			"  --keep-home         keep the sandbox PINAR_HOME for inspection",
			"",
		].join("\n"),
	);
}

const lastLines = (text, n) => String(text ?? "").split(/\r?\n/).slice(-n).filter((line) => line.length > 0);

async function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`tray-smoke: ${error.message}\n`);
		printHelp(process.stderr);
		process.exit(2);
	}
	if (args.help) {
		printHelp(process.stdout);
		return;
	}
	let result;
	try {
		result = await runSmoke(args);
	} catch (error) {
		// runSmoke must not reject; if it ever does, stdout still gets exactly
		// one final JSON line and the exit code is non-zero.
		const reason = `internal error: ${error instanceof Error ? error.message : String(error)}`;
		result = {
			ok: false,
			platform: process.platform,
			appDir: null,
			launchDir: null,
			launcher: null,
			port: args.port,
			jsExecuted: false,
			trayPid: null,
			health: false,
			elapsedMs: 0,
			reason,
			cleanup: { ok: false, killed: [], refused: [], errors: [reason], sandboxRemoved: false },
		};
	}
	const tail = typeof result.__tail === "function" ? result.__tail() : [];
	delete result.__tail;
	process.stdout.write(`${JSON.stringify(result)}\n`);
	if (!result.ok) {
		process.stderr.write(`tray-smoke: ${result.reason}\n`);
		if (tail.length) process.stderr.write(tail.join("\n") + "\n");
		process.exitCode = 1;
	}
}

if (import.meta.main) {
	main();
}
