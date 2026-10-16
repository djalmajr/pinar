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
 *     cleanup: { ok, killed, refused, errors, reused, sandboxRemoved },
 *     sandbox?, sandboxRetained, trayAncestry?, diagnostics? } —
 * `diagnostics` exists ONLY when ok is false: `{ samples (≤14),
 * lastHealth, trayPid, serverPid: { value, reason }, sandboxFiles (≤60
 * { relPath, size } under the sandbox's .pinar and the extracted app log
 * dir), logTails ({ relPath: last ≤4096 bytes }, *.log under .pinar and the
 * extracted app.log, total ≤16 KiB) }`, built before the cleanup removes the
 * sandbox; a success JSON is byte-for-byte unchanged.
 */
import { spawn, spawnSync } from "node:child_process";
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readlinkSync,
	readSync,
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

/**
 * Failure-diagnostics sampling cadence (SM-7): while the wait loop is
 * failing, at most one health/port/helper sample is taken every
 * SAMPLE_INTERVAL_MS plus one final sample — a 120 s run never takes more
 * than 14. This is a sampling cadence, not a new timeout: every probe a
 * sample runs is an EXISTING bounded probe (the 3 s health fetch,
 * listeningPid, inProcessTree, imageOf, isInsideAppDir) and no new bound is
 * added.
 */
export const SAMPLE_INTERVAL_MS = 10_000;

/** Hard cap on a wrapper payload's decompressed plain-tar size (2 GiB). */
export const MAX_WRAPPER_DECOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

/** Hard cap on the number of entries a wrapper payload's plain tar may hold. */
export const MAX_WRAPPER_ENTRIES = 200_000;

/** The win32 taskkill bound in `killTreeFor`: the SAME value as
 * `teardownChild`'s default `taskkillTimeoutMs` (scripts/child-teardown.mjs,
 * default 8_000) — the smoke's taskkill is bounded exactly the way the
 * tray's own runner is bounded; it is not a new budget. */
export const TASKKILL_TIMEOUT_MS = 8_000;

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

/**
 * Strict PID parse for every pid read from external output (tray.pid,
 * netstat/lsof, ps/powershell ParentProcessId, tasklist): digits only
 * (after trim), 1..2147483647. Anything else ("12abc", "1e3", "0x1f",
 * " ", "0", "-5", "99999999999", suffixes) is null — never normalized:
 * a malformed pid is a missing pid, and a missing pid is a refusal,
 * not a signal.
 */
export function parsePid(text) {
	if (typeof text !== "string") return null;
	const trimmed = text.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	if (!Number.isInteger(value) || value < 1 || value > 2147483647) return null;
	return value;
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
 * (absolute `\\x` and drive `C:…` names included), no absolute names, and
 * per segment: no `.`/`..` segment; no segment ending with a dot or a
 * space (Windows strips trailing dots/spaces, so `.. ` collapses to `..`
 * and `foo.` collides with `foo` after extraction); no segment made only
 * of dots and/or spaces (the same Windows normalization class).
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
		if (segment === ".") throw new Error(`${label}: "." segment in entry name: ${name}`);
		// SM-3 (security S7): NTFS strips trailing dots/spaces from names, so
		// `foo. ` collapses to `foo` (collision) and `.. ` collapses to `..`
		// (escape) once the OS strips them. A segment that consists ONLY of
		// dots and/or spaces always ends with a dot or a space, so the check
		// below subsumes that case as well.
		if (segment.endsWith(".") || segment.endsWith(" ")) {
			throw new Error(`${label}: segment ${JSON.stringify(segment)} ends with a dot or space in entry name: ${name}`);
		}
	}
}

/**
 * Test-only override for a production cap: `undefined` keeps the default;
 * any other value must be a positive integer not above the default
 * (fail closed: throw otherwise — a test can narrow a cap, never raise it).
 */
function resolveCapOption(value, name, defaultValue) {
	if (value === undefined) return defaultValue;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > defaultValue) {
		throw new Error(`options.${name} must be a positive integer not above ${defaultValue}`);
	}
	return value;
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
 * truncated archive, more than MAX_WRAPPER_ENTRIES entries (a test-only
 * `options.maxEntries` narrows the cap, never above the default; otherwise
 * throw), and non-NUL bytes after the terminator block.
 * The ustar `prefix` field is joined with the name (`prefix + "/" + name`)
 * when the magic at 257 is `ustar`, and the joined name goes through every
 * path check as one path.
 */
