import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { boundedProcessIdentity, parsePid, PROBE_KILL_WAIT_MS, type IdentityOutcome, type IdentityProbe } from "./process-identity";

export const DEFAULT_HEALTH_PORTS = Array.from({ length: 10 }, (_, index) => 17373 + index);
const PORTS = DEFAULT_HEALTH_PORTS;

/**
 * The single port pinned by a valid `PINAR_PORT` env var (integer 1-65535),
 * or null when the variable is missing or invalid. A diagnostic tray must not
 * "borrow" a production helper on another port, so a valid pin collapses the
 * health check to that port alone.
 */
export function pinnedHealthPort(env: Record<string, string | undefined> = process.env) {
	const raw = env.PINAR_PORT;
	if (raw == null) return null;
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const port = Number(trimmed);
	if (port < 1 || port > 65535) return null;
	return port;
}

/** Ports to probe for a healthy helper: the pinned port alone, else the sweep. */
export function healthPorts(env: Record<string, string | undefined> = process.env): number[] {
	const pinned = pinnedHealthPort(env);
	return pinned == null ? PORTS : [pinned];
}

export type FindHealthyPortOptions = {
	env?: Record<string, string | undefined>;
	ports?: number[];
	fetch?: typeof fetch;
};

export async function findHealthyPort(options: FindHealthyPortOptions = {}): Promise<number | null> {
	const ports = options.ports ?? healthPorts(options.env ?? process.env);
	const doFetch = options.fetch ?? fetch;
	for (const port of ports) {
		try {
			const response = await doFetch(`http://127.0.0.1:${port}/api/health`);
			const body = (await response.json()) as { ok?: boolean; service?: string };
			if (response.ok && body.ok === true && body.service === "pinar") return port;
		} catch {
			// The helper is not on this port.
		}
	}
	return null;
}

export function pinarHome() {
	return process.env.PINAR_HOME ?? join(homedir(), ".pinar");
}

export function ensurePinarHome(root = pinarHome()) {
	mkdirSync(root, { recursive: true });
	mkdirSync(join(root, "shots"), { recursive: true });
	return root;
}

