/**
 * Bounded, verified teardown for a single spawned child process.
 *
 * A held ChildProcess handle is NOT immutable PID identity once the OS
 * process has exited: the PID may be recycled to an unrelated process, and
 * signalling it would kill the wrong thing. So `teardownChild` re-probes the
 * process identity with the exact contract of `identityOfFor`
 * (scripts/tray-smoke.mjs — imported, never re-implemented):
 *   `{state:"alive",id}` | `{state:"gone"}` | `{state:"unknown",error}`
 * immediately before EVERY signal, and signals only when the pid is alive
 * with the SAME immutable id (its creation time) that was bound right after
 * spawn (by the caller via `options.boundIdentity`, or by the helper's own
 * `options.captureIdentity` step):
 *   alive with the same id    → signal (win32: `taskkill /PID <pid> /T /F`
 *                               through an injectable runner whose exit
 *                               status IS CHECKED; posix: `child.kill
 *                               ("SIGKILL")` on the held handle)
 *   gone                      → no signal (already gone); wait for the close
 *   alive with a DIFFERENT id → refuse (recycled PID); never signal
 *   unknown                   → refuse (cannot be proven ours); never signal
 * No bound identity (and no captureIdentity) → no PID signal at all (the
 * helper may still wait for the close). A signal is attempted exactly once
 * per call: a failed signal (non-zero taskkill status, runner error) is
 * recorded, never retried — the identity may have moved in the meantime.
 *
 * `boundedIdentityProbe(platform, options)` is the OWNED, ASYNCHRONOUS
 * identity probe: it spawns exactly one probe child per call (win32: a fixed
 * `<SystemRoot>\System32\WindowsPowerShell\v1.0\powershell.exe` with the
 * same CIM script as identityOfFor("win32") — no executable discovery, no
 * .ps1 files; darwin: `ps -o stat=,lstart=`; linux: delegates to
 * identityOfFor("linux"), a synchronous /proc read with no subprocess) and
 * OWNS its lifecycle: on `probeTimeoutMs` (default 8_000) it kills the probe
 * child through the HELD handle (Node's kill() — TerminateProcess on
 * Windows — so it cannot hit a recycled PID), then verifies the close within
 * `probeKillWaitMs` (default 2_000). A timed-out probe resolves
 * `{state:"unknown", error:"identity probe timed out after Nms",
 * probeCleanup:"reaped"|"unreaped", probePid, killError?}` — never a mapped
 * identity (a killed probe's partial output/exit code is untrusted). An
 * `error` event AFTER the deadline is a kill failure, NOT a spawn failure:
 * it never settles the probe (F5) — it is recorded in `killError`, and the
 * reaped/unreaped verdict still comes only from a verified close.
 * `probeCleanup:"unreaped"` is residue: `teardownChild` records
 * `probeResidue: true` + an error naming the probe pid, and
 * `shouldRemoveSandbox` fails closed on it (the appDir is kept while the
 * probe child may still run). The probe never throws and removes every
 * listener/timer it created on every path.
 *
 * `captureChildIdentity(child, probe, options)` captures the bound identity
 * right after spawn with a post-capture validity check: the capture is
 * valid only if the child had NOT exited when the probe finished — once the
 * handle shows a real exit, the pid may already be recycled, and the probe
 * may have seen a DIFFERENT process: the result is `{state:"gone"}`, never
 * the captured (recycled) id. Probe residue tags (an unreaped timed-out
 * probe child) survive even the voiding: sandbox removal still fails closed
 * on them.
 *
 * `waitChildOutcome(child, options)` is the caller-side wait: it settles on
 * the child's `close` (with the exit code), its `error` (spawn failures are
 * delivered as `error` events and must be LISTENED — an unhandled one
 * throws), or a deadline, and removes all of its own listeners before it
 * resolves. It is what the CLI test uses so a spawn error can never escape
 * the protected lifecycle.
 *
 * Everything is bounded: the post-signal wait for the close is capped at
 * `options.closeTimeoutMs` (default 10_000), the win32 taskkill runner is
 * capped at `options.taskkillTimeoutMs` (default 8_000; the default runner
 * passes it to `spawnSync`, an injected Promise-returning runner is raced
 * against it), and every identity probe call made through
 * `boundedIdentityProbe` is capped by its OWN owned lifecycle (deadline +
 * kill + verified close wait — a Promise race alone cannot bound
 * synchronous subprocess work and cannot cancel the probe child; that is
 * why the helper no longer races probe calls). The identity probe passed to
 * `teardownChild` must be a bounded probe (boundedIdentityProbe, or
 * identityOfFor's default, whose psScript keeps its own kill timer); a
 * throwing probe still fails closed to `unknown` (never to a signal).
 * Timers are injectable, and the helper NEVER throws — it resolves a
 * structured result in which `reaped` is true ONLY when a real close/exit
 * event set exitCode/signalCode on the handle (no success-shaped fake
 * reaping). Every timer the helper creates is cleared and every listener it
 * adds is removed before it resolves.
 *
 * Residual window (F1): after the final identity lookup, the handle is
 * re-checked for an exit BEFORE the signal; between that check and the
 * numeric-PID `taskkill`, Windows cannot recycle the PID while Node still
 * holds the process handle (exitCode would still be null), so the remaining
 * interval cannot hit an unrelated process. The signal call is synchronous
 * right after the check (no await between the check and `spawnSync` /
 * `child.kill`); POSIX `child.kill` goes through the held handle.
 */
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { identityOfFor } from "./tray-smoke.mjs";

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Normalize a raw identity probe outcome to one of the three documented
 * shapes. A throwing or mis-shaped probe becomes `unknown` — never `gone`
 * (an unreadable probe must not read as "safe to signal") and never a throw.
 * An owned probe's cleanup tag (`probeCleanup` + `probePid`, present on the
 * timeout path of boundedIdentityProbe) rides along: an `unreaped` tag is
 * residue that `teardownChild` and `shouldRemoveSandbox` must see even on a
 * `gone` result.
 */
