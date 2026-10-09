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
 * Exit 0 only on success; the final stdout line is a single JSON object:
 *   { ok, platform, appDir, launcher, port, jsExecuted, trayPid, health,
 *     elapsedMs, reason }
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
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PORT = 17390;
export const DEFAULT_TIMEOUT_MS = 90_000;
export const DEFAULT_POLL_MS = 1_000;

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
		const payload = entries.find((entry) => entry.endsWith(".tar.zst"));
		if (payload != null) return join(resources, payload);
	}
	return null;
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
 * real platform probes below.
 */
export async function runSmoke(args, hooks = {}) {
	// The default parent/image probes write their .ps1 into the sandbox so the
	// sandbox cleanup removes them; tests inject their own probes (and spawn).
	const isAlive = hooks.isAlive ?? defaultIsAlive();
	const killTreeFn = hooks.killTree ?? killTree;
	const listeningPid = hooks.listeningPid ?? findListeningPid;
	const spawnFn = hooks.spawn ?? spawn;
	let parentOf = hooks.parentOf ?? null;
	let imageOf = hooks.imageOf ?? null;

	const start = Date.now();
	const platform = process.platform;
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
	};
	let sandbox = null;
	let launchRoot = appDir;
	let child = null;
	let outBuf = "";
	let errBuf = "";

	try {
		sandbox = mkdtempSync(join(tmpdir(), "pinar-tray-smoke-"));
		const probeDir = join(sandbox, "probes");
		mkdirSync(probeDir, { recursive: true });
		parentOf = parentOf ?? defaultParentOf(probeDir);
		imageOf = imageOf ?? defaultImageOf(probeDir);

		// The Windows build dir is a self-extracting wrapper; materialize the
		// real app from its payload before looking for the launcher.
		const payloadTar = platform === "win32" ? wrapperPayloadTarZst(appDir) : null;
		if (payloadTar != null) {
			const extracted = join(sandbox, "extracted");
			mkdirSync(extracted, { recursive: true });
			const tarExe = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
			const tar = existsSync(tarExe) ? tarExe : "tar";
			const out = spawnSync(tar, ["-xf", payloadTar, "-C", extracted], { stdio: "pipe", windowsHide: true });
			if (out.status !== 0) {
				result.reason = `failed to extract wrapper payload ${payloadTar}: ${String(out.stderr ?? "").trim().slice(0, 300)}`;
				return finish();
			}
			launchRoot = extracted;
			result.launchDir = launchRoot;
		}
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
		// be a false result.
		const prePid = listeningPid(args.port);
		if (prePid != null) {
			result.reason = `port ${args.port} is already in use by pid ${prePid}; free the port or choose another with --port`;
			return finish();
		}
		const pre = await probeHealth(args.port);
		if (pre.healthy) {
			// Backstop for hosts without netstat/lsof: a healthy pinar helper
			// already answers on the pinned port.
			result.reason = `port ${args.port} already serves a healthy pinar helper before launch`;
			return finish();
		}

		const startMs = Date.now();
		let spawnError = null;
		child = spawnFn(launcher, [], {
			cwd: dirname(launcher),
			env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: platform !== "win32",
			windowsHide: true,
		});
		if (child == null || child.pid == null) {
			result.reason = "launcher spawn failed (no pid)";
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
			const healthOk = (await probeHealth(args.port)).healthy;
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
	} finally {
		// Always terminate everything we started, including the helper the
		// tray launched on the pinned port. Never kill a PID we did not start:
		// only a member of the launched process tree, or whose image lies
		// inside the launched build dir, is ours.
		if (child != null && child.pid != null && sandbox != null) {
			const info = readTrayPid(join(sandbox, ".pinar", "tray.pid"), 0);
			if (info.pid != null && info.pid !== child.pid) {
				// The JS runtime process (cottontail) may outlive the launcher.
				const alive = await isAlive(info.pid).catch(() => false);
				if (alive) {
					let ours = false;
					if (parentOf != null) {
						try {
							ours = await inProcessTree(info.pid, child.pid, parentOf);
						} catch {
							ours = false;
						}
					}
					if (!ours && imageOf != null) {
						try {
							ours = isInsideAppDir(await imageOf(info.pid), launchRoot);
						} catch {
							ours = false;
						}
					}
					if (ours) {
						await killTreeFn(info.pid);
					} else {
						result.reason =
							result.reason ??
							`refusing to kill foreign tray pid ${info.pid} (not inside the launched tree nor ${launchRoot})`;
					}
				}
			}
			// Never signal the launcher once it has exited on its own: by
			// cleanup time its PID may have been reused by an unrelated
			// process. (The tray/helper branches above still run.)
			if (child.exitCode === null && child.signalCode === null) {
				await killTreeFn(child.pid);
			}
		}
		const helperPid = listeningPid(args.port);
		if (helperPid != null) {
			let inside = false;
			if (imageOf != null) {
				try {
					inside = isInsideAppDir(await imageOf(helperPid), launchRoot);
				} catch {
					inside = false;
				}
			}
			let ours = inside;
			if (!ours && parentOf != null && child != null && child.pid != null) {
				ours = await inProcessTree(helperPid, child.pid, parentOf).catch(() => false);
			}
			if (ours) {
				await killTreeFn(helperPid);
			} else {
				// Not ours (e.g. a production helper): never kill, just report.
				result.reason = result.reason ?? `refusing to kill foreign pid ${helperPid} on port ${args.port}`;
			}
		}
		if (child != null) {
			await waitClose(child, 5_000);
		}
		if (sandbox != null) {
			if (!args.keepHome) {
				rmSync(sandbox, { recursive: true, force: true });
			} else {
				result.sandbox = sandbox;
			}
		}
	}

	return finish();

	function finish() {
		result.elapsedMs = Date.now() - start;
		delete result.sandbox;
		// Keep the buffers for the caller (40-line tail on failure).
		result.__tail = () => [...lastLines(errBuf, 20), ...lastLines(outBuf, 20)];
		return result;
	}
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

/** Is `imagePath` inside the build dir? (The guard for the helper kill.)
 * Comparison is separator-agnostic so it behaves the same on every platform. */
export function isInsideAppDir(imagePath, appDir) {
	if (!imagePath || !appDir) return false;
	const norm = (value) => resolve(value).toLowerCase().split(/[\\/]/).join("/");
	const base = norm(appDir);
	const image = norm(imagePath);
	return image === base || image.startsWith(base + "/");
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
	const result = await runSmoke(args);
	const tail = result.__tail();
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
