import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Creation-time process identity probe for the production tray.
 *
 * The exact contract of `boundedIdentityProbe` (scripts/child-teardown.mjs)
 * and `identityOfFor` (scripts/tray-smoke.mjs), ported because the tray build
 * must not bundle the `scripts/` smoke harness:
 *   `{state:"alive",id}` | `{state:"gone"}` | `{state:"unknown",error}`
 * where `id` is the process CREATION TIME (win32: `CreationDate
 * .ToFileTimeUtc()`; darwin: the `ps` lstart text; linux: the `/proc`
 * starttime field). A numeric PID alone is NOT identity: the OS may recycle
 * it, and callers must only signal a pid whose re-probed id equals the bound
 * one. The parity test (process-identity.test.ts) feeds the same fake spawn
 * outputs to both implementations and asserts identical results.
 *
 * OWNED, BOUNDED, ASYNCHRONOUS: per call the probe spawns EXACTLY ONE probe
 * child and owns its whole lifecycle (win32: a fixed
 * `<SystemRoot>\System32\WindowsPowerShell\v1.0\powershell.exe` with the
 * same CIM `Win32_Process` query as identityOfFor("win32") — exit 0 +
 * digits of `CreationDate.ToFileTimeUtc()` → alive, exit 3 → gone, exit 2
 * (CIM error) / 4 (no CreationDate) / anything else → unknown; darwin:
 * `ps -o stat=,lstart=` — Z stat → gone, status 1 + empty output → gone,
 * status 0 + output → alive with the lstart text, anything else unknown;
 * linux: a synchronous `/proc/<pid>/stat` read — no subprocess). On
 * `probeTimeoutMs` (default 8_000) the probe child is killed through its
 * HELD handle (Node's kill() — TerminateProcess on Windows — so it cannot
 * hit a recycled PID), and its close is verified within `probeKillWaitMs`
 * (default 2_000). A timed-out probe resolves
 * `{state:"unknown", error:"identity probe timed out after Nms",
 * probeCleanup:"reaped"|"unreaped", probePid, killError?}` — never a mapped
 * identity (a killed probe's partial output/exit code is untrusted). A
 * post-deadline `error` event is a kill failure, not a spawn failure: it
 * never settles the probe (`killError` only; the reaped/unreaped verdict
 * still comes only from a verified close). The probe never throws and
 * removes every listener/timer it created on every path. Never
 * spawnSync/execSync, never an unbounded probe, never a pid that is not a
 * positive integer.
 */

export type IdentityOutcome =
	| { state: "alive"; id: string }
	| { state: "gone" }
	| {
			state: "unknown";
			error: string;
			probeCleanup?: "reaped" | "unreaped";
			probePid?: number | null;
			killError?: string;
	  };

export type IdentityProbe = (pid: number) => Promise<IdentityOutcome>;

export interface ProcessIdentityOptions {
	/** The spawner (default node:child_process spawn). Injected for tests. */
	spawn?: typeof spawn;
	/** Injectable timers (defaults to the global ones). */
	setTimeout?: typeof setTimeout;
	clearTimeout?: typeof clearTimeout;
	/** Probe deadline (default 8_000). */
	probeTimeoutMs?: number;
	/** Verified-close wait after the deadline kill (default 2_000). */
	probeKillWaitMs?: number;
	/** SystemRoot for the fixed PowerShell path (default env SystemRoot/WINDIR/"C:\\Windows"). */
	systemRoot?: string;
	/** /proc dir for the linux path (default "/proc"). */
	procDir?: string;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Verified-close wait after a deadline kill (the default probeKillWaitMs). */
export const PROBE_KILL_WAIT_MS = 2_000;

/**
 * Strict numeric-PID parse (DJA-208): after trim, integer digits only
 * (`/^\d+$/`) and a value in 1..2147483647 (the 32-bit pid range). Every
 * other shape — "12abc", "1e3", "0x1f", "", "0", "-5",
 * "99999999999" — is null. Malformed values are never normalized: a PID
 * column that does not parse is no PID (a null), not a rounded number.
 */
export function parsePid(value: string | null | undefined): number | null {
	if (value == null) return null;
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const pid = Number(trimmed);
	if (!Number.isInteger(pid) || pid < 1 || pid > 2_147_483_647) return null;
	return pid;
}

export function boundedProcessIdentity(
	platform: NodeJS.Platform | string | null | undefined,
	options: ProcessIdentityOptions = {},
): IdentityProbe {
	const p = platform ?? process.platform;
	const setT = options.setTimeout ?? setTimeout;
	const clearT = options.clearTimeout ?? clearTimeout;
	const spawnFn = options.spawn ?? spawn;
	const probeTimeoutMs = options.probeTimeoutMs ?? 8_000;
	const probeKillWaitMs = options.probeKillWaitMs ?? PROBE_KILL_WAIT_MS;
	const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
	const psPath = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	// Same CIM query as identityOfFor("win32")'s .ps1 (inline, no file):
	// exit 2 (CIM error) / 4 (no CreationDate) → unknown, 3 (absent) →
	// gone, 0 + ToFileTimeUtc() digits → alive.
	const psCommand = (pid: number) =>
		`try { $p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 2 }` +
		`\nif ($null -eq $p) { exit 3 }` +
		`\nif ($null -eq $p.CreationDate) { exit 4 }` +
		`\nWrite-Output $p.CreationDate.ToFileTimeUtc()`;

	// Outcome mapping — the identity contract of identityOfFor, unchanged:
	const mapWin32 = (code: number | null, stdout: string): IdentityOutcome => {
		const digits = String(stdout).trim();
		if (code === 3) return { state: "gone" };
		if (code === 0 && /^\d+$/.test(digits)) return { state: "alive", id: digits };
		return { state: "unknown", error: `identity probe exited ${String(code)}` };
	};
	const mapDarwin = (code: number | null, stdout: string): IdentityOutcome => {
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
		// Same synchronous /proc read as identityOfFor("linux") — no
		// subprocess, so nothing to bound or kill.
		const procDir = options.procDir ?? "/proc";
		return async (pid: number): Promise<IdentityOutcome> => {
			// Strict PID contract (parsePid): integer digits in 1..
			// 2147483647 — nothing else reaches the /proc read.
			if (!Number.isInteger(pid) || pid <= 0 || parsePid(String(pid)) == null) {
				return { state: "unknown", error: `identity probe rejected a non-positive-integer pid: ${String(pid)}` };
			}
			let text: string;
			try {
				text = readFileSync(join(procDir, String(pid), "stat"), "utf8");
			} catch (error) {
				const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
				if (code === "ENOENT" || code === "ESRCH") return { state: "gone" };
				return { state: "unknown", error: `cannot read ${procDir}/${pid}/stat: ${errorText(error)}` };
			}
			// The comm field is parenthesized and may itself contain ") (" —
			// the numeric fields start after the LAST ")".
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

	return async (pid: number): Promise<IdentityOutcome> => {
		// The pid is validated as a positive integer and inserted into the
		// CIM filter as a bare number only (win32); darwin passes it as a
		// single argv element (no shell). Unvalidated input never reaches a
		// subprocess.
		// Strict PID contract (parsePid): integer digits in 1..
		// 2147483647 — a pid above the 32-bit range is rejected too.
		if (!Number.isInteger(pid) || pid <= 0 || parsePid(String(pid)) == null) {
			return { state: "unknown", error: `identity probe rejected a non-positive-integer pid: ${String(pid)}` };
		}
		let exe: string;
		let args: string[];
		let map: (code: number | null, stdout: string) => IdentityOutcome;
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

		let child: ChildProcess;
		try {
			child = spawnFn(exe, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: p === "win32" });
		} catch (error) {
			return { state: "unknown", error: `identity probe spawn threw: ${errorText(error)}` };
		}

		let stdout = "";
		let settled = false;
		let deadlineTimer: ReturnType<typeof setT> | null = null;
		let killWaitTimer: ReturnType<typeof setT> | null = null;
		let onClose: ((code: number | null) => void) | null = null;
		let onError: ((error: Error) => void) | null = null;
		let onKillError: ((error: Error) => void) | null = null;
		let onKilled: (() => void) | null = null;
		let onStdoutData: ((chunk: unknown) => void) | null = null;

		return new Promise<IdentityOutcome>((resolve) => {
			const finish = (identity: IdentityOutcome) => {
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
					child.stdout.removeListener("data", onStdoutData as (chunk: Buffer) => void);
				}
				if (onClose != null) {
					child.removeListener("close", onClose as (...args: unknown[]) => void);
				}
				if (onError != null) {
					child.removeListener("error", onError as (...args: unknown[]) => void);
				}
				if (onKillError != null) {
					child.removeListener("error", onKillError as (...args: unknown[]) => void);
				}
				if (onKilled != null) {
					child.removeListener("close", onKilled as (...args: unknown[]) => void);
				}
				onStdoutData = null;
				onClose = null;
				onError = null;
				onKillError = null;
				onKilled = null;
				resolve(identity);
			};
			onStdoutData = (chunk: unknown) => {
				stdout += String(chunk);
			};
			child.stdout?.on("data", onStdoutData as (chunk: Buffer) => void);
			onClose = (code: number | null) => finish(map(code, stdout));
			child.once("close", onClose as (...args: unknown[]) => void);
			onError = (error: Error) =>
				finish({ state: "unknown", error: `identity probe spawn failed: ${errorText(error)}` });
			child.once("error", onError as (...args: unknown[]) => void);
			deadlineTimer = setT(() => {
				deadlineTimer = null;
				// Deadline: from this moment the probe's partial
				// output/exit code is untrusted — detach the normal
				// settlement path so only the kill-verification path can
				// finish, then kill the probe child through its HELD handle
				// (Node's kill() — TerminateProcess on Windows, SIGTERM on
				// POSIX — delivered by the OS through the process handle,
				// never a numeric-PID signal, so it cannot hit a recycled
				// PID).
				if (onClose != null) {
					child.removeListener("close", onClose as (...args: unknown[]) => void);
					onClose = null;
				}
				if (onStdoutData != null && child.stdout != null) {
					child.stdout.removeListener("data", onStdoutData as (chunk: Buffer) => void);
					onStdoutData = null;
				}
				// An `error` BEFORE the deadline is a spawn failure: no
				// live probe child exists to reap, so the generic unknown
				// (no probeCleanup) above is correct. An `error` AFTER the
				// deadline is a KILL failure (or the dying probe reporting
				// its own death) — it must NOT settle the probe: the only
				// proof of reaping is a real close, so the close
				// verification stays in place and the kill error is only
				// recorded (never turned into a generic unknown).
				let killErrorText: string | null = null;
				if (onError != null) {
					child.removeListener("error", onError as (...args: unknown[]) => void);
					onError = null;
				}
				onKillError = (error: Error) => {
					killErrorText = errorText(error);
				};
				child.once("error", onKillError as (...args: unknown[]) => void);
				const timeoutIdentity = (cleanup: "reaped" | "unreaped"): IdentityOutcome => {
					const identity: IdentityOutcome = {
						state: "unknown",
						error: `identity probe timed out after ${probeTimeoutMs}ms`,
						probeCleanup: cleanup,
						probePid: child.pid ?? null,
					};
					if (killErrorText != null) identity.killError = killErrorText;
					return identity;
				};
				onKilled = () => finish(timeoutIdentity("reaped"));
				child.once("close", onKilled as (...args: unknown[]) => void);
				// Verify the kill with a FINITE, checked wait: close
				// observed → "reaped" (a real close event on the probe
				// handle — no fake reaping); no close in time → "unreaped"
				// (residue). The timer is installed BEFORE kill() and
				// settlement is guarded by `settled` inside finish(): a
				// synchronous kill() failure can neither settle the probe
				// early nor leave a timer scheduled after settlement.
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