function normalizeIdentity(raw) {
	// (F8) killError is a diagnostic-only field carried through every
	// normalization (never a signal permission; identity semantics
	// unchanged): the real kill failure must survive into capture, the
	// pre-signal re-check and the CLI diagnostics.
	const carryKillError = (out) => {
		if (typeof raw?.killError === "string" && raw.killError !== "") out.killError = raw.killError;
		return out;
	};
	if (raw?.state === "gone") {
		const out = { state: "gone" };
		// Probe residue survives the voiding: an unreaped timed-out probe
		// child is still running (or unknown) regardless of the root exit.
		// (Residue tags stay CONDITIONAL — only `unreaped` is copied; a
		// recovered probe leaves no residue.)
		if (raw.probeCleanup === "unreaped") {
			out.probeCleanup = "unreaped";
			if (raw.probePid != null) out.probePid = raw.probePid;
		}
		// (F8) the kill failure is diagnostic-only and survives EVERY gone
		// voiding — including a recovered (reaped) probe's: the probe's kill
		// emitted an error even though it closed before the wait expired.
		return carryKillError(out);
	}
	if (raw?.state === "alive" && typeof raw.id === "string" && raw.id !== "") {
		return { state: "alive", id: raw.id };
	}
	const out = { state: "unknown", error: String(raw?.error ?? "identity probe returned an unexpected shape") };
	if (raw?.probeCleanup === "unreaped" || raw?.probeCleanup === "reaped") out.probeCleanup = raw.probeCleanup;
	if (raw?.probeCleanup != null && raw?.probePid != null) out.probePid = raw.probePid;
	return carryKillError(out);
}

/**
 * Capture the child's identity right after spawn, with the post-capture
 * validity check: the capture is valid only if the child had NOT exited when
 * the probe finished — once the handle shows a real exit (exitCode/signalCode
 * set), the pid may already be recycled to another process, and whatever the
 * probe saw cannot become the bound identity: the result is
 * `{state:"gone"}` (never the captured, recycled id), with the probe's
 * residue tag preserved. A probe fault becomes `{state:"unknown",error}`
 * (unknown is never signalled). The probe must be a bounded probe (e.g.
 * boundedIdentityProbe) — the capture no longer races it: the probe's own
 * owned lifecycle (deadline + kill + verified close wait) is the bound.
 * Returns null when the child never got a pid. Never throws.
 *
 * @param {object} child  the held child handle (pid, exitCode, signalCode)
 * @param {(pid:number)=>Promise<identity shape>} probe bounded identity probe
 *        with the exact contract of identityOfFor
 */
export async function captureChildIdentity(child, probe) {
	if (child?.pid == null) return null;
	let raw;
	try {
		raw = await probe(child.pid);
	} catch (error) {
		return { state: "unknown", error: `identity capture threw: ${errorText(error)}` };
	}
	// Post-capture validity: an exit on the handle means the probe may have
	// seen a recycled PID — the captured identity is void, never bound.
	if (child.exitCode != null || child.signalCode != null) {
		return normalizeIdentity({
			state: "gone",
			probeCleanup: raw?.probeCleanup,
			probePid: raw?.probePid,
			killError: raw?.killError, // (F8) the kill failure survives the voiding
		});
	}
	return normalizeIdentity(raw);
}

