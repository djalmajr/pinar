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
 * Materialize a wrapper payload (a `Resources/<hash>.tar.zst`) into
 * `destDir` without ever trusting its bytes: read the zstd frame header
 * FIRST and reject, before decompressing anything, when the first normal
 * frame declares a content size above the cap (no expansion is ever
 * allocated); then decompress in-process (Bun.zstdDecompressSync by
 * default — no `zstd` binary, no bsdtar zstd assumption) and re-check the
 * ACTUAL decompressed size against the cap: that is the only size guard
 * when the frame declares no content size (zstdDeclaredContentSize is
 * null — e.g. a non-single-segment frame without an FCS field, or a
 * skippable frame before the real one, or multiple frames where the total
 * exceeds the first frame's declared size), and in that case
 * Bun.zstdDecompressSync has already allocated the full output before the
 * comparison — an accepted limitation because the payload is this
 * project's own self-built build output (trusted). Then validate the plain
 * tar headers BEFORE anything is written (see validatePlainTar), write the
 * plain tar to the caller's sandbox (NOT inside `destDir`; default:
 * `dirname(destDir)`), extract it with the platform tar (args exactly
 * `[-xf, <plainTar>, -C, destDir]`, no -P) and post-check every extracted
 * entry with lstat/realpath. Any violation throws (fail closed).
 * `options.platform` selects the tar the way `runSmoke`'s platform does;
 * `options.tarCommand` overrides it (tests only). Test-only options:
 * `maxDecompressedBytes` / `maxEntries` narrow the production caps
 * (positive integer, never above the default, otherwise throw) and
 * `zstdDecompress` replaces the decompressor (default:
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
	// Fail-closed pre-check: a declared content size above the cap is
	// rejected BEFORE decompressing, so the expansion is never allocated.
	// When the first frame declares no content size (null), the
	// post-decompression check below is the only size guard.
	const declared = zstdDeclaredContentSize(compressed);
	if (declared !== null && declared > cap) {
		throw new Error(
			`wrapper payload declares a zstd content size of ${declared} bytes, above the ${cap} byte decompression cap; rejected before decompression`,
		);
	}
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
 *   - alive with the SAME id → signal the step's signal to the GROUP `-pid`
 *       only (an ESRCH on the group is normal when the PID is not a group
 *       leader — recorded in `outcome.esrch`, not a failure; every other
 *       group error is recorded in `outcome.errors`). A delivered group
 *       signal needs no bare-pid call in that step: the leader `pid` is a
 *       member of its own group `pid`, so while a live process holds `pid`
 *       with the bound id, group `pid` can only be its group. If the group
 *       call was NOT delivered, the bare-pid fallback is a SEPARATE signal
 *       and is only sent after the bound identity is re-proved (gone/reused/
 *       unknown stop it exactly as at the step start), then wait
 *       (stepDelayMs) and continue (an owned survivor escalates to SIGKILL).
 * After SIGKILL one final probe classifies `gone` / `reused` / `survivor` /
 * `unknown` (survivor: still alive with the SAME bound id). `signals` lists
 * only DELIVERED signals; `groupSignalled` is true when at least one group
 * signal was delivered (runSmoke's group-empty check then requires the group
 * to be absent before crediting success).
 *
 * win32: a single `taskkill /PID <pid> /T /F` (unchanged ownership
 * semantics); the exit status is captured in `outcome.taskkillStatus`
 * (non-zero → recorded by the caller; a spawn failure lands in
 * `outcome.errors`; never thrown).
 *
 * Residual limits (documented, fail closed): (a) a TOCTOU window between the
 * identity probe and `kill()` that Node cannot close (no pidfd support);
 * (b) darwin `ps -o lstart=` has one-SECOND precision, so a PID reuse within
 * the same second with the same start text is indistinguishable; (c) when
 * the group leader is gone the remaining group members are NOT signalled
 * (no signal on the old PGID after leader exit) — runSmoke's group-empty
 * check (the bounded post-kill poll and the final verdict require the group
 * to be absent before crediting success) reports them instead.
 *
 * `kill`, `sleep`, `identityOf` and `runTaskkill` are injectable so tests
 * exercise the real sequence without touching real processes.
 */
export function killTreeFor(
	platform,
	{
		kill = (pid, signal) => process.kill(pid, signal),
		sleep: sleepFn = sleep,
		identityOf = null,
		runTaskkill = null,
		stepDelayMs = 500,
		settleDelayMs = 300,
	} = {},
) {
	const defaultRunTaskkill = async (pid) => {
		const out = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
		if (out.error != null) return { status: null, error: errorText(out.error) };
		return { status: out.status };
	};
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
	const finish = (state, { signals, esrch, errors, groupSignalled }, detail, taskkillStatus = null) => ({
		platform,
		state,
		signals,
		esrch,
		errors,
		groupSignalled,
		detail,
		taskkillStatus,
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
			// Same identity as bound: exactly one taskkill /T /F.
			const signals = [`taskkill /PID ${pid} /T /F`];
			let status = null;
			try {
				const result = await taskkill(pid);
				if (typeof result === "number") {
					status = result;
				} else if (result != null && typeof result === "object") {
					status = typeof result.status === "number" ? result.status : null;
					if (result.error != null) errors.push(String(result.error));
				}
			} catch (error) {
				errors.push(`taskkill invocation failed: ${errorText(error)}`);
			}
			await sleepFn(settleDelayMs);
			return finish("signalled", { signals, esrch, errors, groupSignalled: false }, null, status);
		};
	}
	return async (pid, ctx = {}) => {
		const boundId = ctx != null && typeof ctx.boundId === "string" && ctx.boundId !== "" ? ctx.boundId : null;
		const signals = [];
		const esrch = [];
		const errors = [];
		let groupSignalled = false;
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
				return finish("gone", { signals, esrch, errors, groupSignalled }, sent(`pid gone before the ${signal} step`));
			}
			if (now.state === "unknown") {
				return finish("unknown", { signals, esrch, errors, groupSignalled }, sent(now.error));
			}
			// now.state === "alive"
			if (boundId == null) {
				return finish(
					"unknown",
					{ signals, esrch, errors, groupSignalled },
					sent("the pre-signal identity was unknown (boundId null); refused to signal"),
				);
			}
			if (now.id !== boundId) {
				return finish("reused", { signals, esrch, errors, groupSignalled }, reuseDetail(now.id));
			}
			// Same identity as bound: signal the GROUP only. A delivered group
			// signal needs no bare-pid call in this step: the leader `pid` is a
			// member of its own group `pid`, so while a live process holds
			// `pid` with the bound id, group `pid` can only be its group.
			const groupDelivered = sendTo(-pid, signal);
			if (groupDelivered) {
				groupSignalled = true;
				await sleepFn(stepDelayMs);
				continue;
			}
			// The group call was NOT delivered (ESRCH: not a group leader, or
			// an unexpected error recorded in esrch/errors): the bare-pid
			// fallback is a SEPARATE signal and needs a fresh identity proof.
			const again = await probe(pid);
			if (again.state === "gone") {
				return finish("gone", { signals, esrch, errors, groupSignalled }, sent(`pid gone before the ${signal} bare-pid fallback`));
			}
			if (again.state === "unknown") {
				return finish("unknown", { signals, esrch, errors, groupSignalled }, sent(again.error));
			}
			if (again.id !== boundId) {
				return finish("reused", { signals, esrch, errors, groupSignalled }, reuseDetail(again.id));
			}
			sendTo(pid, signal);
			await sleepFn(stepDelayMs);
		}
		// After SIGKILL: let the process settle, then one final probe
		// classifies the outcome.
		await sleepFn(settleDelayMs);
		const final = await probe(pid);
		if (final.state === "gone") {
			return finish("gone", { signals, esrch, errors, groupSignalled }, sent("pid gone after SIGKILL"));
		}
		if (final.state === "alive") {
			if (final.id !== boundId) {
				return finish("reused", { signals, esrch, errors, groupSignalled }, reuseDetail(final.id));
			}
			return finish("survivor", { signals, esrch, errors, groupSignalled }, "pid still alive after SIGKILL with the bound identity");
		}
		return finish("unknown", { signals, esrch, errors, groupSignalled }, sent(final.error));
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
		parentOf = parentOf ?? defaultParentOf(probeDir, noteProbeResidue, hooks.runPsWinParent ?? null);
		imageOf = imageOf ?? defaultImageOf(probeDir, noteProbeResidue, hooks.runPsWinImage ?? null);
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
				? identityOfFor(process.platform, { probeDir, onResidue: noteProbeResidue, runPsWin: hooks.runPsWin })
				: hooks.isAlive != null
					? derivedFromIsAlive(isAlive)
					: identityOfFor(process.platform, { probeDir, onResidue: noteProbeResidue }));
		// Production default: the real host-platform kill sequence, built with
		// the SAME identity probe runSmoke uses, so each escalation step
		// re-proves the bound pre-signal identity before it signals.
		killTreeFn = killTreeFn ?? killTreeFor(process.platform, { identityOf });

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
			if (typeof outcome.taskkillStatus === "number" && outcome.taskkillStatus !== 0) {
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

function defaultParentOf(probeDir, onResidue = null, runPsWin = null) {
	if (process.platform === "win32") {
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

function defaultImageOf(probeDir, onResidue = null, runPsWin = null) {
	return imageOfFor(process.platform, { probeDir, onResidue, runPsWin });
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
 *   darwin → `ps -o stat=,lstart=`: a `Z` stat is gone, otherwise the lstart
 *            text is the id; status 1 with empty output proves gone
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
		const run =
			runPs ??
			((pid) =>
				spawnSync("ps", ["-o", "stat=,lstart=", "-p", String(pid)], {
					encoding: "utf8",
				}));
		return async (pid) => {
			const out = run(pid);
			if (out.error != null) return { state: "unknown", error: `ps failed: ${String(out.error)}` };
			const trimmed = String(out.stdout ?? "").trim();
			if (out.status === 0 && trimmed !== "") {
				const match = trimmed.match(/^\S+\s+/);
				if (match == null) return { state: "unknown", error: "unparsable ps output (no lstart field)" };
				const stat = trimmed.slice(0, match[0].length).trim();
				if (stat.startsWith("Z")) return { state: "gone" };
				return { state: "alive", id: trimmed.slice(match[0].length).trim() };
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