export function validatePlainTar(input, options = {}) {
	const maxEntries = resolveCapOption(options.maxEntries, "maxEntries", MAX_WRAPPER_ENTRIES);
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
		if (entryCount > maxEntries) {
			throw new Error(`tar archive has more than ${maxEntries} entries`);
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
 * The content size (decompressed bytes) declared by the FIRST normal zstd
 * frame of `bytes`, or null when it cannot be known from the header: not a
 * normal frame (skippable/unknown magic, too short) or the frame declares
 * no content size. The parse follows the field order of RFC 8878 §3.1.1.1,
 * cross-verified against the real decoders (the zstd 1.5.7 CLI and Bun's
 * decoder), including the windowed forms: magic 0xfd2fb528 (little-endian
 * on disk: 28 B5 2F FD), descriptor byte (FCS_Flag = bits 7-6,
 * Single_Segment_Flag = bit 5, Checksum_Flag = bit 2, Dictionary_ID_Flag =
 * bits 1-0), an optional Window_Descriptor byte (present iff single-
 * segment is cleared), an optional Dictionary_ID field (0/1/2/4 bytes per
 * Dictionary_ID_Flag 0/1/2/3), then the little-endian FCS_Field:
 * a 1-byte field stores the size (single-segment frames only), a 2-byte
 * field is offset by 256 (size = value + 256, both segment modes), a
 * 4-byte field stores the size (both segment modes) — RFC 8878
 * §3.1.1.1.4. FCS_Flag 0b11 selects an 8-byte field (sizes of 4 GiB and
 * up); it is not parsed here and returns null. Any shape the parser cannot
 * name here returns null and the caller keeps the post-decompression cap
 * check as the guard.
 */
export function zstdDeclaredContentSize(bytes) {
	const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
	if (b.length < 5 || b.readUInt32LE(0) !== 0xfd2fb528) return null;
	const descriptor = b.readUInt8(4);
	const singleSegment = (descriptor & 0x20) !== 0;
	const fcsFlag = (descriptor >> 6) & 0x03;
	// Dictionary_ID: bits 1-0 of the descriptor select a 0/1/2/4-byte field
	// (flag 0/1/2/3) between the Window_Descriptor and the FCS_Field; the
	// length is part of the FCS offset (review rv-rt-s3: skipping it made
	// a one-byte zero Dictionary_ID shift the 4-byte FCS read and falsely
	// declare 2,415,919,104 bytes for a 9 MiB tar).
	const didLength = [0, 1, 2, 4][descriptor & 0x03];
	// FCS_Field width: flag 0b00: 1-byte field, single-segment frames only
	// (exact size), none otherwise; flag 0b01: 2-byte field (size = value
	// + 256), both segment modes; flag 0b10: 4-byte little-endian field
	// (exact), both segment modes; flag 0b11: 8-byte field, not parsed
	// here (returns null; the post-decompression cap is the guard).
	const fieldSize = fcsFlag === 0 ? (singleSegment ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 0;
	if (fieldSize === 0) return null;
	const offset = 5 + (singleSegment ? 0 : 1) + didLength;
	if (b.length < offset + fieldSize) return null;
	let value = 0;
	for (let i = fieldSize - 1; i >= 0; i -= 1) value = value * 256 + b[offset + i];
	// RFC 8878 §3.1.1.1.4: the 2-byte FCS_Field is offset by 256.
	return fcsFlag === 1 ? value + 256 : value;
}

/**
 * Internal: the pre-allocation frame walk (SM-5; runs before ANY
 * decompression). `bytes` must be EXACTLY ONE normal zstd frame ending
 * exactly at the input end. Throws, naming the offending property:
 * a skippable frame (magic 0x184D2A50..0x184D2A5F) anywhere; a non-zstd
 * magic; a dictionary id; a reserved block type; any frame or block that
 * runs past the input; more than one frame, or trailing bytes after the
 * first frame. The frame end is the block walk (3-byte little-endian
 * headers: bit 0 last-block; bits 1-2 type — 0 raw → size bytes, 1 RLE →
 * 1 byte, 2 compressed → size bytes, 3 reserved → reject; bits 3-23 the
 * size) plus the 4-byte checksum when the descriptor's checksum flag is
 * set; it must equal the input length. Along the walk it also computes the
 * pre-allocation decompressed-size BOUND (F-1, RFC 8878): Window_Size
 * from the Window_Descriptor (windowLog = 10 + exponent, windowBase =
 * 1 << windowLog, windowAdd = (windowBase / 8) * mantissa, Window_Size =
 * windowBase + windowAdd; a single-segment frame has no Window_Descriptor
 * and 128 KiB stands in), Block_Maximum_Size = min(Window_Size,
 * 128 KiB); per block a raw block contributes exactly its Block_Size, an
 * RLE block exactly its Block_Size (that field is its regenerated size),
 * and a compressed block at most Block_Maximum_Size. Returns `{ declared,
 * bound }` — `declared` is the declared content size (null when the frame
 * declares none: a windowed frame with FCS_Flag 0b00).
 */
function zstdFrameWalk(bytes) {
	const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
	if (b.length === 0) throw new Error("zstd frame validation: empty input is not a zstd frame");
	const magic = b.readUInt32LE(0);
	if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
		throw new Error(`zstd frame validation: skippable frame (magic 0x${magic.toString(16)}) rejected`);
	}
	if (magic !== 0xfd2fb528) {
		throw new Error(`zstd frame validation: not a zstd frame (magic 0x${magic.toString(16)})`);
	}
	if (b.length < 5) throw new Error("zstd frame validation: truncated frame header");
	const descriptor = b.readUInt8(4);
	const singleSegment = (descriptor & 0x20) !== 0;
	const fcsFlag = (descriptor >> 6) & 0x03;
	const checksum = (descriptor & 0x04) !== 0;
	if ((descriptor & 0x03) !== 0) {
		throw new Error(`zstd frame validation: dictionary id (flag 0b${(descriptor & 0x03).toString(2)}) rejected`);
	}
	let offset = 5;
	// Window_Size (RFC 8878 §3.1.1.1.2): Window_Descriptor bits 6-3 are
	// the exponent, bits 2-0 the mantissa. A single-segment frame carries
	// no Window_Descriptor: 128 KiB stands in (its Block_Maximum_Size is
	// the 128 KiB minimum of min(Window_Size, 128 KiB) either way).
	let windowSize = 0x20000;
	if (!singleSegment) {
		if (offset >= b.length) throw new Error("zstd frame validation: truncated frame header (no window descriptor)");
		const windowDescriptor = b[offset];
		const windowBase = 1 << (10 + ((windowDescriptor >> 3) & 0x0f));
		windowSize = windowBase + (windowBase / 8) * (windowDescriptor & 0x07);
		offset += 1; // window descriptor
	}
	let declared = null;
	if (fcsFlag === 0) {
		// FCS_Flag 0b00 declares a size only on single-segment frames;
		// a windowed frame with FCS_Flag 0b00 has NO FCS field (null).
		if (singleSegment) {
			if (offset + 1 > b.length) throw new Error("zstd frame validation: truncated frame header (no 1-byte FCS field)");
			declared = b.readUInt8(offset);
			offset += 1;
		}
	} else if (fcsFlag === 1) {
		if (offset + 2 > b.length) throw new Error("zstd frame validation: truncated frame header (no 2-byte FCS field)");
		declared = b.readUInt16LE(offset) + 256; // RFC 8878 §3.1.1.1.4
		offset += 2;
	} else if (fcsFlag === 2) {
		if (offset + 4 > b.length) throw new Error("zstd frame validation: truncated frame header (no 4-byte FCS field)");
		declared = b.readUInt32LE(offset);
		offset += 4;
	} else {
		if (offset + 8 > b.length) throw new Error("zstd frame validation: truncated frame header (no 8-byte FCS field)");
		const size = b.readBigUInt64LE(offset);
		if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new Error("zstd frame validation: declared content size beyond the safe integer range; rejected before decompression");
		}
		declared = Number(size);
		offset += 8;
	}
	const blockMax = Math.min(windowSize, 0x20000);
	let bound = 0;
	for (;;) {
		if (offset + 3 > b.length) throw new Error("zstd frame validation: block header runs past the input");
		const word = b.readUInt16LE(offset) | (b.readUInt8(offset + 2) << 16);
		const last = (word & 0x01) !== 0;
		const type = (word >> 1) & 0x03;
		const size = (word >> 3) & 0x1fffff;
		if (type === 3) throw new Error("zstd frame validation: reserved block type rejected");
		const dataLen = type === 1 ? 1 : size;
		if (offset + 3 + dataLen > b.length) throw new Error("zstd frame validation: block data runs past the input");
		// F-1 pre-allocation bound: raw contributes exactly Block_Size;
		// RLE contributes exactly Block_Size (that field is its
		// regenerated size); compressed contributes at most
		// Block_Maximum_Size.
		bound += type === 2 ? blockMax : size;
		offset += 3 + dataLen;
		if (last) break;
	}
	if (checksum) {
		if (offset + 4 > b.length) throw new Error("zstd frame validation: checksum runs past the input");
		offset += 4;
	}
	if (offset !== b.length) {
		throw new Error(`zstd frame validation: frame ends at byte ${offset} of ${b.length}; trailing bytes or more than one frame rejected`);
	}
	return { declared, bound };
}

/**
 * Pre-allocation decompressed-size bound of `bytes` (F-1; exported for
 * tests and read-only payload verification). Runs the same structural
 * walk as validateZstdSingleFrame (same throws) and returns the bound:
 * the sum over the frame's blocks of raw/RLE Block_Size (exact — an RLE
 * block's Block_Size field is its regenerated size) and, per compressed
 * block, at most Block_Maximum_Size = min(Window_Size, 128 KiB) with
 * Window_Size from the Window_Descriptor (128 KiB for a single-segment
 * frame). The bound is a PRE-ALLOCATION upper bound used to reject a
 * frame before decompression when it declares no content size; the
 * post-decompression cap check remains the authoritative size guard.
 */
export function zstdPreallocationBound(bytes) {
	return zstdFrameWalk(bytes).bound;
}

/**
 * Pre-allocation zstd frame validation (SM-5 + F-1; runs before ANY
 * decompression). `bytes` must be EXACTLY ONE structurally complete
 * normal zstd frame (see zstdFrameWalk for the structural rules). Size
 * gating, all BEFORE decompression, against `cap` (the UNCHANGED 2 GiB
 * default): a declared content size above `cap` is rejected; a frame
 * that declares none (a windowed frame with FCS_Flag 0b00 — the one
 * shape whose size the header cannot name) is rejected when its
 * pre-allocation bound (the window + block walk sum, see
 * zstdPreallocationBound) exceeds `cap`. The post-decompression cap
 * check in extractWrapperPayload stays the authoritative size guard.
 * Returns the declared content size, or null when the frame declares
 * none.
 */
export function validateZstdSingleFrame(bytes, cap = MAX_WRAPPER_DECOMPRESSED_BYTES) {
	const { declared, bound } = zstdFrameWalk(bytes);
	if (declared !== null && declared > cap) {
		throw new Error(
			`wrapper payload declares a zstd content size of ${declared} bytes, above the ${cap} byte decompression cap; rejected before decompression`,
		);
	}
	if (declared === null && bound > cap) {
		throw new Error(
			`wrapper payload declares no zstd content size; its pre-allocation decompressed-size bound is ${bound} bytes (window + block walk), above the ${cap} byte decompression cap; rejected before decompression`,
		);
	}
	return declared;
}

/**
 * Materialize a wrapper payload (a `Resources/<hash>.tar.zst`) into
 * `destDir` without ever trusting its bytes: validate the ENTIRE zstd
 * frame structure FIRST (validateZstdSingleFrame — exactly one normal
 * frame, no skippable frames, no dictionary id, no reserved block type,
 * nothing past the input, no trailing bytes, a declared content size
 * within the cap — and, when the frame declares NO content size (a
 * windowed frame with FCS_Flag 0b00), its pre-allocation decompressed-
 * size bound (the window + block walk sum, see zstdPreallocationBound)
 * within the cap — so an oversize is rejected BEFORE decompressing and
 * the expansion is never allocated; then decompress in-process
 * (Bun.zstdDecompressSync by default — no `zstd` binary, no bsdtar zstd
 * assumption) and re-check the ACTUAL decompressed size against the cap:
 * that post-decompression check is the authoritative size guard (for a
 * no-content-size frame the pre-check bound is a window/block upper
 * bound, not a proof of the exact decompressed length). Then validate the
 * plain tar headers BEFORE anything is written (see validatePlainTar),
 * write the plain tar to the caller's sandbox (NOT inside `destDir`;
 * default: `dirname(destDir)`), extract it with the platform tar (args
 * exactly `[-xf, <plainTar>, -C, destDir]`, no -P) and post-check every
 * extracted entry with lstat/realpath. Any violation throws (fail
 * closed). `options.platform` selects the tar the way `runSmoke`'s
 * platform does; `options.tarCommand` overrides it (tests only).
 * Test-only options: `maxDecompressedBytes` / `maxEntries` narrow the
 * production caps (positive integer, never above the default, otherwise
 * throw) and `zstdDecompress` replaces the decompressor (default:
 * Bun.zstdDecompressSync).
 */
export async function extractWrapperPayload(payloadTarZst, destDir, options = {}) {
	const platform = options.platform ?? process.platform;
	const cap = resolveCapOption(options.maxDecompressedBytes, "maxDecompressedBytes", MAX_WRAPPER_DECOMPRESSED_BYTES);
	const maxEntries = resolveCapOption(options.maxEntries, "maxEntries", MAX_WRAPPER_ENTRIES);
	if (options.zstdDecompress !== undefined && typeof options.zstdDecompress !== "function") {
		throw new Error("options.zstdDecompress must be a function");
	}
	const decompress = options.zstdDecompress ?? globalThis.Bun?.zstdDecompressSync;
	if (typeof decompress !== "function") {
		throw new Error("Bun.zstdDecompressSync is unavailable; cannot decompress the wrapper payload in-process");
	}
	let compressed;
	try {
		compressed = readFileSync(payloadTarZst);
	} catch (error) {
		throw new Error(`cannot read wrapper payload ${payloadTarZst}: ${errorText(error)}`);
	}
	// Fail-closed pre-check (before ANY allocation): the whole frame
	// structure is validated — exactly one normal zstd frame, no skippable
	// frames, no dictionary id, no reserved block type, nothing past the
	// input, no trailing bytes — and an oversize is rejected BEFORE
	// decompressing, so the expansion is never allocated: a declared
	// content size above the cap, or — for the one frame shape that
	// declares no content size (a windowed frame with FCS_Flag 0b00) —
	// the pre-allocation decompressed-size bound (window + block walk)
	// above the cap. The post-decompression check below remains the
	// authoritative size guard.
	validateZstdSingleFrame(compressed, cap);
	let plain;
	try {
		plain = Buffer.from(decompress(compressed));
	} catch (error) {
		throw new Error(`zstd decompression of ${payloadTarZst} failed: ${errorText(error)}`);
	}
	if (plain.byteLength > cap) {
		throw new Error(
			`wrapper payload expands to ${plain.byteLength} bytes, above the ${cap} byte decompression cap`,
		);
	}
	validatePlainTar(plain, { maxEntries });
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
 * The base env is inherited (the executable search path and system
 * variables are needed for a native start) EXCEPT the inherited PINAR_*
 * variables, which are dropped (allowlist approach): the smoke sets only
 * PINAR_HOME and PINAR_PORT itself, and a parent's PINAR_BIN /
 * PINAR_UPDATE_BASE_URL (or any other PINAR_*) must not leak into the
 * sandboxed child. TEMP/TMP/TMPDIR point at <sandbox>/tmp (created by the
 * caller before the spawn); on win32 HOMEDRIVE/HOMEPATH are split from the
 * sandbox home; on POSIX the XDG_* homes point under the sandbox home.
 */
export function smokeEnv(sandbox, port, options = {}) {
	const { platform = process.platform, baseEnv = process.env } = options;
	const home = join(sandbox, "home");
	// Allowlist: drop every inherited PINAR_* (the smoke re-sets PINAR_HOME
	// and PINAR_PORT below; nothing else from the parent survives).
	const inherited = {};
	for (const [key, value] of Object.entries(baseEnv)) {
		if (key.startsWith("PINAR_")) continue;
		inherited[key] = value;
	}
	const env = {
		...inherited,
		PINAR_HOME: join(sandbox, ".pinar"),
		HOME: home,
		USERPROFILE: home,
		PINAR_PORT: String(port),
		TEMP: join(sandbox, "tmp"),
		TMP: join(sandbox, "tmp"),
		TMPDIR: join(sandbox, "tmp"),
	};
	if (platform === "win32") {
		env.LOCALAPPDATA = join(home, "AppData", "Local");
		env.APPDATA = join(home, "AppData", "Roaming");
		// HOMEDRIVE/HOMEPATH split from the sandbox home (the home is always
		// an absolute drive path inside the sandbox).
		const homeWin = home.replace(/\//g, "\\");
		const split = homeWin.match(/^([A-Za-z]:)(.*)$/);
		if (split != null) {
			env.HOMEDRIVE = split[1];
			env.HOMEPATH = split[2] === "" ? "\\" : split[2];
		}
	} else {
		env.XDG_CONFIG_HOME = join(home, ".config");
		env.XDG_DATA_HOME = join(home, ".local", "share");
		env.XDG_CACHE_HOME = join(home, ".cache");
		env.XDG_STATE_HOME = join(home, ".local", "state");
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
	const pid = parsePid(content);
	const valid = pid !== null;
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

// The probe kill-wait value (2 s) — the same finite bound
// `boundedIdentityProbe` (scripts/child-teardown.mjs, `probeKillWaitMs`
// default 2_000) waits for the real close after a deadline kill. A
// `psScript` probe that hit the deadline must settle within this bound:
// no new knob, no raised bound.
const PS_SCRIPT_CLOSE_WAIT_MS = 2_000;

/**
 * Run a probe .ps1 file with the FIXED
 * `<SystemRoot>\System32\WindowsPowerShell\v1.0\powershell.exe` — the same
 * derivation as `boundedIdentityProbe` — and settle within a finite window
 * (review rv-fin-sec F1; the old path discovered the interpreter with an
 * unbounded `spawnSync` and, on the deadline, killed the probe by NUMERIC
 * PID — `taskkill /PID` / `process.kill(pid)` — without ever settling the
 * promise when `close` never arrived, hanging the sandbox decision).
 *
 * Settlement: `close` (the normal path), `error` (spawn failure), or the
 * deadline. On the deadline the probe is killed on its HELD handle
 * (`child.kill()` — never a numeric-PID signal, which could hit whatever
 * tree then owns the PID) and the real `close` is waited for up to
 * PS_SCRIPT_CLOSE_WAIT_MS; the promise ALWAYS settles:
 *   - close within the wait → `{ ok: false, stdout, stderr, code: null,
 *     timedOut: true, unreaped: false }`
 *   - no close within the wait → the same shape with `unreaped: true` —
 *     the probe child may still be alive; the caller records the residue
 *     and the smoke retains its sandbox (no silent abandonment).
 * The close-wait timer is armed BEFORE `child.kill()`, matching
 * `boundedIdentityProbe`: Bun's `ChildProcess.kill` emits `error`
 * synchronously from its catch, and a synchronous `close`/`error` inside
 * `kill()` must settle through the already-armed timer — never leaving a
 * timer scheduled after settlement. After the deadline an `error` never
 * settles: it is recorded as the `killError` diagnostic (the timed-out
 * shape gains the field when one was recorded), and the real `close` or
 * the armed wait settles. The real `close` is the only reaping
 * observation — never inferred from a kill's return value or from exit
 * metadata. Listeners and timers are cleared on every path. Callers map a
 * timed-out result to an unknown identity / parent / image (fail closed:
 * no kill based on it). `spawn`, `spawnSync`, `setTimeout` and
 * `clearTimeout` are injectable seams so tests can drive the hang
 * deterministically; the reserved `spawnSync` seam exists so a re-added
 * spawnSync call on this path (a discovery or a numeric-PID kill) is
 * observable and red in the tests, never executed against the host.
 */
export async function psScript(file, args, timeoutMs = 20_000, options = {}) {
	const spawnFn = options.spawn ?? spawn;
	const spawnSyncFn = options.spawnSync ?? spawnSync;
	const setTimer = options.setTimeout ?? setTimeout;
	const clearTimer = options.clearTimeout ?? clearTimeout;
	void spawnSyncFn; // reserved seam: the path never calls spawnSync (tests assert this)
	return await new Promise((resolve) => {
		const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
		const exe = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
		const child = spawnFn(exe, ["-NoProfile", "-File", file, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timedOut = false;
		let killErrorText = null;
		let deadlineTimer = null;
		let closeWaitTimer = null;
		const clearAll = () => {
			if (deadlineTimer != null) clearTimer(deadlineTimer);
			if (closeWaitTimer != null) clearTimer(closeWaitTimer);
			deadlineTimer = null;
			closeWaitTimer = null;
			child.stdout?.removeAllListeners("data");
			child.stderr?.removeAllListeners("data");
			child.removeAllListeners("close");
			child.removeAllListeners("error");
		};
		const settle = (value) => {
			if (settled) return;
			settled = true;
			clearAll();
			resolve(value);
		};
		child.stdout?.on("data", (chunk) => (stdout += chunk));
		child.stderr?.on("data", (chunk) => (stderr += chunk));
		child.on("close", (code) => {
			settle(
				timedOut
					? {
							ok: false,
							stdout,
							stderr,
							code: null,
							timedOut: true,
							unreaped: false,
							...(killErrorText != null ? { killError: killErrorText } : {}),
						}
					: { ok: code === 0, stdout, stderr, code },
			);
		});
		child.on("error", (error) => {
			if (timedOut) {
				// After the deadline an error must NOT settle (it may be the
				// synchronous error Bun's ChildProcess.kill emits from its
				// catch): record it as a kill diagnostic; the real close or
				// the already-armed close-wait settles.
				killErrorText = errorText(error);
				return;
			}
			settle({ ok: false, stdout: "", stderr: `spawn failed: ${errorText(error)}`, code: null });
		});
		deadlineTimer = setTimer(() => {
			if (settled) return;
			timedOut = true;
			// The close-wait is armed BEFORE the kill — matching
			// boundedIdentityProbe (child-teardown.mjs): a synchronous
			// error/close emitted inside kill() (Bun's ChildProcess.kill
			// emits `error` synchronously in its catch) then settles through
			// the already-armed timer, never leaving a timer scheduled after
			// settlement.
			closeWaitTimer = setTimer(
				() => {
					closeWaitTimer = null;
					settle({
						ok: false,
						stdout,
						stderr,
						code: null,
						timedOut: true,
						unreaped: true,
						...(killErrorText != null ? { killError: killErrorText } : {}),
					});
				},
				PS_SCRIPT_CLOSE_WAIT_MS,
			);
			// HELD handle only: never `taskkill /PID <pid> /T /F` and never
			// `process.kill(pid, ...)` — a numeric-PID signal after the
			// deadline could kill whatever tree now owns the PID.
			try {
				child.kill();
			} catch (error) {
				// A synchronous kill failure is recorded as a diagnostic;
				// the verification timer installed above still decides
				// reaped vs unreaped.
				killErrorText = errorText(error);
			}
		}, timeoutMs);
	});
}

/**
 * Coerce one identity probe resolution into a documented shape: `out` is the
 * probe's resolved value, `error` the catch value when the probe threw (with
 * `out` undefined). A throwing or mis-shaped probe is `unknown`, never
 * `gone`. Shared by runSmoke's probeIdentity and killTreeFor so both fail
 * closed identically.
 */
function normalizeIdentity(out, error) {
	if (error != null) return { state: "unknown", error: `identity probe threw: ${errorText(error)}` };
	if (out?.state === "gone") return { state: "gone" };
	if (out?.state === "alive" && typeof out.id === "string" && out.id !== "") {
		return { state: "alive", id: out.id };
	}
	return { state: "unknown", error: String(out?.error ?? "identity probe returned an unexpected shape") };
}

/**
 * Factory for the cleanup process-tree kill. Returns `async (pid, ctx) =>
 * outcome` where `ctx.boundId` is the IMMUTABLE pre-signal identity id bound
 * by the caller's tryKill (a string, or null when the pre-signal identity was
 * unknown).
 *
 * POSIX (darwin/linux): the launcher is spawned detached, so its PID is its
 * own process-group leader and `-pid` is its group. For EACH escalation step
 * (SIGTERM, then SIGKILL) the bound identity is re-proved IMMEDIATELY before
 * that step's signals:
 *   - gone → stop, send nothing more, outcome `gone` (the owned process
 *       exited — success);
 *   - alive with a DIFFERENT id → stop, send nothing more, outcome
 *       `reused` (a different process now owns the PID; never signalled);
 *   - unknown (a throwing or indecisive probe) OR boundId == null → refuse
 *       to signal in that step, outcome `unknown` (honest failure: the PID
 *       cannot be re-proven as ours);
 *   - alive with the SAME id → the step's signal goes to the GROUP `-pid`
 *       only when the pid is proven to be its OWN process-group leader
 *       first (a bounded `ps -o pgid=` probe with the same runner and the
 *       same timeout as the identity probe; only `pgid === pid` permits the
 *       group signal). A delivered group signal needs no bare-pid call in
 *       that step: the leader `pid` is a member of its own group `pid`, so
 *       while a live process holds `pid` with the bound id, group `pid` can
 *       only be its group. An ESRCH on the group is normal when the leader
 *       proof went stale — recorded in `outcome.esrch`, not a failure
 *       (every other group error is recorded in `outcome.errors`), and the
 *       bare-pid fallback is a SEPARATE signal only sent after the bound
 *       identity is re-proved (gone/reused/unknown stop it exactly as at
 *       the step start). When the leader proof is unknown, a different pgid,
 *       or the probe fails, NO group signal is sent: the bare pid is
 *       signalled (the identity was re-proved at the step start — the same
 *       rule as the fallback) and `outcome.groupRefused` records the
 *       reason. Then wait (stepDelayMs) and continue (an owned survivor
 *       escalates to SIGKILL).
 * After SIGKILL one final probe classifies `gone` / `reused` / `survivor` /
 * `unknown` (survivor: still alive with the SAME bound id). `signals` lists
 * only DELIVERED signals; `groupSignalled` is true when at least one group
 * signal was delivered (runSmoke's group-empty check then requires the group
 * to be absent before crediting success); `groupRefused` names the reason a
 * step refused the group signal (leader proof unknown/different/failed), or
 * null.
 *
 * win32: a single `taskkill /PID <pid> /T /F` (unchanged ownership
 * semantics), bounded at TASKKILL_TIMEOUT_MS (the same value as
 * teardownChild's default taskkillTimeoutMs, scripts/child-teardown.mjs —
 * not a new budget). The exit status is captured in
 * `outcome.taskkillStatus` (kept, null when it cannot be known); the
 * `signals` entry is DELIVERED only when the run returned status 0 with no
 * error and no signal — a timeout (`timed out after 8000ms`), a non-zero
 * exit (`exited <n>`), a runner error (`spawn failed: …`, classified
 * strictly: an Error with a non-empty message or a non-empty string; any
 * other non-null error is `malformed runner error (<type>)` and fails
 * closed), or a missing/non-integer status (`no exit status`) all yield
 * outcome state `failed` with the precise error, never `signalled`.
 *
 * Residual limits (documented, fail closed): (a) a TOCTOU window between
 * the identity probe and `kill()` that Node cannot close (no pidfd support)
 * — the pgid leader proof has the same window; (b) darwin `ps -o lstart=`
 * has one-SECOND precision, so the darwin id now also requires the SAME
 * executable path (`<lstart>|<comm>`), which for the smoke lives inside the
 * unique mkdtemp sandbox — a false match needs the same second AND the same
 * image inside that sandbox; (c) when the group leader is gone the
 * remaining group members are NOT signalled (no signal on the old PGID
 * after leader exit) — runSmoke's group-empty check (the bounded post-kill
 * poll and the final verdict require the group to be absent before
 * crediting success) reports them instead. Native darwin/linux behaviour is
 * proven only by CI (this host is Windows).
 *
 * `kill`, `sleep`, `identityOf`, `runTaskkill` and `pgidOf` are injectable
 * so tests exercise the real sequence without touching real processes.
 */
export function killTreeFor(
	platform,
	{
		kill = (pid, signal) => process.kill(pid, signal),
		sleep: sleepFn = sleep,
		identityOf = null,
		runTaskkill = null,
		pgidOf = null,
		stepDelayMs = 500,
		settleDelayMs = 300,
	} = {},
) {
	// The default taskkill is bounded at TASKKILL_TIMEOUT_MS (the same value
	// as teardownChild's default taskkillTimeoutMs in
	// scripts/child-teardown.mjs — not a new budget): a stuck taskkill must
	// not block cleanup until the CI job timeout. The raw error and the
	// signal are passed through so the caller can classify the outcome
	// (spawnSync's timeout kill sets `signal`; a spawn failure sets
	// `error`).
	const defaultRunTaskkill = async (pid) => {
		const out = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
			timeout: TASKKILL_TIMEOUT_MS,
		});
		return { status: out.status, signal: out.signal ?? null, error: out.error ?? null };
	};
	// The default process-group probe (POSIX only): the same bounded `ps`
	// runner and the same timeout (none, like the darwin identity probe) —
	// `ps -o pgid= -p <pid>`; a missing pid (non-zero status), a spawn fault
	// or a malformed pgid is null (unknown → no group signal).
	const defaultPgidOf = async (pid) => {
		const out = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
		if (out.error != null || out.status !== 0) return null;
		return parsePid(String(out.stdout ?? ""));
	};
	const groupPgidOf = pgidOf ?? defaultPgidOf;
	const taskkill = runTaskkill ?? defaultRunTaskkill;
	const probe = async (pid) => {
		if (identityOf == null) return { state: "unknown", error: "identity probe unavailable" };
		let out;
		let error = null;
		try {
			out = await identityOf(pid);
		} catch (err) {
			error = err;
		}
		return normalizeIdentity(out, error);
	};
	const finish = (state, { signals, esrch, errors, groupSignalled }, detail, taskkillStatus = null, groupRefused = null) => ({
		platform,
		state,
		signals,
		esrch,
		errors,
		groupSignalled,
		detail,
		taskkillStatus,
		groupRefused,
	});
	if (platform === "win32") {
		// A single taskkill /T /F, with its exit status captured in the
		// outcome. S2's "unknown stops" rule applies here too (review
		// rv-fin-sec F3): the bound identity (ctx.boundId) is re-proved
		// IMMEDIATELY before the taskkill; a null bound, or a fresh probe
		// that is not `alive` with that id, REFUSES the taskkill (fail
		// closed — a numeric kill without a creation-time id is not an
		// owned kill). `signals` holds only DELIVERED signals, as on POSIX.
		return async (pid, ctx = {}) => {
			const boundId = ctx != null && typeof ctx.boundId === "string" && ctx.boundId !== "" ? ctx.boundId : null;
			const esrch = [];
			const errors = [];
			if (boundId == null) {
				return finish(
					"unknown",
					{ signals: [], esrch, errors, groupSignalled: false },
					"the pre-signal identity was unknown (boundId null); refused to signal",
				);
			}
			const now = await probe(pid);
			if (now.state === "gone") {
				return finish("gone", { signals: [], esrch, errors, groupSignalled: false }, "pid gone before taskkill");
			}
			if (now.state === "unknown") {
				return finish("unknown", { signals: [], esrch, errors, groupSignalled: false }, now.error);
			}
			if (now.id !== boundId) {
				return finish(
					"reused",
					{ signals: [], esrch, errors, groupSignalled: false },
					`pid now owned by id ${now.id} (bound ${boundId}); not signalled`,
				);
			}
			// Same identity as bound: exactly one taskkill /T /F. The signal
			// string is DELIVERED (counted in `signals`) only when the run
			// returned status 0 with no error and no signal; every other
			// outcome is state `failed` with a precise error and the
			// taskkill status kept (null when it cannot be known).
			const signals = [];
			let status = null;
			let signal = null;
			let runnerError = null;
			try {
				const result = await taskkill(pid);
				if (typeof result === "number") {
					status = result;
				} else if (result != null && typeof result === "object") {
					status = result.status;
					signal = result.signal ?? null;
					runnerError = result.error ?? null;
				}
			} catch (error) {
				runnerError = error;
			}
			// Runner error preflight (strict): an Error with a non-empty
			// message, or a non-empty string, is an error; any other non-null
			// error is malformed and fails closed.
			let errorTextValue = null;
			let malformed = false;
			if (runnerError != null) {
				if (runnerError instanceof Error && runnerError.message !== "") {
					errorTextValue = errorText(runnerError);
				} else if (typeof runnerError === "string" && runnerError !== "") {
					errorTextValue = runnerError;
				} else {
					malformed = true;
					errorTextValue = typeof runnerError;
				}
			}
			if (status !== null && (typeof status !== "number" || !Number.isInteger(status))) {
				// A non-integer status is no exit status (fail closed).
				status = null;
			}
			let failed = false;
			if (malformed) {
				failed = true;
				errors.push(`malformed runner error (${errorTextValue})`);
			} else if (errorTextValue !== null) {
				failed = true;
				const timedOut =
					signal != null ||
					(runnerError != null && typeof runnerError === "object" && "code" in runnerError &&
						(runnerError.code === "ERR_CHILD_PROCESS_TIMEOUT" || runnerError.code === "ETIMEDOUT")) ||
					(runnerError instanceof Error && /ETIMEDOUT/.test(runnerError.message));
				errors.push(timedOut ? `timed out after ${TASKKILL_TIMEOUT_MS}ms` : `spawn failed: ${errorTextValue}`);
			} else if (signal != null) {
				failed = true;
				errors.push(`timed out after ${TASKKILL_TIMEOUT_MS}ms`);
			} else if (status === null) {
				failed = true;
				errors.push("no exit status");
			} else if (status !== 0) {
				failed = true;
				errors.push(`exited ${status}`);
			} else {
				signals.push(`taskkill /PID ${pid} /T /F`);
			}
			await sleepFn(settleDelayMs);
			return finish(failed ? "failed" : "signalled", { signals, esrch, errors, groupSignalled: false }, null, status);
		};
	}
	return async (pid, ctx = {}) => {
		const boundId = ctx != null && typeof ctx.boundId === "string" && ctx.boundId !== "" ? ctx.boundId : null;
		const signals = [];
		const esrch = [];
		const errors = [];
		let groupSignalled = false;
		let groupRefused = null;
		// Every POSIX outcome carries the group-signal refusal reason (the
		// leader-gate refusal recorded above), if one was recorded.
		const finishPosix = (state, parts, detail) => finish(state, parts, detail, null, groupRefused);
		// `signals` holds only DELIVERED signals; details never say
		// "not signalled" once the list is non-empty.
		const sent = (extra) => (signals.length > 0 ? `signals already sent; ${extra}` : extra);
		const reuseDetail = (id) =>
			signals.length > 0
				? `refused further signals; pid now owned by id ${id} (bound ${boundId})`
				: `pid now owned by id ${id} (bound ${boundId}); not signalled`;
		// Deliver one signal; records the delivery in `signals` and any fault
		// in `esrch` (the expected ESRCH) or `errors` (everything else);
		// returns whether the signal was delivered.
		const sendTo = (target, signal) => {
			try {
				kill(target, signal);
				signals.push([target, signal]);
				return true;
			} catch (error) {
				const code = error != null && typeof error === "object" && "code" in error ? error.code : null;
				if (code === "ESRCH") {
					// Expected when the PID is not a group leader or the process
					// just exited: recorded, not a failure.
					esrch.push(`kill(${target}, ${signal}) ESRCH (not a group leader / already gone)`);
				} else {
					errors.push(`kill(${target}, ${signal}) failed: ${errorText(error)}`);
				}
				return false;
			}
		};
		for (const signal of ["SIGTERM", "SIGKILL"]) {
			// The bound identity is re-proved IMMEDIATELY before this step's
			// group signal: a recycled PID must not receive it.
			const now = await probe(pid);
			if (now.state === "gone") {
				return finishPosix("gone", { signals, esrch, errors, groupSignalled }, sent(`pid gone before the ${signal} step`));
			}
			if (now.state === "unknown") {
				return finishPosix("unknown", { signals, esrch, errors, groupSignalled }, sent(now.error));
			}
			// now.state === "alive"
			if (boundId == null) {
				return finishPosix(
					"unknown",
					{ signals, esrch, errors, groupSignalled },
					sent("the pre-signal identity was unknown (boundId null); refused to signal"),
				);
			}
			if (now.id !== boundId) {
				return finishPosix("reused", { signals, esrch, errors, groupSignalled }, reuseDetail(now.id));
			}
			// Same identity as bound: the group signal goes out only for a
			// proven own-group leader — a bounded `ps -o pgid=` probe (the
			// same runner and the same timeout as the identity probe); only
			// `pgid === pid` permits it. A delivered group signal needs no
			// bare-pid call in this step: the leader `pid` is a member of its
			// own group `pid`, so while a live process holds `pid` with the
			// bound id, group `pid` can only be its group.
			let leader = false;
			let pgidValue = null;
			let pgidFault = null;
			try {
				pgidValue = await groupPgidOf(pid);
			} catch (error) {
				pgidFault = error;
			}
			if (pgidFault == null && typeof pgidValue === "number" && pgidValue === pid) leader = true;
			if (!leader) {
				// Unknown, a different pgid, or a probe failure: NO group
				// signal. The bare pid is a separate signal and the identity
				// was re-proved at the step start (the `now` checks above) —
				// the same rule as the fallback below.
				if (groupRefused == null) {
					groupRefused = pgidFault != null
						? `process-group leader could not be proven for pid ${pid} (${errorText(pgidFault)}); group signal refused`
						: pgidValue == null
							? `process-group leader could not be proven for pid ${pid}; group signal refused`
							: `pid ${pid} is not a process-group leader (pgid ${pgidValue}); group signal refused`;
				}
				sendTo(pid, signal);
				await sleepFn(stepDelayMs);
				continue;
			}
			const groupDelivered = sendTo(-pid, signal);
			if (groupDelivered) {
				groupSignalled = true;
				await sleepFn(stepDelayMs);
				continue;
			}
			// The group call was NOT delivered (ESRCH: the leader proof went
			// stale, or an unexpected error recorded in esrch/errors): the
			// bare-pid fallback is a SEPARATE signal and needs a fresh
			// identity proof.
			const again = await probe(pid);
			if (again.state === "gone") {
				return finishPosix("gone", { signals, esrch, errors, groupSignalled }, sent(`pid gone before the ${signal} bare-pid fallback`));
			}
			if (again.state === "unknown") {
				return finishPosix("unknown", { signals, esrch, errors, groupSignalled }, sent(again.error));
			}
			if (again.id !== boundId) {
				return finishPosix("reused", { signals, esrch, errors, groupSignalled }, reuseDetail(again.id));
			}
			sendTo(pid, signal);
			await sleepFn(stepDelayMs);
		}
		// After SIGKILL: let the process settle, then one final probe
		// classifies the outcome.
		await sleepFn(settleDelayMs);
		const final = await probe(pid);
		if (final.state === "gone") {
			return finishPosix("gone", { signals, esrch, errors, groupSignalled }, sent("pid gone after SIGKILL"));
		}
		if (final.state === "alive") {
			if (final.id !== boundId) {
				return finishPosix("reused", { signals, esrch, errors, groupSignalled }, reuseDetail(final.id));
			}
			return finishPosix("survivor", { signals, esrch, errors, groupSignalled }, "pid still alive after SIGKILL with the bound identity");
		}
		return finishPosix("unknown", { signals, esrch, errors, groupSignalled }, sent(final.error));
	};
}

/**
 * POSIX group-existence probe for the post-kill group-empty check: signal 0
 * delivers nothing, it only asks the OS whether the group still has members.
 * `present` (including EPERM: a group we may not signal still exists),
 * `absent` (ESRCH: the OS proves the group has no members), or `unknown`
 * (any other fault — fail closed). Not used on win32 (taskkill /T walks the
 * process tree itself; there is no process-group signalling there).
 */
function defaultGroupExists(pgid) {
	try {
		process.kill(-pgid, 0);
		return "present";
	} catch (error) {
		const code = error != null && typeof error === "object" && "code" in error ? error.code : null;
		if (code === "ESRCH") return "absent";
		if (code === "EPERM") return "present";
		return "unknown";
	}
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
	// The default killTree is built below, once the identity probe exists: it
	// must re-prove the SAME bound identity runSmoke binds before every
	// escalation step. An injected hook keeps its legacy (pid)-only contract.
	let killTreeFn = hooks.killTree ?? null;
	// POSIX group-existence probe for the post-kill group-empty check (signal
	// 0; not used on win32 — there the taskkill /T kill is never a group
	// signal and the outcome's groupSignalled is false).
	const groupExistsFn = hooks.groupExists ?? defaultGroupExists;
	const listeningPid = hooks.listeningPid ?? findListeningPid;
	const spawnFn = hooks.spawn ?? spawn;
	const probeHealthFn = hooks.probeHealth ?? probeHealth;
	// Detailed health probe for failure diagnostics (SM-7): the same 3 s
	// bound, never throws; injectable for tests.
	const probeHealthDetailFn = hooks.probeHealthDetail ?? probeHealthDetail;
	const removeDirFn = hooks.removeDir ?? removeDir;
	const realpathFn = hooks.realpath ?? realpathSync.native;
	let parentOf = hooks.parentOf ?? null;
	let imageOf = hooks.imageOf ?? null;
	let identityOf = hooks.identityOf ?? null;

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
		cleanup: { ok: false, killed: [], refused: [], errors: [], reused: [], sandboxRemoved: false },
	};
	const cleanup = result.cleanup;
	let sandbox = null;
	let launchRoot = appDir;
	let child = null;
	let startMs = 0;
	let outBuf = "";
	let errBuf = "";
	// Residue from a timed-out PowerShell probe whose child was not reaped
	// (psScript `unreaped: true`): the probe child may still be alive inside
	// the sandbox, so the sandbox is retained and the residue reported (no
	// silent abandonment). Only the DEFAULT win32 probes record here; tests
	// that inject their own probes never do.
	const probeResidue = [];
	const noteProbeResidue = (kind, pid) => {
		probeResidue.push({ kind, pid });
	};

	// Failure-diagnostics sampling (SM-7): bounded sampling while the wait
	// loop is failing. `maybeSample` gates on SAMPLE_INTERVAL_MS (one sample
	// per 10 s) and a hard 14-sample cap (a 120 s run: 12 cadence + 1 final +
	// margin), so no new timeout can extend the run: every probe inside a
	// sample is an existing bounded probe (3 s health fetch, listeningPid,
	// inProcessTree, imageOf, isInsideAppDir — no command-line enumeration).
	const diagSamples = [];
	let lastSampleAt = -Infinity;
	const maybeSample = async (force = false) => {
		if (diagSamples.length >= 14) return;
		const now = Date.now();
		if (!force && now - lastSampleAt < SAMPLE_INTERVAL_MS) return;
		lastSampleAt = now;
		const portOwnerPid = listeningPid(args.port);
		const ownerInTree =
			parentOf != null && child != null && child.pid != null && portOwnerPid != null
				? await inProcessTree(portOwnerPid, child.pid, parentOf).catch(() => null)
				: null;
		// helpers: the port owner and the tray.pid candidate — each listed
		// only when it is inside the launched tree OR its image (imageOf) is
		// inside the canonical launch root (the existing isInsideAppDir).
		const candidatePids = [];
		if (portOwnerPid != null) candidatePids.push(portOwnerPid);
		if (result.trayPid != null && !candidatePids.includes(result.trayPid)) candidatePids.push(result.trayPid);
		const helpers = [];
		for (const pid of candidatePids) {
			let inTree = null;
			if (parentOf != null && child != null && child.pid != null) {
				try {
					inTree = await inProcessTree(pid, child.pid, parentOf);
				} catch {
					inTree = null;
				}
			}
			if (inTree === true) {
				helpers.push({ pid, inTree: true });
				continue;
			}
			if (imageOf != null) {
				try {
					const image = await imageOf(pid);
					const containmentPlatform =
						platform === "win32" || process.platform === "win32" ? "win32" : platform;
					if (image != null && isInsideAppDir(image, launchRoot, { platform: containmentPlatform, realpath: realpathFn })) {
						helpers.push({ pid, inTree: inTree === null ? null : false });
					}
				} catch {
					// image probe fault: not listed (fail closed, diagnostic only)
				}
			}
		}
		const health = await probeHealthDetailFn(args.port);
		diagSamples.push({ tMs: now - start, health, portOwnerPid, portOwnerInTree: ownerInTree, helpers });
	};

	/**
	 * Build the failure diagnostics (SM-7). Called ONLY when the result is
	 * not ok and BEFORE the cleanup removes the sandbox (sandboxFiles and
	 * logTails read the sandbox's .pinar and the extracted app log dir).
	 * Everything is bounded and read-only: ≤14 samples (already taken),
	 * ≤60 sandboxFiles { relPath, size }, log tails of ≤4096 bytes each with
	 * a ≤16 KiB total. Never throws: any fault degrades to an empty/absent
	 * entry (a diagnostic must never fail the run).
	 */
	const collectDiagnostics = async () => {
		const samples = [...diagSamples];
		const lastHealth =
			samples.length > 0
				? samples[samples.length - 1].health
				: await probeHealthDetailFn(args.port).catch(() => ({ ok: false, error: "health probe unavailable" }));
		// server.pid: the strict SM-6 parse (digits only, 1..2^31-1).
		let serverPid = { value: null, reason: "no sandbox" };
		if (sandbox != null) {
			const file = join(sandbox, ".pinar", "server.pid");
			let content = null;
			try {
				content = readFileSync(file, "utf8").trim();
			} catch {
				content = null;
			}
			if (content == null || content === "") {
				serverPid = { value: null, reason: "absent" };
			} else {
				const value = parsePid(content);
				serverPid =
					value != null
						? { value, reason: null }
						: { value: null, reason: `unparseable (strict digits 1..2147483647): ${content.slice(0, 80)}` };
			}
		}
		// sandboxFiles: { relPath, size } under the sandbox's .pinar and the
		// extracted app log dir — at most 60 entries, sorted for stability.
		const sandboxFiles = [];
		if (sandbox != null) {
			const walk = (root, prefix, files, cap) => {
				for (const entry of readdirSync(root, { withFileTypes: true })) {
					if (files.length >= cap) return;
					const relPath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
					const full = join(root, entry.name);
					if (entry.isDirectory()) walk(full, relPath, files, cap);
					else if (entry.isFile()) {
						let size = 0;
						try {
							size = statSync(full).size;
						} catch {
							size = 0;
						}
						files.push({ relPath, size });
					}
				}
				files.sort((a, b) => (a.relPath < b.relPath ? -1 : 1));
			};
			try {
				walk(join(sandbox, ".pinar"), ".pinar", sandboxFiles, 60);
			} catch {
				// .pinar missing: no sandbox files
			}
			// The extracted app log dir is the launcher's own dir (the
			// extracted payload's bin dir) — only when a payload was
			// extracted (launchRoot !== appDir).
			if (launchRoot !== appDir && result.launcher != null && sandboxFiles.length < 60) {
				try {
					walk(dirname(result.launcher), "applog", sandboxFiles, 60);
				} catch {
					// log dir not present: nothing to list
				}
			}
		}
		// logTails: the last ≤4096 bytes of each *.log under .pinar and the
		// extracted app.log; the TOTAL of all tails is ≤16 KiB.
		const logEntries = [];
		if (sandbox != null) {
			const pinarDir = join(sandbox, ".pinar");
			try {
				for (const entry of readdirSync(pinarDir, { withFileTypes: true })) {
					if (entry.isFile() && entry.name.toLowerCase().endsWith(".log")) {
						logEntries.push({ relPath: `.pinar/${entry.name}`, full: join(pinarDir, entry.name) });
					}
				}
			} catch {
				// no .pinar
			}
			if (launchRoot !== appDir && result.launcher != null) {
				const appLog = join(dirname(result.launcher), "app.log");
				try {
					if (existsSync(appLog) && statSync(appLog).isFile()) logEntries.push({ relPath: "applog/app.log", full: appLog });
				} catch {
					// no app log
				}
			}
		}
		const logTails = {};
		let tailBytes = 0;
		for (const entry of [...logEntries].sort((a, b) => (a.relPath < b.relPath ? -1 : 1))) {
			const text = readTailFile(entry.full, 4_096);
			if (text === "") continue;
			const bytes = Buffer.byteLength(text, "utf8");
			if (tailBytes > 0 && tailBytes + bytes > 16_384) continue;
			logTails[entry.relPath] = text;
			tailBytes += bytes;
		}
		return { samples, lastHealth, trayPid: result.trayPid, serverPid, sandboxFiles, logTails };
	};

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
		// Every platform-dependent builder in the run (identity probe, parent
		// probe, image probe, kill sequence, the containment decision below)
		// uses the SAME declared platform (hooks.platform ?? the host). A run
		// that declares a platform must never mix platform builders: on a
		// POSIX host a win32-declared run built on process.platform would
		// ignore the injected win32 runners, ownership would fail closed, and
		// nothing would be killed. Production declares nothing, so this is the
		// host platform — unchanged from before.
		parentOf = parentOf ?? defaultParentOf(platform, probeDir, noteProbeResidue, hooks.runPsWinParent ?? null);
		imageOf = imageOf ?? defaultImageOf(platform, probeDir, noteProbeResidue, hooks.runPsWinImage ?? null);
		// The default identity probe needs the sandbox (its .ps1 files live in
		// probeDir), so it is built here like parentOf/imageOf. An injected
		// win32 runner (hooks.runPsWin) drives the REAL win32 pipeline and
		// outranks the legacy isAlive-derived shim, which cannot express the
		// win32 probe result shapes (timedOut / unreaped). Hook sets that
		// inject the legacy isAlive but not identityOf fall back to a derived
		// probe so their existing behavior is preserved exactly.
		identityOf =
			identityOf ??
			(hooks.runPsWin != null
				? identityOfFor(platform, { probeDir, onResidue: noteProbeResidue, runPsWin: hooks.runPsWin })
				: hooks.isAlive != null
					? derivedFromIsAlive(isAlive)
					: identityOfFor(platform, { probeDir, onResidue: noteProbeResidue }));
		// Default kill sequence: the declared platform's steps, built with the
		// SAME platform and the SAME identity probe runSmoke uses, so each
		// escalation step re-proves the bound pre-signal identity before it
		// signals.
		killTreeFn = killTreeFn ?? killTreeFor(platform, { identityOf });

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
			// Failure-diagnostics sampling (SM-7): at most one sample per
			// SAMPLE_INTERVAL_MS while the run is failing (no new timeout —
			// the loop deadline is unchanged).
			await maybeSample();
		}
		if (!result.ok && result.reason == null) {
			result.reason = `timeout after ${args.timeoutMs}ms`;
		}
		// The final failure-diagnostics sample (SM-7): one forced sample
		// after the loop, still within the hard 14-sample cap.
		if (!result.ok) await maybeSample(true);
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
		// Failure diagnostics (SM-7): built BEFORE the cleanup removes the
		// sandbox (sandboxFiles/logTails read the sandbox's .pinar and the
		// extracted app log dir). Only on ok:false — a success JSON is
		// byte-for-byte unchanged.
		if (!result.ok) {
			try {
				result.diagnostics = await collectDiagnostics();
			} catch {
				// a diagnostics fault never fails the run: drop the field
				result.diagnostics = null;
				delete result.diagnostics;
			}
			if (result.diagnostics != null && args.log != null) {
				try {
					appendFileSync(args.log, `\n--- tray-smoke diagnostics ---\n${JSON.stringify(result.diagnostics, null, 2)}\n`);
				} catch {
					// a log-append fault never fails the run
				}
			}
		}
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
	 *      liveness and ownership are re-checked immediately before each kill),
	 *  (d) the PID's identity (an immutable creation-time id captured by
	 *      identityOf BEFORE the signal) is unchanged at the signal: a
	 *      different id means a different process now owns the PID and is
	 *      refused, never signalled,
	 *  (e) on POSIX every escalation step (the group `-pid` and the bare `pid`
	 *      SIGTERM/SIGKILL) re-verifies the bound identity IMMEDIATELY before it
	 *      is sent: gone stops the sequence (success); a different id stops it
	 *      (`reused`, never signalled); an unknown probe or a null bound id
	 *      refuses the step (`unknown`, honest failure — no signal is sent for a
	 *      step whose identity cannot be re-proven). Residual limits (fail
	 *      closed, documented): a TOCTOU window between the probe and kill() that
	 *      Node cannot close (no pidfd); darwin lstart has one-second precision.
	 *  (f) a pid whose kill was signalled through its process group is also
	 *      verified group-empty before success is credited: the bounded
	 *      post-kill poll's settled condition and the final verdict include
	 *      "group `pid` absent" (the injectable `groupExists` signal-0 probe):
	 *      present → a `cleanup.errors` entry and the sandbox is retained;
	 *      unknown → likewise (fail closed); absent → settled. NO signal is
	 *      ever sent on the old PGID after the leader is gone. Residual limits:
	 *      members that left the group (setsid/setpgid) are not covered; a
	 *      signal-0 probe to a recycled group after the real group fully exited
	 *      cannot harm anything and at worst yields a fail-closed error.
	 * The post-kill verdict is bound to that pre-signal identity: after the
	 * bounded poll, a killed PID that is gone, or alive with a DIFFERENT id,
	 * counts as the original process having exited (the reuse is reported in
	 * `cleanup.reused`, nothing is re-signalled); an alive PID with the SAME
	 * recorded id, an alive PID whose pre-signal identity is unknown, or an
	 * unknown probe is a failure recorded in `cleanup.errors`.
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
					// Path containment compares REAL fs paths (both sides are
					// canonicalized with the host's realpath). The comparison
					// itself follows the declared platform: a win32-declared run
					// uses win32 semantics on every host (win32 parses both /
					// and \ separators), and a win32 HOST always uses win32
					// semantics because its real fs paths cannot be parsed by
					// the posix module.
					const containmentPlatform =
						platform === "win32" || process.platform === "win32" ? "win32" : platform;
					if (isInsideAppDir(await imageOf(pid), launchRoot, { platform: containmentPlatform, realpath: realpathFn }))
						return "image";
				} catch {
					// image probe failed: not provably ours
				}
			}
			return null;
		};
		const killedIdentity = new Map();
		// Pids whose kill was signalled through their process group: before
		// success is credited their group must be proven empty (item f).
		const groupSignalledPids = new Set();
		// Set when an `unknown` killTree outcome leaves a signalled owned
		// process possibly alive, or a group-signalled pid's group still has
		// members / unknown state: the sandbox is retained (not removed) as
		// evidence.
		let retainSandboxOnIncomplete = false;
		/**
		 * identityOf wrapped so it never throws and never returns anything but
		 * the three documented shapes (a throwing or mis-shaped injected hook
		 * becomes `unknown`, which is never treated as gone).
		 */
		const probeIdentity = async (pid) => {
			if (identityOf == null) return { state: "unknown", error: "identity probe unavailable" };
			let out;
			let error = null;
			try {
				out = await identityOf(pid);
			} catch (err) {
				error = err;
			}
			return normalizeIdentity(out, error);
		};
		/**
		 * Post-kill settledness for a killed PID, bound to the identity
		 * recorded at its signal: gone is settled; alive with a DIFFERENT id
		 * is the original process gone (PID reused) and settled; alive with
		 * the same recorded id (or no recorded id) is not settled; an unknown
		 * probe is never settled (never treated as gone).
		 */
		const isSettled = (pid, now) => {
			if (now.state === "gone") return true;
			if (now.state === "alive") {
				const recorded = killedIdentity.get(pid) ?? null;
				return recorded != null && now.id !== recorded;
			}
			return false;
		};
		const tryKill = async (label, pid) => {
			// PID-reuse guard: re-check identity and ownership immediately
			// before signalling, and bind the pre-signal identity so the
			// post-kill verdict can separate a reused PID from a survivor.
			const before = await probeIdentity(pid);
			if (before.state === "gone") {
				cleanup.refused.push(`${label} pid ${pid}: not alive at cleanup`);
				return;
			}
			if ((await ownership(pid)) == null) {
				cleanup.refused.push(`${label} pid ${pid}: not alive or no longer inside the launched tree / ${launchRoot}`);
				return;
			}
			const atSignal = await probeIdentity(pid);
			if (atSignal.state === "gone") {
				cleanup.refused.push(`${label} pid ${pid}: not alive at cleanup`);
				return;
			}
			if (before.state === "alive" && atSignal.state === "alive" && before.id !== atSignal.id) {
				cleanup.refused.push(
					`${label} pid ${pid}: identity changed between the ownership check and the signal (${before.id} -> ${atSignal.id}); not signalled`,
				);
				return;
			}
			// The bound pre-signal identity (null when the probe could not
			// prove one): the default killTree re-verifies it before EVERY
			// escalation step and refuses to signal a step it cannot match
			// (fail closed); an injected killTree hook keeps its legacy
			// (pid)-only contract and returns no outcome.
			const bound = atSignal.state === "alive" ? atSignal.id : before.state === "alive" ? before.id : null;
			let outcome;
			try {
				outcome = await killTreeFn(pid, { boundId: bound });
			} catch (error) {
				cleanup.errors.push(`killTree(${label} pid ${pid}) failed: ${errorText(error)}`);
				return;
			}
			if (outcome == null) {
				// Legacy injected hook (pid only, no outcome): it was called,
				// so the pre-outcome recording applies unchanged.
				cleanup.killed.push(pid);
				killedIdentity.set(pid, bound);
				return;
			}
			const signalled = Array.isArray(outcome.signals) && outcome.signals.length > 0;
			// Only a pid that actually received a signal joins the post-kill
			// verdict and its bounded poll; a group-signalled pid also joins the
			// group-empty check (item f).
			if (signalled) {
				cleanup.killed.push(pid);
				killedIdentity.set(pid, bound);
				if (outcome.groupSignalled === true) groupSignalledPids.add(pid);
			}
			if (outcome.state === "reused") {
				// When signals were sent the outcome detail already says
				// "refused further signals; …" — never append "not signalled"
				// in that case.
				cleanup.reused.push(
					signalled
						? `killTree(${label} pid ${pid}): ${outcome.detail ?? "the pid is now owned by a different process"}`
						: `killTree(${label} pid ${pid}): the pid is now owned by a different process${
								outcome.detail != null ? ` (${outcome.detail})` : ""
							}; not signalled`,
				);
			}
			if (outcome.state === "unknown") {
				cleanup.errors.push(
					`killTree(${label} pid ${pid}) incomplete: identity unknown, no further signals sent${
						outcome.detail != null ? `: ${outcome.detail}` : ""
					}`,
				);
				// A signalled owned process may still be alive: retain the
				// sandbox as evidence instead of removing it.
				if (signalled) retainSandboxOnIncomplete = true;
			}
			// `survivor` (alive with the bound id after SIGKILL) is recorded by
			// the bounded post-kill verdict as `still alive after cleanup`.
			// A `failed` state is NEVER counted as killed (SM-1): its precise
			// error text already lives in outcome.errors; the legacy injected
			// hooks that expose only the status (no errors entry) keep the
			// explicit taskkill-status report.
			if (
				typeof outcome.taskkillStatus === "number" &&
				outcome.taskkillStatus !== 0 &&
				outcome.state !== "failed"
			) {
				cleanup.errors.push(`killTree(${label} pid ${pid}) incomplete: taskkill exited ${outcome.taskkillStatus}`);
			}
			if (Array.isArray(outcome.errors) && outcome.errors.length > 0) {
				cleanup.errors.push(`killTree(${label} pid ${pid}) incomplete: ${outcome.errors.join("; ")}`);
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
					if (!isSettled(pid, await probeIdentity(pid))) {
						settled = false;
						break;
					}
				}
				if (settled && spawned) {
					settled = listeningPid(args.port) == null;
				}
				// A group-signalled pid is only settled when its group is proven
				// EMPTY: a surviving group member must not be credited as whole-
				// tree cleanup (item f).
				if (settled && groupSignalledPids.size > 0) {
					for (const pid of groupSignalledPids) {
						if (groupExistsFn(pid) !== "absent") {
							settled = false;
							break;
						}
					}
				}
				if (settled || Date.now() >= pollDeadline) break;
				await sleep(250);
			}
			// Final verdict: one more identity probe after the poll (a late
			// death or a late reuse is credited). No branch here signals
			// anything.
			for (const pid of cleanup.killed) {
				const recorded = killedIdentity.get(pid) ?? null;
				const now = await probeIdentity(pid);
				if (now.state === "gone") continue; // settled
				if (now.state === "alive" && recorded != null && now.id === recorded) {
					cleanup.errors.push(`pid ${pid} still alive after cleanup`);
					continue;
				}
				if (now.state === "alive" && recorded == null) {
					cleanup.errors.push(
						`pid ${pid} is alive after cleanup and its pre-signal identity is unknown; cannot prove the original process exited`,
					);
					continue;
				}
				if (now.state === "unknown") {
					cleanup.errors.push(`pid ${pid} liveness unknown after cleanup: ${now.error}`);
					continue;
				}
				// alive with a different id: the original process exited and the
				// OS handed the PID to a different process — settled, reported,
				// never re-signalled.
				cleanup.reused.push(
					`pid ${pid}: original process (id ${recorded}) exited; the pid now belongs to a different process (id ${now.id}); not signalled`,
				);
			}
			if (spawned) {
				// Final group-empty verdict for group-signalled pids, AFTER all
				// tryKill calls (so a helper killed later is not misreported):
				// present or unknown both fail closed and retain the sandbox.
				for (const pid of groupSignalledPids) {
					const groupState = groupExistsFn(pid);
					if (groupState === "present") {
						cleanup.errors.push(`process group ${pid} still has members after cleanup`);
						retainSandboxOnIncomplete = true;
					} else if (groupState === "unknown") {
						cleanup.errors.push(
							`process group ${pid} state unknown after cleanup: the group-existence probe could not decide`,
						);
						retainSandboxOnIncomplete = true;
					}
				}
				const lingering = listeningPid(args.port);
				if (lingering != null) cleanup.errors.push(`port ${args.port} still held by pid ${lingering} after cleanup`);
			}
		}
		if (probeResidueKeepsSandbox(probeResidue, cleanup)) {
			// An unreaped probe child may still hold files inside the sandbox.
			retainSandboxOnIncomplete = true;
		}
		if (sandbox != null) {
			if (args.keepHome || retainSandboxOnIncomplete) {
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

/**
 * Bounded detailed /api/health probe for failure diagnostics (SM-7): the
 * SAME existing 3 s bound (injectable `timeoutMs` keeps it bounded),
 * never throws. Success: `{ ok: true, status, service }` (service null when
 * the body is not the pinar shape); failure: `{ ok: false, error }` with
 * the error text truncated to 200 chars — a failure must not leak a
 * response body or secret into the diagnostics.
 */
export async function probeHealthDetail(port, timeoutMs = 3_000) {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		let body = null;
		try {
			body = await response.json();
		} catch {
			// a non-JSON body is itself the diagnostic fact (body stays null)
		}
		const service =
			body != null && typeof body === "object" && typeof body.service === "string" ? body.service : null;
		return { ok: response.ok && isHealthyHealth(body), status: response.status, service };
	} catch (error) {
		return { ok: false, status: null, service: null, error: String(error instanceof Error ? error.message : error).slice(0, 200) };
	}
}

/** Read the last `bytes` of a file as utf8 (SM-7 log tails); "" on any fault. */
export function readTailFile(file, bytes) {
	try {
		const size = statSync(file).size;
		const start = size > bytes ? size - bytes : 0;
		const buffer = Buffer.alloc(Math.min(size, bytes));
		const fd = openSync(file, "r");
		try {
			readSync(fd, buffer, 0, buffer.length, start);
		} finally {
			closeSync(fd);
		}
		return buffer.toString("utf8");
	} catch {
		return "";
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

/**
 * A timed-out probe whose child was not reaped is residue (a `psScript`
 * `unreaped: true` result): the probe child may still be running inside
 * the sandbox, so the smoke must retain the sandbox and report the residue
 * — never remove it silently. Records the residue in `cleanup.errors` and
 * returns true when the sandbox must be kept.
 */
export function probeResidueKeepsSandbox(probeResidue, cleanup) {
	if (probeResidue.length === 0) return false;
	for (const entry of probeResidue) {
		cleanup.errors.push(
			`probe residue: the ${entry.kind} probe for pid ${entry.pid} hit its deadline and its child was not reaped (it may still be running); the sandbox is retained`,
		);
	}
	return true;
}

/**
 * `platform` is the declared platform of the run (hooks.platform ?? the
 * host): the win32 branch only exists for win32-declared runs, so a POSIX
 * host never probes the host's `ps` for a win32 run.
 */
function defaultParentOf(platform, probeDir, onResidue = null, runPsWin = null) {
	if (platform === "win32") {
		// The runner is injectable (tests) — the same seam pattern as the
		// identity/image probes; the default writes the probe .ps1 into
		// probeDir and runs it through psScript.
		const run =
			runPsWin ??
			((pid) => {
				mkdirSync(probeDir, { recursive: true });
				const file = join(probeDir, `parent-${pid}.ps1`);
				writeFileSync(
					file,
					`param([int]$Target)\n` +
						`$p = Get-CimInstance Win32_Process -Filter "ProcessId=$Target" -ErrorAction SilentlyContinue\n` +
						`if ($null -eq $p) { exit 1 }\n` +
						`Write-Output $p.ParentProcessId\n`,
				);
				return psScript(file, [String(pid)]);
			});
		return async (pid) => {
			const out = await run(pid);
			// A timed-out probe whose child was not reaped is residue: the
			// caller (runSmoke) retains its sandbox and reports it.
			if (out.unreaped === true) onResidue?.("parent", pid);
			const value = parsePid(out.stdout);
			return out.ok && value !== null ? value : null;
		};
	}
	return async (pid) => {
		const out = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" });
		const value = parsePid(String(out.stdout ?? ""));
		return value !== null ? value : null;
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
	return { image: fields[0], pid: parsePid(fields[1]) };
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

/**
 * Windows image lookup: the raw CIM ExecutablePath probe through PowerShell
 * (the `psScript` result — the caller maps it to a path or null).
 */
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
		return psScript(file, [String(pid)]);
	};
}

/**
 * Platform-selected image-path resolver for cleanup:
 *   win32  → CIM ExecutablePath probe (PowerShell)
 *   darwin → `ps -p <pid> -o comm=` (trimmed; empty output → null)
 *   linux  → /proc/<pid>/exe
 * `platform`, the `ps`/`runPsWin` runners, `procDir` and `onResidue` are
 * injectable so tests can drive any branch without spawning real
 * processes.
 */
export function imageOfFor(platform, { probeDir, ps, procDir = "/proc", onResidue = null, runPsWin = null } = {}) {
	if (platform === "win32") {
		const run = runPsWin ?? imageOfWin32(probeDir);
		return async (pid) => {
			const out = await run(pid);
			// A timed-out probe whose child was not reaped is residue: the
			// caller (runSmoke) retains its sandbox and reports it.
			if (out.unreaped === true) onResidue?.("image", pid);
			const path = String(out.stdout ?? "").trim();
			return out.ok && path.length > 0 ? path : null;
		};
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

function defaultImageOf(platform, probeDir, onResidue = null, runPsWin = null) {
	return imageOfFor(platform, { probeDir, onResidue, runPsWin });
}

/**
 * Process-identity result: exactly one of
 *   `{ state: "alive", id }`   — a process with this PID exists; `id` is an
 *                                immutable identity (its creation time)
 *   `{ state: "gone" }`        — the OS proved no process has this PID
 *                                (or it is already a zombie/defunct)
 *   `{ state: "unknown", error }` — the probe could not decide (spawn
 *                                failure, timeout, permission, parse failure)
 */

/** Map a win32 CIM probe result ({ code, stdout, stderr }) to an identity. */
function mapWin32Identity(out) {
	// A timed-out probe (a `psScript` deadline) is unknown by construction —
	// its code is null and it is never mapped to alive or gone.
	if (out?.timedOut === true) {
		return { state: "unknown", error: `identity probe timed out (unreaped: ${out.unreaped === true ? "yes" : "no"})` };
	}
	const digits = String(out?.stdout ?? "").trim();
	if (out?.code === 3) return { state: "gone" };
	if (out?.code === 0 && /^\d+$/.test(digits)) return { state: "alive", id: digits };
	return { state: "unknown", error: `identity probe exited ${String(out?.code)}` };
}

/**
 * Windows identity lookup: the raw CIM CreationDate probe through
 * PowerShell (the `psScript` result — the caller maps it with
 * `mapWin32Identity`).
 */
function identityOfWin32(probeDir) {
	return async (pid) => {
		mkdirSync(probeDir, { recursive: true });
		const file = join(probeDir, `identity-${pid}.ps1`);
		writeFileSync(
			file,
			`param([int]$Target)\n` +
				`$ErrorActionPreference='Stop'\n` +
				`try { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$Target" } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 2 }\n` +
				`if ($null -eq $p) { exit 3 }\n` +
				`if ($null -eq $p.CreationDate) { exit 4 }\n` +
				`Write-Output $p.CreationDate.ToFileTimeUtc()\n`,
		);
		return psScript(file, [String(pid)]);
	};
}

/**
 * Platform-selected process-identity probe for the cleanup kills:
 *   win32  → CIM CreationDate file time (PowerShell); exit 3 proves the PID
 *            no longer exists, exit 0 + a run of digits is the immutable id
 *   darwin → `ps -o stat=,lstart=,comm=`: a `Z` stat is gone; otherwise the
 *            id is `<lstart>|<executable path>` (the lstart text has one-
 *            second precision, so the id also binds the executable path,
 *            which for the smoke lives inside the unique mkdtemp sandbox);
 *            a missing/empty path is unknown (fail closed); status 1 with
 *            empty output proves gone
 *   linux  → /proc/<pid>/stat: ENOENT/ESRCH prove gone; state field Z/X is
 *            gone; stat field 22 (starttime) is the id
 * Every branch resolves one of the documented identity shapes and never
 * throws. `runPsWin`, `runPs` and `procDir` are injectable so tests can
 * drive any branch without spawning real processes.
 */
export function identityOfFor(platform, { probeDir, runPs, runPsWin, procDir = "/proc", onResidue = null } = {}) {
	if (platform === "win32") {
		// One choke point for both the injected and the default runner: a
		// timed-out probe whose child was not reaped is residue — the caller
		// (runSmoke) retains its sandbox and reports it — and every result
		// is mapped through mapWin32Identity (a timeout is unknown).
		const run = runPsWin ?? identityOfWin32(probeDir);
		return async (pid) => {
			let out;
			try {
				out = await run(pid);
			} catch {
				return { state: "unknown", error: "identity runner threw" };
			}
			if (out?.unreaped === true) onResidue?.("identity", pid);
			return mapWin32Identity(out);
		};
	}
	if (platform === "darwin") {
		// The SAME bounded `ps` runner and timeout as the group-leader probe:
		// stat + lstart (5 tokens) + comm (macOS prints the full executable
		// path, which may contain spaces — parse stat and the 5 lstart tokens
		// first and take the remainder as the path).
		const run =
			runPs ??
			((pid) =>
				spawnSync("ps", ["-o", "stat=,lstart=,comm=", "-p", String(pid)], {
					encoding: "utf8",
				}));
		return async (pid) => {
			const out = run(pid);
			if (out.error != null) return { state: "unknown", error: `ps failed: ${String(out.error)}` };
			const trimmed = String(out.stdout ?? "").trim();
			if (out.status === 0 && trimmed !== "") {
				const tokens = trimmed.split(/\s+/);
				if (tokens.length < 2) return { state: "unknown", error: "unparsable ps output (no stat field)" };
				const stat = tokens[0];
				if (stat.startsWith("Z")) return { state: "gone" };
				if (tokens.length < 7) {
					return { state: "unknown", error: "unparsable ps output (no executable path); failing closed" };
				}
				const lstart = tokens.slice(1, 6).join(" ");
				const comm = tokens.slice(6).join(" ").trim();
				if (comm === "") return { state: "unknown", error: "unparsable ps output (empty executable path); failing closed" };
				return { state: "alive", id: `${lstart}|${comm}` };
			}
			if (out.status === 1 && trimmed === "") return { state: "gone" };
			return { state: "unknown", error: `ps exited ${String(out.status)} with output ${JSON.stringify(trimmed)}` };
		};
	}
	return async (pid) => {
		let text;
		try {
			text = readFileSync(join(procDir, String(pid), "stat"), "utf8");
		} catch (error) {
			const code = error instanceof Error && "code" in error ? error.code : undefined;
			if (code === "ENOENT" || code === "ESRCH") return { state: "gone" };
			return { state: "unknown", error: `cannot read ${procDir}/${pid}/stat: ${errorText(error)}` };
		}
		// The comm field is parenthesized and may itself contain ") (" — the
		// numeric fields start after the LAST ")".
		const closeParen = text.lastIndexOf(")");
		if (closeParen < 0) return { state: "unknown", error: "unparsable /proc stat (no closing paren)" };
		const fields = text.slice(closeParen + 1).trim().split(/\s+/);
		if (fields.length < 2) return { state: "unknown", error: "unparsable /proc stat (no state field)" };
		if (fields[0] === "Z" || fields[0] === "X") return { state: "gone" };
		// Fields after ")" are stat fields 3+; field 22 (starttime) is index 19.
		const starttime = fields[19];
		if (starttime == null || !/^\d+$/.test(starttime)) {
			return { state: "unknown", error: "unparsable /proc stat (no starttime)" };
		}
		return { state: "alive", id: starttime };
	};
}

/**
 * Test-compat only: derives the identity verdict from the legacy isAlive
 * hook. It cannot see PID reuse (a reused PID still reports alive), so it
 * exists only so hook sets that inject isAlive but not identityOf keep
 * their meaning. Never throws.
 */
function derivedFromIsAlive(isAlive) {
	return async (pid) => {
		let alive;
		try {
			alive = await isAlive(pid);
		} catch (error) {
			return { state: "unknown", error: `isAlive threw: ${errorText(error)}` };
		}
		return alive ? { state: "alive", id: "alive" } : { state: "gone" };
	};
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
		const pid = parsePid(cols[cols.length - 1] ?? "");
		if (pid !== null) return pid;
	}
	return null;
}

function findListeningPid(port) {
	if (process.platform === "win32") {
		const out = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
		return parseNetstatListeningPid(out.stdout, port);
	}
	const out = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
	const pid = parsePid(String(out.stdout ?? "").trim().split(/\s+/)[0]);
	return pid !== null ? pid : null;
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
			cleanup: { ok: false, killed: [], refused: [], errors: [reason], reused: [], sandboxRemoved: false },
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