/**
 * OWNED, BOUNDED, ASYNCHRONOUS identity probe. Returns `async (pid) =>
 * identity` with the exact contract of identityOfFor:
 *   `{state:"alive",id}` | `{state:"gone"}` | `{state:"unknown",error}`
 * plus, on its own timeout path, `probeCleanup: "reaped" | "unreaped"` and
 * `probePid` (the probe child's pid — residue naming). Never throws.
 *
 * Per call it spawns EXACTLY ONE probe child and owns its whole lifecycle:
 *   win32   → spawn(<SystemRoot>\System32\WindowsPowerShell\v1.0\powershell.exe,
 *              ["-NoProfile","-NonInteractive","-Command",<CIM script>],
 *              { stdio: ["ignore","pipe","ignore"], windowsHide: true })
 *              — a FIXED path, no executable discovery (the v3 psExe()
 *              spawnSync discovery is gone: it was synchronous and could not
 *              be bounded). The script is the same CIM query as
 *              identityOfFor("win32"): exit 3 → gone, exit 4 (no
 *              CreationDate) → unknown, exit 0 + digits of
 *              CreationDate.ToFileTimeUtc() → alive, anything else unknown.
 *              `<pid>` is validated as a positive integer and inserted as a
 *              bare number only (no shell, no unvalidated interpolation).
 *   darwin  → spawn("ps", ["-o","stat=,lstart=","-p",String(pid)]) with the
 *              same parsing as identityOfFor("darwin") (Z stat → gone;
 *              status 1 + empty output → gone; status 0 + output → alive
 *              with the lstart text; anything else unknown).
 *   linux   → delegates to identityOfFor("linux") (synchronous /proc file
 *              reads — no subprocess, so nothing to bound or kill).
 *
 * The bound is OWNED, not a Promise race: on `probeTimeoutMs` (default
 * 8_000) the probe child is killed through its HELD handle — Node's
 * kill() is TerminateProcess on Windows and SIGTERM on POSIX, delivered by
 * the OS through the process handle, never a numeric-PID signal, so it
 * cannot hit a recycled PID — and its close is then waited for up to
 * `probeKillWaitMs` (default 2_000). The timeout result is
 * `{state:"unknown", error:"identity probe timed out after Nms",
 * probeCleanup:"reaped"|"unreaped", probePid}`: "reaped" only when the
 * killed child's close was actually observed, "unreaped" (residue — the
 * sandbox must be kept) when the kill did not bring it down in time. A
 * timed-out probe's partial output/exit code is NEVER mapped to an identity
 * (untrusted). A spawn `error` event → unknown with the error text. Every
 * listener and timer the probe creates is removed/cleared on every path.
 *
 * Options (all injectable for tests):
 *   spawn            — the spawner (default node:child_process spawn)
 *   spawnSync        — REGRESSION SEAM ONLY: the only sanctioned
 *                      synchronous subprocess entry point for this probe.
 *                      The owned lifecycle NEVER calls it (no synchronous
 *                      discovery, no synchronous ps). A test injects a
 *                      throwing stub and asserts it is never called;
 *                      reintroducing a synchronous spawnSync call (M14)
 *                      routes through it and goes red.
 *   systemRoot       — default process.env.SystemRoot / WINDIR / "C:\Windows"
 *   probeTimeoutMs   — default 8_000
 *   probeKillWaitMs  — default 2_000
 *   procDir          — /proc dir for the linux delegation (default "/proc")
 *   setTimeout/clearTimeout — injectable timers
 */