export function runningAppBundle(execPath = process.execPath) {
	let current = dirname(execPath);
	for (let i = 0; i < 8; i += 1) {
		if (current.endsWith(".app")) return current;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

export function runningAppRoot(execPath = process.execPath) {
	const bundle = runningAppBundle(execPath);
	if (bundle) return bundle;
	let current = dirname(execPath);
	for (let i = 0; i < 8; i += 1) {
		if (
			existsSync(join(current, "Helpers", "pinar.exe")) ||
			existsSync(join(current, "Pinar.exe")) ||
			existsSync(join(current, "Pinar-dev.exe")) ||
			// Electrobun Setup layout: the app root holds Resources/app/Helpers/pinar.exe.
			existsSync(join(current, "Resources", "app", "Helpers", "pinar.exe"))
		) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

export function bundledHelperCandidates(bundle: string) {
	return [
		join(bundle, "Contents", "Helpers", "pinar"),
		join(bundle, "Contents", "Resources", "app", "Helpers", "pinar"),
		join(bundle, "Helpers", "pinar.exe"),
		join(bundle, "Resources", "app", "Helpers", "pinar.exe"),
		join(bundle, "pinar.exe"),
	];
}

export function bundledHelperPath(execPath = process.execPath) {
	const root = runningAppRoot(execPath);
	if (!root) return null;
	return bundledHelperCandidates(root).find((path) => existsSync(path)) ?? null;
}

export function usesShell(bin: string, platform = process.platform) {
	return platform === "win32" && (bin.endsWith(".cmd") || bin.endsWith(".bat"));
}

export function pinarBin(execPath = process.execPath): string {
	if (process.env.PINAR_BIN) return process.env.PINAR_BIN;
	const bundled = bundledHelperPath(execPath);
	if (bundled) return bundled;
	if (process.platform !== "darwin") {
		const exe = join(pinarHome(), "bin", process.platform === "win32" ? "pinar.exe" : "pinar");
		if (existsSync(exe)) return exe;
		if (process.platform === "win32") {
			const cmd = join(pinarHome(), "bin", "pinar.cmd");
			if (existsSync(cmd)) return cmd;
		}
	}
	return process.platform === "win32" ? "pinar.cmd" : "pinar";
}

function spawnPinar(args: string[]) {
	const bin = pinarBin();
	const child = spawn(bin, args, {
		detached: true,
		env: process.env,
		shell: usesShell(bin),
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
	return child;
}

/**
 * Creation-time identity guards for numeric-PID signals (DJA-208). A healthy
 * `/api/health` proves only that something answered on the port, not WHICH
 * process it is: the listener's creation-time identity is bound right after
 * the pid lookup and re-probed immediately before EACH signal/escalation.
 * gone → no signal (already gone); unknown → refuse (cannot be proven ours);
 * a different id → refuse (recycled PID). Every refusal and signal is
 * recorded in the structured outcome returned by `killListeningPid` / `stopServer`.
 */
export interface KillRefusal {
	pid: number;
	port: number;
	reason: "unknown" | "reused" | "listener-changed";
	step: "pre-sigterm" | "pre-taskkill" | "pre-escalation" | "bind";
}

export interface KillSignal {
	pid: number;
	port: number;
	signal: "SIGTERM" | "SIGKILL" | "taskkill";
}

export interface KillPortOutcome {
	refusals: KillRefusal[];
	signals: KillSignal[];
	errors: string[];
}

/** One bounded taskkill run's result (win32 signal path). */
export interface TaskkillResult {
	/** Exit code; null when the run timed out or the child never started. */
	code: number | null;
	/** Set when the bounded wait expired (child killed through its held handle). */
	timedOut?: boolean;
	/**
	 * Only when timedOut: the reaping verdict, and it comes only from a real
	 * close ("reaped") or the expiry of the finite post-kill close wait
	 * ("unreaped").
	 */
	cleanup?: "reaped" | "unreaped";
	/** Set when the spawn emitted an error event before the deadline. */
	spawnError?: string;
	/**
	 * Set when an error event arrived after the deadline: a kill failure, not
	 * a spawn failure (the same rule as boundedProcessIdentity's killError).
	 */
	killError?: string;
}

export type TaskkillRunner = (pid: number) => Promise<TaskkillResult>;

/** Injected seams and bounds for taskkillRunner (defaults keep production). */
export interface TaskkillRunnerOptions {
	/** The spawner (default node:child_process spawn). Injected for tests. */
	spawn?: typeof spawn;
	/** Injectable timers (defaults to the global ones). */
	setTimeout?: typeof setTimeout;
	clearTimeout?: typeof clearTimeout;
	/** Runner deadline (default TASKKILL_TIMEOUT_MS). */
	timeoutMs?: number;
	/** Verified-close wait after the deadline kill (default PROBE_KILL_WAIT_MS). */
	killWaitMs?: number;
}

export type StopServerDeps = {
	healthyPort?: () => Promise<number | null>;
	/** May return the structured outcome or void (existing seams keep working). */
	killPort?: (port: number, seen: Set<number>) => Promise<KillPortOutcome | void>;
	/**
	 * Legacy seam, kept for tests only: stopServer no longer invokes
	 * `pinar stop` on any path (DJA-208) — the unbound server.pid signal is
	 * gone — and the tests assert this seam is never called.
	 */
	run?: (args: string[]) => Promise<number>;
	unhealthyTimeoutMs?: number;
	wait?: (ms: number) => Promise<void>;
}

/** stopServer's outcome: the kill bookkeeping plus the verified-stop flag. */
export interface StopServerOutcome extends KillPortOutcome {
	/**
	 * True ONLY when a bounded waitUntilUnhealthy checkpoint verified the
	 * helper is no longer healthy — the early return or the end of the loop.
	 * Every bounded false or error path — including the mid-loop single
	 * probe and the no-progress bail-out — leaves it false: "attempted",
	 * not "verified" (DJA-208).
	 */
	stopped: boolean;
}

export async function waitUntilUnhealthy(
	timeoutMs = 2000,
	healthyPort: () => Promise<number | null> = findHealthyPort,
	wait: (ms: number) => Promise<void> = sleep,
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if ((await healthyPort()) == null) return true;
		await wait(50);
	}
	return (await healthyPort()) == null;
}

export function startServer() {
	spawnPinar(["ensure"]);
}

export function installBundledHooks() {
	const bin = pinarBin();
	if (!process.env.PINAR_BIN && !existsSync(bin)) return;
	spawnPinar(["install-hooks"]);
}

function sleep(ms: number): Promise<void> {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function waitUntilHealthy(timeoutMs = 2000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const port = await findHealthyPort();
		if (port != null) return port;
		await sleep(50);
	}
	return findHealthyPort();
}

export async function stopServer(deps: StopServerDeps = {}): Promise<StopServerOutcome> {
	const healthyPort = deps.healthyPort ?? findHealthyPort;
	const killPort = deps.killPort ?? killListeningPid;
	const wait = deps.wait ?? sleep;
	const unhealthyTimeoutMs = deps.unhealthyTimeoutMs ?? 2000;
	const outcome: StopServerOutcome = { refusals: [], signals: [], errors: [], stopped: false };
	// stopServer never invokes `pinar stop` (DJA-208): that CLI path signals
	// the numeric pid in PINAR_HOME/server.pid after only a liveness check,
	// so a stale server.pid can signal a recycled PID. Every stop goes
	// through the identity-bound killListeningPid loop below, driven by
	// healthyPort (findHealthyPort honours a valid PINAR_PORT pin): bind,
	// port re-check, and the pre-signal identity re-checks apply on every
	// path. Behaviour change: a hung, unhealthy helper that answers no
	// health request is no longer stopped by the tray — before, `pinar stop`
	// killed it by server.pid, which is exactly the unbound kill removed.
	if (await waitUntilUnhealthy(unhealthyTimeoutMs, healthyPort, wait)) {
		outcome.stopped = true;
		return outcome;
	}
	const seen = new Set<number>();
	for (let n = 0; n < PORTS.length; n += 1) {
		const port = await healthyPort();
		// stopped stays false here: a single healthyPort() == null probe is
		// an attempt, not a verification — only the bounded
		// waitUntilUnhealthy checkpoints above set stopped (DJA-208).
		if (port == null) return outcome;
		const before = seen.size;
		const killed = await killPort(port, seen);
		// The injected seam may return void (existing tests); merge the
		// structured outcome when it does not.
		if (killed != null) {
			outcome.refusals.push(...killed.refusals);
			outcome.signals.push(...killed.signals);
			outcome.errors.push(...killed.errors);
		}
		// No progress (refusal or gone-before-bind): the helper is still up.
		if (seen.size === before) return outcome;
	}
	// The final verification is no longer discarded: false means the helper
	// is still healthy, so stopped stays false and the port is recorded.
	if (await waitUntilUnhealthy(unhealthyTimeoutMs, healthyPort, wait)) {
		outcome.stopped = true;
	} else {
		const port = await healthyPort();
		outcome.errors.push(`local server still healthy on port ${port ?? "unknown"} after stop`);
	}
	return outcome;
}

export async function restartServer() {
	await stopServer();
	startServer();
	await waitUntilHealthy();
}

export function parseNetstatListeningPid(stdout: string, port: number) {
	const suffix = `:${port}`;
	for (const line of stdout.split(/\r?\n/)) {
		if (!/LISTENING/i.test(line)) continue;
		const cols = line.trim().split(/\s+/);
		const local = cols[1] ?? "";
		if (!local.endsWith(suffix)) continue;
		// Strict parse: a pid column that does not parse ("0x1f", "1e3",
		// "99999999999", ...) is no pid — never Number()-normalized.
		const pid = parsePid(cols[cols.length - 1]);
		if (pid != null) return pid;
	}
	return null;
}

async function commandStdout(argv: string[]) {
	const child = spawn(argv[0], argv.slice(1), {
		stdio: ["ignore", "pipe", "ignore"],
		windowsHide: true,
	});
	return await new Promise<string>((resolve) => {
		let data = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			data += chunk;
		});
		child.on("error", () => resolve(""));
		child.on("close", () => resolve(data));
	});
}

async function findOsListeningPid(port: number) {
	if (process.platform === "win32") {
		const stdout = await commandStdout(["netstat", "-ano", "-p", "tcp"]);
		return parseNetstatListeningPid(stdout, port);
	}
	const stdout = await commandStdout(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
	// Strict parse: lsof -t prints bare pids; anything that does not parse
	// ("0x1f", "1e3", "99999999999", ...) is no pid — never Number()-normalized.
	return parsePid(stdout.trim().split(/\s+/)[0]);
}

const TASKKILL_TIMEOUT_MS = 8_000; // same bound teardownChild uses for taskkillTimeoutMs

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Bounded win32 taskkill runner: async spawn of `taskkill /PID <pid> /T /F`
 * (fixed argv, the pid validated upstream as a positive integer), awaited
 * with a bounded timeout (TASKKILL_TIMEOUT_MS — the same value teardownChild
 * uses for taskkillTimeoutMs). On the deadline the normal settlement path is
 * detached (a later close can no longer erase the timeout verdict), the
 * child is killed through its HELD handle (TerminateProcess on Windows —
 * never a numeric-PID signal), and the run resolves ONLY from a real close
 * (`cleanup: "reaped"`) or the expiry of the finite post-kill close wait
 * (`cleanup: "unreaped"` — PROBE_KILL_WAIT_MS, the same verified-close bound
 * as boundedProcessIdentity; the wait is armed BEFORE kill()). An `error`
 * before the deadline is a spawn failure (spawnError); an `error` after the
 * deadline is a kill failure (killError), never a spawn failure. Non-zero
 * status, a spawn error or a timeout is a recorded result, never a throw
 * and never a retry.
 */
export function taskkillRunner(pid: number, options: TaskkillRunnerOptions = {}): Promise<TaskkillResult> {
	const spawnFn = options.spawn ?? spawn;
	const setT = options.setTimeout ?? setTimeout;
	const clearT = options.clearTimeout ?? clearTimeout;
	const timeoutMs = options.timeoutMs ?? TASKKILL_TIMEOUT_MS;
	const killWaitMs = options.killWaitMs ?? PROBE_KILL_WAIT_MS;
	return new Promise((resolve) => {
		let settled = false;
		let deadlineTimer: ReturnType<typeof setT> | null = null;
		let killWaitTimer: ReturnType<typeof setT> | null = null;
		let killError: string | null = null;
		const child = spawnFn("taskkill", ["/PID", String(pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		const finish = (result: TaskkillResult) => {
			if (settled) return;
			settled = true;
			if (deadlineTimer != null) {
				try {
					clearT(deadlineTimer);
				} catch {
					// already fired
				}
				deadlineTimer = null;
			}
			if (killWaitTimer != null) {
				try {
					clearT(killWaitTimer);
				} catch {
					// already fired
				}
				killWaitTimer = null;
			}
			resolve(result);
		};
		const onClose = (code: number | null) => finish({ code });
		child.on("close", onClose);
		const onError = (error: Error) => finish({ code: null, spawnError: errorText(error) });
		child.on("error", onError);
		deadlineTimer = setT(() => {
			deadlineTimer = null;
			// Deadline: from this moment the run's partial status is untrusted
			// — detach the normal close/error settlement so a later close can
			// no longer erase the timeout verdict. An `error` after the
			// deadline is a KILL failure (or the dying child reporting its own
			// death) — it must NOT settle the run: only a real close proves
			// reaping, so the close verification stays in place and the kill
			// error is only recorded (never turned into a spawn failure).
			child.removeListener("close", onClose);
			child.removeListener("error", onError);
			const onKillError = (error: Error) => {
				killError = errorText(error);
			};
			child.on("error", onKillError);
			const timeoutResult = (cleanup: "reaped" | "unreaped"): TaskkillResult => {
				const result: TaskkillResult = { code: null, timedOut: true, cleanup };
				if (killError != null) result.killError = killError;
				return result;
			};
			const onKilled = () => finish(timeoutResult("reaped"));
			child.on("close", onKilled);
			// Verify the kill with a FINITE, checked wait: close observed →
			// "reaped" (a real close event on the handle — no fake reaping);
			// no close in time → "unreaped" (residue). The timer is installed
			// BEFORE kill() and settlement is guarded by `settled` inside
			// finish(): a synchronous kill() failure can neither settle the
			// run early nor leave a timer scheduled after settlement.
			killWaitTimer = setT(() => {
				killWaitTimer = null;
				finish(timeoutResult("unreaped"));
			}, killWaitMs);
			try {
				child.kill();
			} catch (error) {
				// A synchronous kill failure is recorded as the kill error; the
				// verification timer installed above still decides reaped vs
				// unreaped.
				killError = errorText(error);
			}
		}, timeoutMs);
	});
}

/** `identity` must not throw: a throwing probe fails closed to unknown. */
async function safeIdentity(identity: IdentityProbe, pid: number): Promise<IdentityOutcome> {
	try {
		return await identity(pid);
	} catch (error) {
		return { state: "unknown", error: `identity probe threw: ${errorText(error)}` };
	}
}

/**
 * Record a taskkill run's outcome. ONLY a delivered signal is recorded as
 * one: status 0 with no timeout and no spawn error. Errors and timed-out
 * calls are not delivered signals — they are errors only.
 */
async function recordTaskkill(taskkill: TaskkillRunner, pid: number, port: number, outcome: KillPortOutcome) {
	const result = await taskkill(pid);
	if (result.code === 0 && !result.timedOut && result.spawnError == null) {
		outcome.signals.push({ pid, port, signal: "taskkill" });
	}
	if (result.timedOut) {
		outcome.errors.push(`taskkill timed out after ${TASKKILL_TIMEOUT_MS}ms (pid ${pid})`);
	} else if (typeof result.spawnError === "string" && result.spawnError !== "") {
		outcome.errors.push(`taskkill failed: ${result.spawnError}`);
	} else if (result.spawnError != null) {
		// Runner error preflight: a non-empty string is the spawn error; any
		// other non-null shape is malformed and fails closed (no signal is
		// recorded above, and the run is recorded as an error).
		outcome.errors.push(`taskkill spawn error malformed: ${JSON.stringify(result.spawnError)}`);
	} else if (result.code == null) {
		outcome.errors.push(`taskkill finished without an exit code (pid ${pid})`);
	} else if (result.code !== 0) {
		outcome.errors.push(`taskkill exited ${result.code} (pid ${pid})`);
	}
}

export interface KillListeningPidDeps {
	platform?: string;
	/** netstat (win32) / lsof (POSIX) listener lookup. */
	listeningPid?: (port: number) => Promise<number | null>;
	/** Bounded creation-time identity probe (default boundedProcessIdentity). */
	identity?: IdentityProbe;
	/** process.kill seam (handle-based signal; may throw when the pid is gone). */
	signal?: (pid: number, sig: NodeJS.Signals) => boolean;
	/** Bounded, awaited, status-checked taskkill runner (win32 only). */
	taskkill?: TaskkillRunner;
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Signal the numeric listener PID on `port` — but only under a creation-time
 * identity bind (DJA-208). Sequence:
 *   1. `listeningPid(port)`; null or already in `seen` → return.
 *   2. Bind the identity. gone → return (no signal, no refusal); unknown →
 *      refusal, return (no signal).
 *   3. Confirm the port binding AFTER the identity bind: the listener must
 *      still be this pid; otherwise refusal `listener-changed`, return.
 *   4. Immediately before SIGTERM: re-probe — alive with the SAME bound id
 *      → signal; gone → return; unknown/reused → refusal, return.
 *   5. win32 only, if SIGTERM threw: re-probe exactly as in 4, then
 *      `taskkill` through the bounded awaited runner (status recorded,
 *      failure recorded, never retried here).
 *   6. After the 150 ms wait, before escalation: re-probe — gone → done;
 *      unknown/reused → refusal, NO escalation; same id → escalate
 *      (SIGKILL on POSIX, taskkill on win32 through the same runner).
 * The pid is added to `seen` at the bind step, so the caller's bounded loop
 * never revisits it. Every refusal/signal/error lands in the returned
 * outcome.
 *
 * RESIDUAL RACE (documented, not fixed — DJA-208): the numeric listener PID
 * can still be REUSED between the last identity probe and `process.kill` /
 * `taskkill` — Bun/Node holds no OS handle for a process this code did not
 * spawn, so the reuse window cannot be closed here (no OpenProcess/duplicate
 * handle). The window is minimized by the pre-signal re-probe immediately
 * before every signal. `taskkill /T` also kills that process's current
 * children.
 */
export async function killListeningPid(
	port: number,
	seen = new Set<number>(),
	deps: KillListeningPidDeps = {},
): Promise<KillPortOutcome> {
	const platform = deps.platform ?? process.platform;
	const listeningPid = deps.listeningPid ?? findOsListeningPid;
	const identity = deps.identity ?? boundedProcessIdentity(platform);
	const signal = deps.signal ?? ((pid: number, sig: NodeJS.Signals) => process.kill(pid, sig));
	const taskkill = deps.taskkill ?? taskkillRunner;
	const sleepFn = deps.sleep ?? sleep;
	const outcome: KillPortOutcome = { refusals: [], signals: [], errors: [] };

	const pid = await listeningPid(port);
	if (pid == null || seen.has(pid)) return outcome;
	// The pid is ours to handle from here on: whatever the guards decide
	// below, the caller's bounded loop must not revisit it.
	seen.add(pid);

	// 2. Bind the creation-time identity before anything else.
	const bound = await safeIdentity(identity, pid);
	if (bound.state === "gone") return outcome; // no signal, no refusal
	if (bound.state !== "alive") {
		outcome.refusals.push({ pid, port, reason: "unknown", step: "bind" });
		return outcome;
	}

	// 3. Confirm the port binding after the identity bind: if the listener
	// moved, the bound identity no longer describes what is on the port.
	if ((await listeningPid(port)) !== pid) {
		outcome.refusals.push({ pid, port, reason: "listener-changed", step: "bind" });
		return outcome;
	}

	// Re-probe immediately before a signal: only the SAME bound id may be
	// signalled. Returns "gone" (no refusal — already gone), "same", or
	// "refused" (a refusal was recorded at `step`).
	const guard = async (step: KillRefusal["step"]): Promise<"gone" | "same" | "refused"> => {
		const re = await safeIdentity(identity, pid);
		if (re.state === "gone") return "gone";
		if (re.state !== "alive") {
			outcome.refusals.push({ pid, port, reason: "unknown", step });
			return "refused";
		}
		if (re.id !== bound.id) {
			outcome.refusals.push({ pid, port, reason: "reused", step });
			return "refused";
		}
		return "same";
	};

	// 4. SIGTERM only under the pre-signal identity guard.
	if ((await guard("pre-sigterm")) !== "same") return outcome;
	try {
		signal(pid, "SIGTERM");
		outcome.signals.push({ pid, port, signal: "SIGTERM" });
	} catch {
		// 5. win32 only: the handle-based kill threw (the pid may have exited
		// between the guard and the call) — re-probe; only a still-bound id
		// gets the bounded taskkill fallback.
		if (platform === "win32" && (await guard("pre-taskkill")) === "same") {
			await recordTaskkill(taskkill, pid, port, outcome);
		}
	}

	// 6. Escalation only under the same id: gone → done; unknown/reused →
	// refusal, never escalate.
	await sleepFn(150);
	if ((await guard("pre-escalation")) === "same") {
		if (platform === "win32") {
			await recordTaskkill(taskkill, pid, port, outcome);
		} else {
			try {
				signal(pid, "SIGKILL");
				outcome.signals.push({ pid, port, signal: "SIGKILL" });
			} catch (error) {
				outcome.errors.push(`SIGKILL failed: ${errorText(error)}`);
			}
		}
	}
	return outcome;
}

export function workspaceUrl(port: number) {
	return `http://127.0.0.1:${port}/app`;
}