export function boundedIdentityProbe(platform, options = {}) {
	const p = platform ?? process.platform;
	const setT = options.setTimeout ?? globalThis.setTimeout;
	const clearT = options.clearTimeout ?? globalThis.clearTimeout;
	const spawnFn = options.spawn ?? spawn;
	// Regression seam (M14): see the JSDoc — NEVER called by the owned
	// lifecycle below.
	const spawnSyncFn = options.spawnSync ?? spawnSync;
	void spawnSyncFn;
	const probeTimeoutMs = options.probeTimeoutMs ?? 8_000;
	const probeKillWaitMs = options.probeKillWaitMs ?? 2_000;
	const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
	const psPath = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	// Same CIM query as identityOfFor("win32")'s .ps1 (inline, no file):
	// exit 2 (CIM error) / 4 (no CreationDate) → unknown, 3 (absent) →
	// gone, 0 + ToFileTimeUtc() digits → alive.
	const psCommand = (pid) =>
		`try { $p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 2 }` +
		`\nif ($null -eq $p) { exit 3 }` +
		`\nif ($null -eq $p.CreationDate) { exit 4 }` +
		`\nWrite-Output $p.CreationDate.ToFileTimeUtc()`;

	// Outcome mapping — the identity contract of identityOfFor, unchanged:
	const mapWin32 = (code, stdout) => {
		const digits = String(stdout).trim();
		if (code === 3) return { state: "gone" };
		if (code === 0 && /^\d+$/.test(digits)) return { state: "alive", id: digits };
		return { state: "unknown", error: `identity probe exited ${String(code)}` };
	};
	const mapDarwin = (code, stdout) => {
		const trimmed = String(stdout).trim();
		if (code === 0 && trimmed !== "") {
			const match = trimmed.match(/^\S+\s+/);
			if (match == null) return { state: "unknown", error: "unparsable ps output (no lstart field)" };
			const stat = trimmed.slice(0, match[0].length).trim();
			if (stat.startsWith("Z")) return { state: "gone" };
			return { state: "alive", id: trimmed.slice(match[0].length).trim() };
		}
		if (code === 1 && trimmed === "") return { state: "gone" };
		return { state: "unknown", error: `ps exited ${String(code)} with output ${JSON.stringify(trimmed)}` };
	};

	if (p === "linux") {
		const procProbe = identityOfFor("linux", { procDir: options.procDir ?? "/proc" });
		return async (pid) => {
			if (!Number.isInteger(pid) || pid <= 0) {
				return { state: "unknown", error: `identity probe rejected a non-positive-integer pid: ${String(pid)}` };
			}
			let raw;
			try {
				raw = await procProbe(pid);
			} catch (error) {
				return { state: "unknown", error: `identity probe threw: ${errorText(error)}` };
			}
			return normalizeIdentity(raw);
		};
	}

	return async (pid) => {
		// The pid is validated as a positive integer and inserted into the
		// CIM filter as a bare number only (win32); darwin passes it as a
		// single argv element (no shell). Unvalidated input never reaches a
		// subprocess.
		if (!Number.isInteger(pid) || pid <= 0) {
			return { state: "unknown", error: `identity probe rejected a non-positive-integer pid: ${String(pid)}` };
		}
		let exe;
		let args;
		let map;
		if (p === "win32") {
			exe = psPath;
			args = ["-NoProfile", "-NonInteractive", "-Command", psCommand(pid)];
			map = mapWin32;
		} else if (p === "darwin") {
			exe = "ps";
			args = ["-o", "stat=,lstart=", "-p", String(pid)];
			map = mapDarwin;
		} else {
			return { state: "unknown", error: `identity probe unsupported on platform ${String(p)}` };
		}

		let child;
		try {
			child = spawnFn(exe, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: p === "win32" });
		} catch (error) {
			return { state: "unknown", error: `identity probe spawn threw: ${errorText(error)}` };
		}

		let stdout = "";
		let settled = false;
		let deadlineTimer = null;
		let killWaitTimer = null;
		let onClose = null;
		let onError = null;
		let onKillError = null;
		let onKilled = null;
		let onStdoutData = null;

		return new Promise((resolve) => {
			const finish = (identity) => {
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
				if (onStdoutData != null && child.stdout != null) {
					child.stdout.removeListener("data", onStdoutData);
				}
				if (onClose != null) {
					child.removeListener("close", onClose);
				}
				if (onError != null) {
					child.removeListener("error", onError);
				}
				if (onKillError != null) {
					child.removeListener("error", onKillError);
				}
				if (onKilled != null) {
					child.removeListener("close", onKilled);
				}
				onStdoutData = null;
				onClose = null;
				onError = null;
				onKillError = null;
				onKilled = null;
				resolve(identity);
			};
			onStdoutData = (chunk) => {
				stdout += String(chunk);
			};
			child.stdout?.on("data", onStdoutData);
			onClose = (code) => finish(map(code, stdout));
			child.once("close", onClose);
			onError = (error) => finish({ state: "unknown", error: `identity probe spawn failed: ${errorText(error)}` });
			child.once("error", onError);
			deadlineTimer = setT(() => {
				deadlineTimer = null;
				// Deadline: from this moment the probe's partial
				// output/exit code is untrusted — detach the normal
				// settlement path so only the kill-verification path can
				// finish, then kill the probe child through its HELD handle
				// (Node's kill() — TerminateProcess on Windows, SIGTERM on
				// POSIX — delivered through the process handle, never a
				// numeric-PID signal, so it cannot hit a recycled PID).
				if (onClose != null) {
					child.removeListener("close", onClose);
					onClose = null;
				}
				if (onStdoutData != null && child.stdout != null) {
					child.stdout.removeListener("data", onStdoutData);
					onStdoutData = null;
				}
				// (F5) An `error` BEFORE the deadline is a spawn failure:
				// no live probe child exists to reap, so the generic
				// unknown (no probeCleanup) above is correct. An `error`
				// AFTER the deadline is a KILL failure (or the dying probe
				// reporting its own death) — it must NOT settle the probe:
				// the only proof of reaping is a real close, so the close
				// verification stays in place and the kill error is only
				// recorded (never turned into a generic unknown).
				let killErrorText = null;
				if (onError != null) {
					child.removeListener("error", onError);
					onError = null;
				}
				onKillError = (error) => {
					killErrorText = errorText(error);
				};
				child.once("error", onKillError);
				const timeoutIdentity = (cleanup) => {
					const identity = {
						state: "unknown",
						error: `identity probe timed out after ${probeTimeoutMs}ms`,
						probeCleanup: cleanup,
						probePid: child.pid ?? null,
					};
					if (killErrorText != null) identity.killError = killErrorText;
					return identity;
				};
				onKilled = () => finish(timeoutIdentity("reaped"));
				child.once("close", onKilled);
				// (F5) Verify the kill with a FINITE, checked wait: close
				// observed → "reaped" (a real close event on the probe
				// handle — no fake reaping); no close in time → "unreaped"
				// (residue: the sandbox must be kept, the teardown result
				// carries probeResidue + the probe pid). The timer is
				// installed BEFORE kill() and settlement is guarded by
				// `settled` inside finish(): a synchronous kill() failure
				// (Bun's ChildProcess.kill emits `error` synchronously in
				// its catch) can neither settle the probe early nor leave
				// a timer scheduled after settlement.
				killWaitTimer = setT(() => {
					killWaitTimer = null;
					finish(timeoutIdentity("unreaped"));
				}, probeKillWaitMs);
				try {
					child.kill();
				} catch (error) {
					// A synchronous kill failure is recorded as the kill
					// error; the verification timer installed above still
					// decides reaped vs unreaped.
					killErrorText = errorText(error);
				}
			}, probeTimeoutMs);
		});
	};
}

/**
 * Bounded, verified teardown of one spawned child (identity rules: file
 * header). Resolves (never rejects) with:
 *   reaped         — true ONLY when a real close/exit event set
 *                    exitCode/signalCode (never assumed from a signal)
 *   exitCode       — child.exitCode at resolution (null while alive)
 *   signalCode     — child.signalCode at resolution (null while alive)
 *   signalled      — a signal was actually issued and accepted (taskkill
 *                    exit 0, or kill() returned true)
 *   refused        — why no signal was issued (identity-guard refusals)
 *   errors         — recorded faults (taskkill status, runner errors, the
 *                    child's "error" events, unreaped probe residue)
 *   pid            — the child's pid (null when the child never got one)
 *   boundIdentity  — the identity bound right after spawn
 *   signalIdentity — the identity re-probed immediately before the
 *                    (attempted) signal (null when none was attempted)
 *   probeResidue   — true when a probe child was NOT reaped after its own
 *                    timeout (probeCleanup "unreaped" on the bound or the
 *                    pre-signal identity): the sandbox must be kept
 *
 * Options:
 *   platform        — default process.platform; selects the signal path and
 *                     the default identity probe
 *   identity        — injected BOUNDED identity probe with the exact
 *                     contract of identityOfFor: (pid) =>
 *                     Promise<identity shape> (a throwing probe still fails
 *                     closed to `unknown`, which is never signalled)
 *   (F7)           — DEFAULT identity: `boundedIdentityProbe(platform)`
 *                     with the default bounds. `teardownChild` never falls
 *                     back to identityOfFor's synchronous, unbounded
 *                     subprocess probes; the ONLY identityOfFor use left in
 *                     this file is the linux /proc delegation INSIDE
 *                     boundedIdentityProbe.
 *   probeSpawn      — spawn seam forwarded to the DEFAULT
 *                     boundedIdentityProbe (same meaning as its `spawn`)
 *   probeSpawnSync  — regression seam forwarded to the DEFAULT
 *                     boundedIdentityProbe (same meaning as its `spawnSync`:
 *                     the owned probe path never calls it)
 *   probeSystemRoot / probeTimeoutMs / probeKillWaitMs — forwarded to the
 *                     DEFAULT boundedIdentityProbe (same meaning as its
 *                     options)
 *   procDir         — /proc dir for the default linux probe (inside
 *                     boundedIdentityProbe's linux delegation)
 *   boundIdentity   — the child's identity captured by the CALLER right
 *                     after spawn (one of the three documented shapes,
 *                     optionally tagged with probeCleanup/probePid)
 *   captureIdentity — when true (and no boundIdentity is given) the helper
 *                     captures the identity itself through the probe
 *   runTaskkill     — (pid) => {status,error} (sync or Promise); default
 *                     spawnSync("taskkill", ["/PID", pid, "/T", "/F"],
 *                     { timeout: taskkillTimeoutMs }); the outcome IS
 *                     checked: non-zero status or error (incl. a timeout,
 *                     error.code === "ETIMEDOUT" or a set signal) → a
 *                     recorded failure, never success, never retried
 *   taskkillTimeoutMs — cap for the win32 taskkill runner (default 8_000);
 *                     the default runner passes it to spawnSync, an
 *                     injected Promise-returning runner is raced against
 *                     it (timeout → recorded failure, no second signal)
 *   closeTimeoutMs  — bounded wait for the close after the (attempted)
 *                     signal; default 10_000
 *   setTimeout/clearTimeout — injectable timers (unit tests never wait real
 *                     seconds)
 */
export async function teardownChild(child, options = {}) {
	const platform = options.platform ?? process.platform;
	const result = {
		reaped: false,
		exitCode: null,
		signalCode: null,
		signalled: false,
		refused: [],
		errors: [],
		pid: child?.pid ?? null,
		boundIdentity: null,
		signalIdentity: null,
		probeResidue: false,
	};
	if (child == null) {
		result.refused.push("no child handle; nothing to reap");
		return result;
	}
	const { refused, errors } = result;

	// An unreaped timed-out probe child is residue even when the root
	// identity is gone/unknown: record it (probeResidue + the probe pid)
	// so shouldRemoveSandbox fails closed and the sandbox is kept. Sources
	// (bound vs pre-signal) are deduplicated per (source, probe pid).
	const markedResidue = new Set();
	const markProbeResidue = (identity, source) => {
		const probePid = identity.probePid != null ? String(identity.probePid) : "unknown";
		const key = `${source}:${probePid}`;
		if (markedResidue.has(key)) return;
		markedResidue.add(key);
		result.probeResidue = true;
		// (F8) the real kill failure is part of the preserved residue fact.
		const kill =
			typeof identity.killError === "string" && identity.killError !== ""
				? `; kill error: ${identity.killError}`
				: "";
		errors.push(
			`identity probe child pid ${probePid} was not reaped after the probe timeout (probeCleanup: unreaped${kill}); the sandbox is kept`,
		);
	};

	// The CALLER's bound identity may already carry probe residue (an
	// unreaped timed-out probe child): record it BEFORE any early return,
	// so an already-exited root still keeps the sandbox (F4).
	if (options.boundIdentity != null) {
		const tagged = normalizeIdentity(options.boundIdentity);
		if (tagged?.probeCleanup === "unreaped") markProbeResidue(tagged, "bound");
	}

	// Spawn errors are listened for from the start and recorded; the
	// listener is removed again before the helper resolves.
	const onError = (error) => {
		errors.push(`child process error: ${errorText(error)}`);
	};
	child.once("error", onError);

	// Identity probe: the injected bounded one, or — (F7) — the DEFAULT
	// boundedIdentityProbe with the default bounds. teardownChild NEVER
	// falls back to identityOfFor's synchronous, unbounded subprocess
	// probes (the only identityOfFor left in this file is the linux /proc
	// delegation inside boundedIdentityProbe). The wrapper never throws
	// and never returns anything but the documented shapes (a throwing or
	// mis-shaped probe becomes `unknown`, which is never treated as
	// `gone`). The probe call is NOT raced here: a Promise race cannot
	// bound synchronous subprocess work and cannot cancel the probe child —
	// the bound lives in the probe's own owned lifecycle (boundedIdentity
	// Probe: deadline + kill + verified close wait).
	const baseProbe = options.identity ?? boundedIdentityProbe(platform, {
		spawn: options.probeSpawn,
		spawnSync: options.probeSpawnSync,
		systemRoot: options.probeSystemRoot,
		procDir: options.procDir,
		probeTimeoutMs: options.probeTimeoutMs,
		probeKillWaitMs: options.probeKillWaitMs,
	});
	const probeIdentity = async (pid) => {
		let raw;
		try {
			raw = await baseProbe(pid);
		} catch (error) {
			return { state: "unknown", error: `identity probe threw: ${errorText(error)}` };
		}
		return normalizeIdentity(raw);
	};

	const closeTimeoutMs = options.closeTimeoutMs ?? 10_000;
	const setT = options.setTimeout ?? globalThis.setTimeout;
	const clearT = options.clearTimeout ?? globalThis.clearTimeout;
	let closeTimer = null;
	/** Bounded wait for the real close: the timer and the close listener are
	 *  always cleared/removed before the promise resolves. */
	const waitClose = () =>
		new Promise((resolve) => {
			if (child.exitCode != null || child.signalCode != null) return resolve(true);
			let settled = false;
			let onClose = null;
			const settle = (closed) => {
				if (settled) return;
				settled = true;
				if (closeTimer != null) {
					try {
						clearT(closeTimer);
					} catch {
						// already fired
					}
					closeTimer = null;
				}
				if (onClose != null) {
					child.removeListener("close", onClose);
					onClose = null;
				}
				resolve(closed);
			};
			onClose = () => settle(true);
			child.once("close", onClose);
			if (child.exitCode != null || child.signalCode != null) return settle(true);
			closeTimer = setT(() => settle(false), closeTimeoutMs);
		});

	const finish = () => {
		// Clear everything the helper still holds before resolving: the
		// close timer (if still pending) and the error listener (waitClose
		// already cleared its own close listener and timer on settlement).
		if (closeTimer != null) {
			try {
				clearT(closeTimer);
			} catch {
				// already fired
			}
			closeTimer = null;
		}
		child.removeListener("error", onError);
		result.exitCode = child.exitCode ?? null;
		result.signalCode = child.signalCode ?? null;
		// Reaped ONLY from a real close/exit outcome on the handle — a
		// successful signal is not reaping while the process may still run.
		result.reaped = child.exitCode != null || child.signalCode != null;
		return result;
	};

	const pid = child.pid;
	if (pid == null) {
		// A child that never spawned (no pid, e.g. a spawn error) needs no
		// signal; only the bounded wait for the close.
		refused.push("child never got a pid; no signal, only the bounded close wait");
		await waitClose();
		return finish();
	}
	if (child.exitCode != null || child.signalCode != null) {
		// The handle already carries a real close/exit outcome: nothing to
		// signal; the reaped fact is read from the handle, never assumed.
		return finish();
	}

	// Bind the identity: captured by the caller right after spawn, or
	// (options.captureIdentity) captured here through the probe.
	let bound = null;
	if (options.boundIdentity != null) {
		bound = normalizeIdentity(options.boundIdentity);
	} else if (options.captureIdentity) {
		// Same post-capture validity rule as captureChildIdentity: an exit
		// observed on the handle voids the captured (possibly recycled) id.
		bound = await captureChildIdentity(child, probeIdentity);
	}
	result.boundIdentity = bound;
	if (bound?.probeCleanup === "unreaped") markProbeResidue(bound, "bound");
	if (bound == null) {
		// No identity was ever bound: a PID signal cannot be identity-bound,
		// so it is refused fail-closed (waiting for the close is still ok).
		refused.push(`no bound identity for pid ${pid}; not signalled`);
		await waitClose();
		return finish();
	}
	if (bound.state !== "alive") {
		// gone: the process is already gone; unknown: the probe could not
		// decide — neither may be signalled by PID.
		refused.push(
			`bound identity for pid ${pid} is ${bound.state}${bound.state === "unknown" ? ` (${bound.error})` : ""}; not signalled`,
		);
		await waitClose();
		return finish();
	}

	// Re-probe the identity IMMEDIATELY before the signal: a recycled PID
	// (alive with a DIFFERENT immutable id) is refused, never signalled.
	const atSignal = await probeIdentity(pid);
	result.signalIdentity = atSignal;
	if (atSignal?.probeCleanup === "unreaped") markProbeResidue(atSignal, "signal");
	if (atSignal.state === "gone") {
		refused.push(`pid ${pid} gone at the pre-signal re-check; not signalled`);
		await waitClose();
		return finish();
	}
	if (atSignal.state !== "alive") {
		refused.push(`pid ${pid} identity unknown at the pre-signal re-check (${atSignal.error}); not signalled`);
		await waitClose();
		return finish();
	}
	if (atSignal.id !== bound.id) {
		refused.push(
			`pid ${pid} identity changed since spawn (${bound.id} -> ${atSignal.id}); recycled pid, not signalled`,
		);
		await waitClose();
		return finish();
	}

	// F1: an exit observed while the final identity lookup ran voids the
	// signal — the handle's exitCode/signalCode being set means the pid may
	// already be recycled and the lookup may have seen ANOTHER process, even
	// with a matching id. Residual window: between this check and the
	// numeric-PID taskkill below, Windows cannot recycle the PID while Node
	// still holds the process handle (exitCode would still be null), so the
	// interval cannot hit an unrelated process; POSIX child.kill goes
	// through the held handle.
	if (child.exitCode != null || child.signalCode != null) {
		refused.push(`pid ${pid} exited during the pre-signal re-check; not signalled`);
		await waitClose();
		return finish();
	}

	// Signal exactly once through the identity-verified path; a fault is
	// recorded, never retried (the identity may have moved since the
	// signal). The runner is started synchronously — no await between the F1
	// check above and spawnSync/child.kill.
	if (platform === "win32") {
		const taskkillMs = options.taskkillTimeoutMs ?? 8_000;
		const runner =
			options.runTaskkill ??
			((p) =>
				spawnSync("taskkill", ["/PID", String(p), "/T", "/F"], {
					stdio: "ignore",
					windowsHide: true,
					timeout: taskkillMs,
				}));
		let out = null;
		let runnerThrew = false;
		let runnerTimedOut = false;
		try {
			const started = runner(pid);
			// The injected runner's Promise is raced against taskkillTimeoutMs:
			// a runner that never settles is a recorded timeout failure, not a
			// defeat of the teardown deadline (no second signal either way).
			out = await new Promise((resolve, reject) => {
				let raceTimer = null;
				const clearRace = () => {
					if (raceTimer != null) {
						try {
							clearT(raceTimer);
						} catch {
							// already fired
						}
						raceTimer = null;
					}
				};
				Promise.resolve(started).then(
					(value) => {
						clearRace();
						resolve(value);
					},
					(err) => {
						clearRace();
						reject(err);
					},
				);
				raceTimer = setT(() => {
					raceTimer = null;
					runnerTimedOut = true;
					resolve(null);
				}, taskkillMs);
			});
		} catch (error) {
			runnerThrew = true;
			errors.push(`taskkill runner threw: ${errorText(error)}`);
		}
		if (runnerTimedOut) {
			errors.push(`taskkill /PID ${pid} /T /F timed out after ${taskkillMs}ms; the child may still be running`);
		} else if (!runnerThrew) {
			if (out?.error != null) {
				const code = out.error instanceof Error && "code" in out.error ? out.error.code : undefined;
				// A spawnSync timeout (error.code === "ETIMEDOUT", or a set
				// signal) is a recorded failure — reaped only from a real exit.
				if (code === "ETIMEDOUT" || out?.signal != null) {
					errors.push(`taskkill /PID ${pid} /T /F timed out after ${taskkillMs}ms; the child may still be running`);
				} else {
					errors.push(`taskkill /PID ${pid} /T /F failed to run: ${errorText(out.error)}`);
				}
			} else if (out?.status !== 0) {
				errors.push(`taskkill /PID ${pid} /T /F exited ${String(out?.status)}; the child may still be running`);
			} else {
				result.signalled = true;
			}
		}
	} else {
		// POSIX: signal the HELD handle (never a bare pid by number).
		let ok = false;
		try {
			ok = child.kill("SIGKILL") === true;
		} catch (error) {
			errors.push(`child.kill(SIGKILL) threw: ${errorText(error)}`);
		}
		if (ok) result.signalled = true;
		else errors.push(`child.kill(SIGKILL) returned false for pid ${pid}`);
	}

	// Bounded wait for the real close; a child that survives the wait is NOT
	// re-signalled and NOT reaped — the result says so plainly.
	await waitClose();
	return finish();
}

/**
 * Caller-side rule as a pure function: the sandbox (appDir) is removed ONLY
 * when the child was reaped (a real close/exit set exitCode/signalCode) or
 * NEVER spawned at all — an EXPLICIT `pid === null` (an `undefined` pid is
 * not "never spawned") — and only when there is NO probe residue.
 * `probeResidue: true` (an unreaped timed-out probe child may still be
 * running) ALWAYS fails closed to false, even alongside `reaped: true`.
 * Every other outcome (a survivor, a refused/failed signal, an unknown
 * identity, a mis-shaped result) keeps the sandbox in place for inspection.
 * Fails closed on null/mis-shaped input.
 */
export function shouldRemoveSandbox(result) {
	if (result == null) return false;
	if (result.probeResidue === true) return false;
	if (result.reaped === true) return true;
	return result.pid === null;
}

/**
 * cliSandboxDecision — the CLI test's sandbox-removal decision (F4).
 *
 * (F4) The removal predicate must see the CAPTURE residue in every path:
 * an unreaped timed-out probe child from the caller's bounded capture
 * keeps the sandbox even when the root child was reaped (the CLI always
 * calls teardownChild, so its result is the first source) and even when
 * the teardown result itself carries no residue (the second source below
 * guards the decision on its own). Single source of truth: capture tag OR
 * teardown residue.
 *
 *   reaped        — teardownChild(...).reaped (true only on a real
 *                   close/exit)
 *   pid           — the root child's pid (null → nothing was reaped)
 *   boundIdentity — the caller's capture result (captureChildIdentity;
 *                   the tag survives its gone-voiding)
 *   teardown      — teardownChild's result (or null)
 */
export function cliSandboxDecision({ reaped, pid, boundIdentity, teardown }) {
	const probeResidue =
		boundIdentity?.probeCleanup === "unreaped" ||
		teardown?.probeResidue === true;
	return shouldRemoveSandbox({ reaped, pid, probeResidue });
}

/**
 * consistencyProbeDecision — the native consistency test's decision (F6).
 *
 * (F6) Every owned probe result is accounted for: `residue` is true when
 * ANY of them carries probeCleanup: "unreaped" — the test must fail and
 * KEEP its probe dir (an abandoned probe child may still be alive). A
 * retry may only replace a mismatching `alive` pair that carries no
 * residue: it must never retry away an owned-resource failure.
 *
 *   warmup  — the warm-up probe result (our own long-lived process; it is
 *             checked on its own so ignoring it is a visible kill)
 *   results — every other owned probe result observed so far (each
 *             comparison attempt's owned probe, the follow-up probe,
 *             failure-path probes)
 *   a, b    — the current owned (a) and reference (b) comparison pair
 *   teardowns — the teardownChild results of the main and the `finally`
 *             guard call: `probeResidue: true` on ANY of them (an internal
 *             re-check probe that timed out unreaped — its result is NOT
 *             in `results`, it lives in the teardown's tagged
 *             bound/signal identities and error text) is residue even when
 *             every explicit probe result is clean and the root exited
 *             cleanly reaped (a clean root exit never clears query
 *             residue)
 */
export function consistencyProbeDecision({ warmup, results, a, b, teardowns }) {
	const residue =
		warmup?.probeCleanup === "unreaped" ||
		results.some((result) => result?.probeCleanup === "unreaped") ||
		Array.isArray(teardowns) && teardowns.some((teardown) => teardown?.probeResidue === true);
	const pairOk = a?.state === "alive" && b?.state === "alive" && a.id === b.id;
	return {
		residue,
		pairOk,
		// A retry replaces ONLY a mismatching pair without residue.
		retry: !pairOk && !residue,
	};
}

/**
 * Caller-side wait for a spawned child's outcome: settles on the child's
 * `close` event (`kind: "close"`, `code` = the exit code), its `error`
 * event (`kind: "error"`, `error` = the spawn error — spawn failures are
 * delivered as `error` events and MUST be listened for, an unhandled one
 * throws), or the deadline (`kind: "deadline"`). Resolves (never rejects)
 * with `{ kind: "close" | "error" | "deadline", code: number | null,
 * error: Error | null }` and removes ALL of its own listeners (and clears
 * its timer) before it resolves. The first of the three to happen wins; a
 * later `close` after an `error` is not re-delivered.
 *
 * @param {object} child the held child handle
 * @param {object} [options] deadlineMs (default 20_000), setTimeout /
 *        clearTimeout (injectable timers)
 */
export function waitChildOutcome(child, options = {}) {
	const deadlineMs = options.deadlineMs ?? 20_000;
	const setT = options.setTimeout ?? globalThis.setTimeout;
	const clearT = options.clearTimeout ?? globalThis.clearTimeout;
	return new Promise((resolve) => {
		let timer = null;
		let finished = false;
		const finish = (outcome) => {
			if (finished) return;
			finished = true;
			if (timer != null) {
				try {
					clearT(timer);
				} catch {
					// already fired
				}
				timer = null;
			}
			child.removeListener("close", onClose);
			child.removeListener("error", onError);
			resolve(outcome);
		};
		const onClose = (code) => finish({ kind: "close", code: code ?? null, error: null });
		const onError = (error) => finish({ kind: "error", code: null, error: error ?? null });
		child.once("close", onClose);
		child.once("error", onError);
		timer = setT(() => finish({ kind: "deadline", code: null, error: null }), deadlineMs);
	});
}
