import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	boundedIdentityProbe,
	captureChildIdentity,
	cliSandboxDecision,
	consistencyProbeDecision,
	shouldRemoveSandbox,
	teardownChild,
	waitChildOutcome,
} from "./child-teardown.mjs";
// (A9/F-self) the LEGACY identity executor (tray-smoke.mjs — read-only
// import; the legacy cross-check test (A) compares it against the owned
// boundedIdentityProbe on process.pid). The ping reap test (B) does not
// use it (its teardown re-check is the helper's DEFAULT bounded
// identity with the shrunk options).
import { identityOfFor } from "./tray-smoke.mjs";

/* ---------------- fakes --------------------------------------------------- */

type Identity = { state: "alive"; id: string } | { state: "gone" } | { state: "unknown"; error: string };

interface FakeChild extends EventEmitter {
	pid: number | null;
	exitCode: number | null;
	signalCode: string | null;
	killCalls: string[];
	kill(signal?: string): boolean;
}

/** Fake child: EventEmitter + pid/exitCode/signalCode + a recorded kill. */
function fakeChild(pid: number | null = 4242): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.pid = pid;
	child.exitCode = null;
	child.signalCode = null;
	child.killCalls = [];
	child.kill = (signal?: string) => {
		child.killCalls.push(signal ?? "");
		// The fake does NOT close the handle itself: the test emits `close`
		// explicitly when the kill "lands" (deterministic, no real timers).
		return child.pid != null;
	};
	return child;
}

/** Emit a real close/exit on the fake child (sets the outcome fields too). */
function exitChild(child: FakeChild, code: number | null, signal: string | null): void {
	child.exitCode = code;
	child.signalCode = signal;
	child.emit("close", code, signal);
}

/** Identity probe that plays back a queue of identities (the last entry
 *  sticks); records every pid it was asked about. An empty queue answers
 *  `unknown`, so a probe call the test did not expect is visible. */
function identityQueue(queue: Identity[]) {
	const pids: number[] = [];
	let i = 0;
	const fn = async (pid: number): Promise<Identity> => {
		pids.push(pid);
		i += 1;
		if (queue.length === 0) return { state: "unknown", error: "identity queue empty" };
		return queue[Math.min(i - 1, queue.length - 1)];
	};
	return { fn, pids };
}

/** taskkill runner that records calls and returns a fixed status. */
function taskkillRunner(status: number | null) {
	const pids: number[] = [];
	const fn = (pid: number) => {
		pids.push(pid);
		return { status, error: null };
	};
	return { fn, pids };
}

/** Fake probe child for boundedIdentityProbe: EventEmitter + pid + a
 *  recorded kill spy + an EventEmitter standing in for the stdout stream.
 *  The test delivers close/error deterministically; with closeOnKill the
 *  kill "lands" on the next tick (simulating the OS bringing the child
 *  down), otherwise the child survives the kill (residue scenario). */
function fakeProbeChild(opts: {
	pid?: number | null;
	closeOnKill?: boolean;
	killCode?: number | null;
	errorOnKill?: string;
	killThrows?: string;
} = {}) {
	const stdout = new EventEmitter();
	const child: any = new EventEmitter();
	child.stdout = stdout;
	child.pid = opts.pid ?? 98765;
	const killCalls: number[] = [];
	child.kill = () => {
		killCalls.push(1);
		if (opts.killThrows) {
			// (F5) synchronous kill() failure (Bun's ChildProcess.kill
			// emits `error` synchronously in its catch and returns false —
			// a throw models the same failure class).
			throw new Error(opts.killThrows);
		}
		if (opts.errorOnKill) {
			// (F5) asynchronous kill failure: Node documents kill failure
			// as an `error` event — it arrives AFTER kill().
			setTimeout(() => {
				child.emit("error", new Error(opts.errorOnKill!));
			}, 1);
		}
		if (opts.closeOnKill) {
			setTimeout(() => {
				child.emit("close", opts.killCode ?? 1);
			}, opts.errorOnKill ? 3 : 1);
		}
		return true;
	};
	return {
		child,
		killCalls,
		deliverClose: (code: number | null) => {
			child.emit("close", code);
		},
		deliverError: (error: Error) => {
			child.emit("error", error);
		},
		emitStdout: (text: string) => {
			stdout.emit("data", text);
		},
	};
}

/** Race a helper call against a test-side cap (ms): with the helper's own
 *  timeout removed (mutation M8) the cap wins and the result is null, which
 *  the following assertions turn into a red by assertion — never a bun
 *  5 s per-test timeout red. */
async function withinMs<T>(pending: Promise<T>, capMs: number): Promise<T | null> {
	let timer: ReturnType<typeof setTimeout>;
	const outcome = (await Promise.race([
		pending,
		new Promise<null>((resolve) => {
			timer = setTimeout(() => resolve(null), capMs);
		}),
	])) as T | null;
	clearTimeout(timer!);
	return outcome;
}

/** Tracks PENDING timers across an injected setTimeout/clearTimeout pair:
 *  after a bounded helper settles, no timer may be left scheduled
 *  (F5 — a synchronous kill error must not leave the kill-wait timer
 *  scheduled after settlement). A fired timer removes itself, so
 *  `active()` counts only still-pending timers. */
function timerLedger() {
	const live = new Set<unknown>();
	return {
		active: () => live.size,
		setTimeout: (fn: (...args: unknown[]) => void, ms: number) => {
			const id: unknown = setTimeout(() => {
				live.delete(id);
				fn();
			}, ms);
			live.add(id);
			return id;
		},
		clearTimeout: (id: unknown) => {
			live.delete(id);
			clearTimeout(id as ReturnType<typeof setTimeout>);
		},
	};
}

// (F9) A minimal deterministic virtual clock for the native-fixture port:
// timers are scheduled in virtual milliseconds and fire only when the
// clock is advanced (in order, up to the requested bound). No real
// waiting. Timers scheduled by fired callbacks fire too if they fall
// inside the remaining advance.
function virtualClock() {
	let now = 0;
	let nextId = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	return {
		now: () => now,
		pending: () => timers.size,
		setTimeout: (fn: () => void, ms: number) => {
			const id = nextId++;
			timers.set(id, { at: now + ms, fn });
			return id;
		},
		clearTimeout: (id: unknown) => {
			timers.delete(id as number);
		},
		advance: (ms: number) => {
			const until = now + ms;
			for (;;) {
				let nextAt: number | null = null;
				for (const entry of timers.values()) {
					if (entry.at <= until && (nextAt === null || entry.at < nextAt)) nextAt = entry.at;
				}
				if (nextAt === null) break;
				const firing: (() => void)[] = [];
				for (const [id, entry] of [...timers]) {
					if (entry.at === nextAt) {
						timers.delete(id);
						firing.push(entry.fn);
					}
				}
				now = nextAt;
				for (const fn of firing) fn();
			}
			now = until;
		},
	};
}

describe("teardownChild", () => {
	// (a)
	test("deadline path: same identity, taskkill 0, close → reaped:true, signalled:true", async () => {
		const child = fakeChild(4242);
		const probe = identityQueue([{ state: "alive", id: "id-A" }]); // pre-signal re-check: same id
		const tk = taskkillRunner(0);
		const result = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity: probe.fn,
			runTaskkill: (pid: number) => {
				tk.pids.push(pid);
				// A successful taskkill ends the process: the handle closes.
				exitChild(child, 1, null);
				return { status: 0, error: null };
			},
			closeTimeoutMs: 50,
		});
		expect(result.reaped).toBe(true);
		expect(result.signalled).toBe(true);
		expect(result.exitCode).toBe(1);
		expect(result.pid).toBe(4242);
		expect(result.refused).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(tk.pids).toEqual([4242]);
		expect(probe.pids).toEqual([4242]); // re-checked exactly once, right before the signal
	}, 5_000);

	// (b)
	test("taskkill 128 with the child still alive → reaped:false, error names 128, no second signal", async () => {
		const child = fakeChild(4242);
		const probe = identityQueue([
			{ state: "alive", id: "id-A" }, // pre-signal re-check: same id → signal allowed
			{ state: "alive", id: "id-B" }, // after the failed signal: the identity moved
		]);
		const tk = taskkillRunner(128);
		const result = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity: probe.fn,
			runTaskkill: tk.fn,
			closeTimeoutMs: 40,
		});
		expect(result.reaped).toBe(false);
		expect(result.signalled).toBe(false);
		expect(result.exitCode).toBeNull();
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("taskkill /PID 4242 /T /F exited 128");
		expect(tk.pids).toEqual([4242]); // exactly one attempt — never a second signal
	}, 5_000);

	// (c)
	test("taskkill runner throws / returns error → recorded, reaped:false", async () => {
		// c1: the runner throws.
		const childA = fakeChild(4243);
		const probeA = identityQueue([{ state: "alive", id: "id-A" }]);
		const resultA = await teardownChild(childA, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity: probeA.fn,
			runTaskkill: (_pid: number) => {
				throw new Error("taskkill ENOENT");
			},
			closeTimeoutMs: 40,
		});
		expect(resultA.reaped).toBe(false);
		expect(resultA.signalled).toBe(false);
		expect(resultA.errors.some((e) => e.includes("taskkill runner threw: taskkill ENOENT"))).toBe(true);
		// c2: the runner returns a spawn error (status null).
		const childB = fakeChild(4244);
		const probeB = identityQueue([{ state: "alive", id: "id-B" }]);
		const resultB = await teardownChild(childB, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-B" },
			identity: probeB.fn,
			runTaskkill: (_pid: number) => ({ status: null, error: new Error("spawn taskkill ENOENT") }),
			closeTimeoutMs: 40,
		});
		expect(resultB.reaped).toBe(false);
		expect(resultB.signalled).toBe(false);
		expect(resultB.errors.some((e) => e.includes("taskkill /PID 4244 /T /F failed to run"))).toBe(true);
	}, 5_000);

	// (d)
	test("close vs error race (error then close; and close only) → one resolution, listeners removed", async () => {
		// d1: the error is emitted, then the close (code null → not reaped).
		const childA = fakeChild(4245);
		const probeA = identityQueue([{ state: "alive", id: "id-A" }]);
		setTimeout(() => {
			childA.emit("error", new Error("spawn ENOENT"));
			exitChild(childA, null, null);
		}, 5);
		const resultA = await teardownChild(childA, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity: probeA.fn,
			runTaskkill: (_pid: number) => ({ status: 0, error: null }),
			closeTimeoutMs: 60,
		});
		expect(resultA.reaped).toBe(false); // code null, signal null → no real reap
		expect(resultA.errors).toHaveLength(1); // recorded exactly once
		expect(resultA.errors[0]).toContain("spawn ENOENT");
		expect(childA.listenerCount("close")).toBe(0); // helper's listeners removed
		expect(childA.listenerCount("error")).toBe(0);
		// d2: the close only.
		const childB = fakeChild(4246);
		const probeB = identityQueue([{ state: "alive", id: "id-B" }]);
		setTimeout(() => exitChild(childB, 0, null), 5);
		const resultB = await teardownChild(childB, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-B" },
			identity: probeB.fn,
			runTaskkill: (_pid: number) => ({ status: 0, error: null }),
			closeTimeoutMs: 60,
		});
		expect(resultB.reaped).toBe(true);
		expect(resultB.exitCode).toBe(0);
		expect(resultB.errors).toEqual([]);
		expect(childB.listenerCount("close")).toBe(0);
		expect(childB.listenerCount("error")).toBe(0);
	}, 5_000);

	// (e)
	test("surviving child (no close within the bounded wait) → reaped:false, no false reaping", async () => {
		const child = fakeChild(4247);
		const probe = identityQueue([{ state: "alive", id: "id-A" }]);
		const tk = taskkillRunner(0);
		const result = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity: probe.fn,
			runTaskkill: tk.fn,
			closeTimeoutMs: 40,
		});
		expect(result.reaped).toBe(false); // the signal succeeded but the process survived
		expect(result.signalled).toBe(true);
		expect(result.exitCode).toBeNull();
		expect(result.signalCode).toBeNull();
		expect(tk.pids).toEqual([4247]); // no second signal after the wait
		expect(child.listenerCount("close")).toBe(0);
		expect(child.listenerCount("error")).toBe(0);
	}, 5_000);

	// (f)
	test("identity changed before the signal → refused, runner never called", async () => {
		const child = fakeChild(4248);
		const probe = identityQueue([{ state: "alive", id: "id-B" }]); // ≠ bound id-A
		const tk = taskkillRunner(0);
		const result = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity: probe.fn,
			runTaskkill: tk.fn,
			closeTimeoutMs: 40,
		});
		expect(result.reaped).toBe(false);
		expect(result.signalled).toBe(false);
		expect(tk.pids).toEqual([]);
		expect(result.refused.some((r) => r.includes("identity changed since spawn (id-A -> id-B)"))).toBe(true);
		expect(result.signalIdentity).toEqual({ state: "alive", id: "id-B" });
	}, 5_000);

	// (g)
	test("unknown identity (at capture or at signal) → refused, never signalled", async () => {
		// g1: the captured (bound) identity is unknown.
		const childA = fakeChild(4249);
		const probeA = identityQueue([]);
		const tkA = taskkillRunner(0);
		const resultA = await teardownChild(childA, {
			platform: "win32",
			boundIdentity: { state: "unknown", error: "capture failed" },
			identity: probeA.fn,
			runTaskkill: tkA.fn,
			closeTimeoutMs: 40,
		});
		expect(resultA.signalled).toBe(false);
		expect(tkA.pids).toEqual([]);
		expect(probeA.pids).toEqual([]); // unknown at capture: no re-probe either
		expect(resultA.refused.some((r) => r.includes("unknown (capture failed)"))).toBe(true);
		expect(resultA.reaped).toBe(false);
		// g2: the bound identity is alive but the pre-signal re-check is unknown.
		const childB = fakeChild(4250);
		const probeB = identityQueue([{ state: "unknown", error: "cim timeout" }]);
		const tkB = taskkillRunner(0);
		const resultB = await teardownChild(childB, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity: probeB.fn,
			runTaskkill: tkB.fn,
			closeTimeoutMs: 40,
		});
		expect(resultB.signalled).toBe(false);
		expect(tkB.pids).toEqual([]);
		expect(resultB.refused.some((r) => r.includes("identity unknown at the pre-signal re-check (cim timeout)"))).toBe(true);
		expect(resultB.reaped).toBe(false);
	}, 5_000);

	// (h)
	test("gone identity (at capture or at signal) → no signal, waits for the close", async () => {
		// h1: the bound identity is already gone at capture.
		const childA = fakeChild(4251);
		const probeA = identityQueue([]);
		const tkA = taskkillRunner(0);
		setTimeout(() => exitChild(childA, 0, null), 5);
		const resultA = await teardownChild(childA, {
			platform: "win32",
			boundIdentity: { state: "gone" },
			identity: probeA.fn,
			runTaskkill: tkA.fn,
			closeTimeoutMs: 60,
		});
		expect(resultA.signalled).toBe(false);
		expect(tkA.pids).toEqual([]);
		expect(resultA.refused.some((r) => r.includes("bound identity for pid 4251 is gone"))).toBe(true);
		expect(resultA.reaped).toBe(true); // the pending close still counts
		expect(resultA.exitCode).toBe(0);
		// h2: the pre-signal re-check proves gone.
		const childB = fakeChild(4252);
		const probeB = identityQueue([{ state: "gone" }]);
		const tkB = taskkillRunner(0);
		setTimeout(() => exitChild(childB, 0, null), 5);
		const resultB = await teardownChild(childB, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity: probeB.fn,
			runTaskkill: tkB.fn,
			closeTimeoutMs: 60,
		});
		expect(resultB.signalled).toBe(false);
		expect(tkB.pids).toEqual([]);
		expect(resultB.refused.some((r) => r.includes("gone at the pre-signal re-check"))).toBe(true);
		expect(resultB.reaped).toBe(true);
	}, 5_000);

	// (i)
	test("POSIX: successful reap via kill(SIGKILL) on the held handle", async () => {
		const child = fakeChild(4253);
		// A SIGKILL on the live handle ends the process: emit the real close.
		const originalKill = child.kill;
		child.kill = (signal?: string) => {
			const ok = originalKill(signal);
			if (signal === "SIGKILL") exitChild(child, null, "SIGKILL");
			return ok;
		};
		const probe = identityQueue([{ state: "alive", id: "173" }]);
		const result = await teardownChild(child, {
			platform: "linux",
			boundIdentity: { state: "alive", id: "173" },
			identity: probe.fn,
			closeTimeoutMs: 50,
		});
		expect(result.reaped).toBe(true);
		expect(result.signalled).toBe(true);
		expect(result.signalCode).toBe("SIGKILL");
		expect(child.killCalls).toEqual(["SIGKILL"]);
		expect(result.errors).toEqual([]);
	}, 5_000);

	test("captureIdentity: the helper captures the identity through the probe", async () => {
		const child = fakeChild(4254);
		const probe = identityQueue([
			{ state: "alive", id: "id-C" }, // the capture step
			{ state: "alive", id: "id-C" }, // the pre-signal re-check: same id
		]);
		const result = await teardownChild(child, {
			platform: "win32",
			captureIdentity: true,
			identity: probe.fn,
			runTaskkill: (pid: number) => {
				exitChild(child, 1, null);
				return { status: 0, error: null };
			},
			closeTimeoutMs: 50,
		});
		expect(result.boundIdentity).toEqual({ state: "alive", id: "id-C" });
		expect(result.reaped).toBe(true);
		expect(result.signalled).toBe(true);
		expect(probe.pids).toEqual([4254, 4254]);
	}, 5_000);

	test("captureIdentity path: exit during the capture voids the identity (gone, no signal)", async () => {
		const child = fakeChild(4264);
		const identity = async (_pid: number): Promise<Identity> => {
			// The child exits while the capture probe runs: the probe's answer
			// may describe a recycled pid and must never be bound.
			child.exitCode = 1;
			return { state: "alive", id: "recycled-id" };
		};
		const tk = taskkillRunner(0);
		const result = await teardownChild(child, {
			platform: "win32",
			captureIdentity: true,
			identity,
			runTaskkill: tk.fn,
			closeTimeoutMs: 40,
		});
		expect(result.boundIdentity).toEqual({ state: "gone" });
		expect(result.signalled).toBe(false);
		expect(tk.pids).toEqual([]);
		expect(result.refused.some((r) => r.includes("bound identity for pid 4264 is gone"))).toBe(true);
		expect(result.reaped).toBe(true); // the handle shows the real exit
	}, 5_000);

	// F1: an exit observed during the final pre-signal identity lookup voids
	// the signal — even when the lookup returned the matching bound id.
	test("child exits during the final pre-signal identity lookup → no signal, real exit facts", async () => {
		const child = fakeChild(4270);
		const tk = taskkillRunner(0);
		const identity = async (_pid: number): Promise<Identity> => {
			// The child exits while the final probe runs: the probe may have
			// seen a recycled pid — with the matching id, still no signal.
			child.exitCode = 1;
			return { state: "alive", id: "id-A" };
		};
		const result = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity,
			runTaskkill: tk.fn,
			closeTimeoutMs: 40,
		});
		expect(result.signalled).toBe(false);
		expect(tk.pids).toEqual([]);
		expect(result.reaped).toBe(true); // the real exit on the handle
		expect(result.exitCode).toBe(1);
		expect(result.refused.some((r) => r.includes("exited during the pre-signal re-check"))).toBe(true);
	}, 5_000);

	// Ported reviewer case (rv-sec review-boundaries.test.ts): "do not
	// dispatch taskkill if the child exited during its pre-signal identity
	// lookup" (same scenario and entry point; closeTimeoutMs kept at 1 as in
	// the reviewer's harness).
	test("do not dispatch taskkill if the child exited during its pre-signal identity lookup", async () => {
		const child = fakeChild(7654321);
		const calls: number[] = [];
		const result = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "original" },
			identity: async () => {
				child.exitCode = 1;
				return { state: "alive", id: "original" };
			},
			runTaskkill: (pid: number) => {
				calls.push(pid);
				return { status: 0 };
			},
			closeTimeoutMs: 1,
		});
		expect(result.reaped).toBe(true);
		expect(calls).toEqual([]);
	}, 5_000);

	// F2/F4 (review port): a probe child that never closes is killed on the
	// probe's OWN deadline, its close is verified (a real close event —
	// "reaped"), and the result fails closed to `unknown` (no signal). The
	// reviewer's slow-discovery/probe-abandonment scenarios are now bounded
	// inside the probe's owned lifecycle, not in a Promise race.
	test("a probe child that closes after the deadline kill → unknown + probeCleanup reaped, no signal", async () => {
		const child = fakeChild(4271);
		const tk = taskkillRunner(0);
		const probeChild = fakeProbeChild({ pid: 98765, closeOnKill: true });
		const probe = boundedIdentityProbe("win32", {
			spawn: () => probeChild.child,
			probeTimeoutMs: 20,
			probeKillWaitMs: 40,
		});
		const result = await withinMs(
			teardownChild(child, {
				platform: "win32",
				boundIdentity: { state: "alive", id: "id-A" },
				identity: probe,
				runTaskkill: tk.fn,
				closeTimeoutMs: 40,
			}),
			300,
		);
		expect(result).not.toBeNull();
		expect(probeChild.killCalls).toHaveLength(1);
		expect(result.signalled).toBe(false);
		expect(tk.pids).toEqual([]);
		expect(result.reaped).toBe(false);
		expect(result.signalIdentity.state).toBe("unknown");
		expect(result.signalIdentity.error).toContain("identity probe timed out after 20ms");
		expect(result.signalIdentity.probeCleanup).toBe("reaped");
		expect(result.signalIdentity.probePid).toBe(98765);
		expect(result.probeResidue).toBe(false);
		expect(result.errors).toHaveLength(0);
		expect(child.listenerCount("close")).toBe(0);
		expect(child.listenerCount("error")).toBe(0);
		expect(probeChild.child.listenerCount("close")).toBe(0);
		expect(probeChild.child.listenerCount("error")).toBe(0);
		expect(probeChild.child.stdout.listenerCount("data")).toBe(0);
	}, 5_000);

	// F4 (review port): a probe child that survives its own kill is residue:
	// the capture carries probeCleanup "unreaped", the teardown records
	// probeResidue (naming the probe pid), and shouldRemoveSandbox fails
	// closed — the sandbox is kept while the probe child may still run.
	test("captureIdentity: a probe child that never closes even after kill → unknown + unreaped → probeResidue, sandbox kept", async () => {
		const child = fakeChild(4272);
		const tk = taskkillRunner(0);
		const probeChild = fakeProbeChild({ pid: 98766, closeOnKill: false });
		const probe = boundedIdentityProbe("win32", {
			spawn: () => probeChild.child,
			probeTimeoutMs: 20,
			probeKillWaitMs: 30,
		});
		const result = await withinMs(
			teardownChild(child, {
				platform: "win32",
				captureIdentity: true,
				identity: probe,
				runTaskkill: tk.fn,
				closeTimeoutMs: 40,
			}),
			300,
		);
		expect(result).not.toBeNull();
		expect(probeChild.killCalls).toHaveLength(1);
		expect(result.boundIdentity.state).toBe("unknown");
		expect(result.boundIdentity.error).toContain("identity probe timed out after 20ms");
		expect(result.boundIdentity.probeCleanup).toBe("unreaped");
		expect(result.signalled).toBe(false);
		expect(tk.pids).toEqual([]);
		expect(result.reaped).toBe(false);
		expect(result.probeResidue).toBe(true);
		expect(result.errors.some((e) => e.includes("identity probe child pid 98766"))).toBe(true);
		expect(shouldRemoveSandbox({ ...result })).toBe(false);
		expect(child.listenerCount("close")).toBe(0);
		expect(child.listenerCount("error")).toBe(0);
	}, 5_000);

	// F2: a runner that never resolves is a recorded timeout failure — the
	// teardown deadline is not defeated (ported reviewer case, with an
	// injected taskkillTimeoutMs so the whole call stays well under bun's
	// per-test timeout; the reviewer's harness raced the whole call against
	// 30 ms under the 8000 ms production default, which cannot settle in
	// time — the scenario is kept, the timing is injected).
	test("a runner that never resolves must not defeat the teardown deadline", async () => {
		const child = fakeChild(7654322);
		const pending = teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "original" },
			identity: async () => ({ state: "alive", id: "original" }),
			runTaskkill: () => new Promise(() => {}),
			taskkillTimeoutMs: 20,
			closeTimeoutMs: 20,
		});
		let timer: ReturnType<typeof setTimeout>;
		const settled = await Promise.race([
			pending.then(() => true),
			new Promise<boolean>((r) => {
				timer = setTimeout(() => r(false), 100);
			}),
		]);
		clearTimeout(timer!);
		expect(settled).toBe(true);
		const result = await pending;
		expect(result.signalled).toBe(false);
		expect(result.reaped).toBe(false);
		expect(result.errors.some((e) => e.includes("taskkill /PID 7654322 /T /F timed out after 20ms"))).toBe(true);
		expect(child.listenerCount("close")).toBe(0);
		expect(child.listenerCount("error")).toBe(0);
	}, 5_000);

	test("no bound identity and no captureIdentity → refused, never signalled", async () => {
		const child = fakeChild(4255);
		const probe = identityQueue([]);
		const tk = taskkillRunner(0);
		const result = await teardownChild(child, {
			platform: "win32",
			identity: probe.fn,
			runTaskkill: tk.fn,
			closeTimeoutMs: 40,
		});
		expect(result.signalled).toBe(false);
		expect(tk.pids).toEqual([]);
		expect(probe.pids).toEqual([]);
		expect(result.refused.some((r) => r.includes("no bound identity"))).toBe(true);
		expect(result.reaped).toBe(false);
	}, 5_000);

	test("child that never spawned (no pid) → no signal, bounded wait, reaped:false", async () => {
		const child = fakeChild(null);
		const probe = identityQueue([]);
		const tk = taskkillRunner(0);
		setTimeout(() => exitChild(child, null, null), 5);
		const result = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity: probe.fn,
			runTaskkill: tk.fn,
			closeTimeoutMs: 60,
		});
		expect(result.signalled).toBe(false);
		expect(tk.pids).toEqual([]);
		expect(result.refused.some((r) => r.includes("never got a pid"))).toBe(true);
		expect(result.reaped).toBe(false);
		expect(result.pid).toBeNull();
	}, 5_000);

	test("child already exited (exitCode set) → no signal, reaped:true read from the handle", async () => {
		const child = fakeChild(4256);
		exitChild(child, 1, null); // closes before teardownChild is even called
		const probe = identityQueue([]);
		const tk = taskkillRunner(0);
		const result = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "id-A" },
			identity: probe.fn,
			runTaskkill: tk.fn,
			closeTimeoutMs: 40,
		});
		expect(result.signalled).toBe(false);
		expect(tk.pids).toEqual([]);
		expect(result.reaped).toBe(true);
		expect(result.exitCode).toBe(1);
		expect(result.refused).toEqual([]);
		expect(result.errors).toEqual([]);
	}, 5_000);

	// (F7) default identity: `options.identity` omitted →
	// boundedIdentityProbe (owned bounded lifecycle, default bounds) —
	// NEVER identityOfFor's synchronous, unbounded subprocess probes.
	// The probe seams are injected: a fake spawn drives the default probe
	// end-to-end, and a throwing spawnSync stub proves the default path
	// never calls spawnSync (a synchronous-discovery regression goes red
	// here and in the signal assertion below).
	test("default identity (no options.identity) is the bounded probe: no spawnSync, fake spawn drives it", async () => {
		const child = fakeChild(6501);
		const pc = fakeProbeChild({ pid: 123 });
		const probeSpawnSyncCalls: string[] = [];
		const runnerPids: number[] = [];
		const pending = teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "42" },
			probeSpawn: () => pc.child,
			probeSpawnSync: (cmd: string) => {
				probeSpawnSyncCalls.push(cmd);
				throw new Error(`spawnSync called: ${cmd}`);
			},
			probeTimeoutMs: 60,
			probeKillWaitMs: 60,
			runTaskkill: (pid: number) => {
				runnerPids.push(pid);
				return { status: 0, error: null };
			},
			closeTimeoutMs: 60,
		});
		// The default bounded probe must answer with the bound id, and the
		// root child exits and closes after the (fake, status-checked)
		// signal:
		pc.emitStdout("42\n");
		setTimeout(() => pc.child.emit("close", 0), 5);
		setTimeout(() => exitChild(child, 0, null), 10);
		const result = await pending;
		expect(result.signalled).toBe(true);
		expect(result.reaped).toBe(true);
		expect(result.probeResidue).toBe(false);
		expect(probeSpawnSyncCalls).toEqual([]);
		expect(runnerPids).toEqual([6501]);
	}, 5_000);
});

describe("waitChildOutcome", () => {
	test("close settles with the exit code and removes its listeners", async () => {
		const child = fakeChild(4280);
		setTimeout(() => exitChild(child, 1, null), 5);
		const outcome = await waitChildOutcome(child, { deadlineMs: 60 });
		expect(outcome.kind).toBe("close");
		expect(outcome.code).toBe(1);
		expect(outcome.error).toBeNull();
		expect(child.listenerCount("close")).toBe(0);
		expect(child.listenerCount("error")).toBe(0);
	}, 5_000);

	test("error before close settles with the error and removes its listeners", async () => {
		const child = fakeChild(4281);
		const error = new Error("spawn ENOENT");
		setTimeout(() => child.emit("error", error), 5);
		const outcome = await waitChildOutcome(child, { deadlineMs: 60 });
		expect(outcome.kind).toBe("error");
		expect(outcome.error).toBe(error);
		expect(outcome.code).toBeNull();
		expect(child.listenerCount("close")).toBe(0);
		expect(child.listenerCount("error")).toBe(0);
		// A late close must not re-settle or leak a listener.
		exitChild(child, null, null);
		expect(child.listenerCount("close")).toBe(0);
		expect(child.listenerCount("error")).toBe(0);
	}, 5_000);

	test("the deadline settles with kind deadline and removes its listeners", async () => {
		const child = fakeChild(4282);
		const outcome = await waitChildOutcome(child, { deadlineMs: 40 });
		expect(outcome.kind).toBe("deadline");
		expect(outcome.code).toBeNull();
		expect(outcome.error).toBeNull();
		expect(child.listenerCount("close")).toBe(0);
		expect(child.listenerCount("error")).toBe(0);
	}, 5_000);
});

describe("captureChildIdentity", () => {
	test("exit on the handle during the probe → gone, never the captured (recycled) id", async () => {
		const child = fakeChild(4260);
		const probe = async (_pid: number): Promise<Identity> => {
			// The child exits while the probe is running: by the time the
			// probe returns, the pid may belong to a recycled process.
			child.exitCode = 1;
			return { state: "alive", id: "recycled-id" };
		};
		const out = await captureChildIdentity(child, probe);
		expect(out).toEqual({ state: "gone" });
	}, 5_000);

	test("signal exit on the handle during the probe → gone", async () => {
		const child = fakeChild(4261);
		const probe = async (_pid: number): Promise<Identity> => {
			child.signalCode = "SIGKILL";
			return { state: "alive", id: "recycled-id" };
		};
		expect(await captureChildIdentity(child, probe)).toEqual({ state: "gone" });
	}, 5_000);

	test("no exit when the probe finishes → the captured identity is valid", async () => {
		const child = fakeChild(4262);
		const probe = async (_pid: number): Promise<Identity> => ({ state: "alive", id: "id-X" });
		expect(await captureChildIdentity(child, probe)).toEqual({ state: "alive", id: "id-X" });
	}, 5_000);

	test("a throwing probe → unknown (never gone); a child without a pid → null", async () => {
		const childA = fakeChild(4263);
		const throwing = async (): Promise<Identity> => {
			throw new Error("probe exploded");
		};
		const outA = await captureChildIdentity(childA, throwing);
		expect(outA.state).toBe("unknown");
		expect(outA.error).toContain("probe exploded");
		const outB = await captureChildIdentity(fakeChild(null), async () => ({ state: "alive", id: "id" }));
		expect(outB).toBeNull();
	}, 5_000);

	// F2/F4: the capture probe is owned: a probe child that closes after
	// the deadline kill settles unknown + reaped (bounded and verified);
	// the residue tag rides along on the normalized identity.
	test("a probe child that closes after the deadline kill → unknown via the owned lifecycle, bounded", async () => {
		const child = fakeChild(4273);
		const probeChild = fakeProbeChild({ pid: 98767, closeOnKill: true });
		const probe = boundedIdentityProbe("win32", {
			spawn: () => probeChild.child,
			probeTimeoutMs: 20,
			probeKillWaitMs: 40,
		});
		const out = await withinMs(captureChildIdentity(child, probe), 300);
		expect(out).not.toBeNull();
		expect(out).toEqual({
			state: "unknown",
			error: "identity probe timed out after 20ms",
			probeCleanup: "reaped",
			probePid: 98767,
		});
	}, 5_000);

	// F4: an unreaped probe child's residue tag survives the post-capture
	// voiding (root exits during the probe) — the bound identity is `gone`
	// but still carries the residue so sandbox removal fails closed.
	test("exit during the probe with an unreaped probe child → gone + probeCleanup unreaped", async () => {
		const child = fakeChild(4274);
		const probeChild = fakeProbeChild({ pid: 98768, closeOnKill: false });
		const probe = boundedIdentityProbe("win32", {
			spawn: () => probeChild.child,
			probeTimeoutMs: 20,
			probeKillWaitMs: 30,
		});
		const pending = captureChildIdentity(child, probe);
		setTimeout(() => {
			child.exitCode = 1; // the root exits while the probe runs
		}, 5);
		const out = await withinMs(pending, 300);
		expect(out).not.toBeNull();
		expect(out).toEqual({
			state: "gone",
			probeCleanup: "unreaped",
			probePid: 98768,
		});
		// And a caller passing such a bound identity into the teardown gets
		// probeResidue without any signal.
		const tk = taskkillRunner(0);
		const res: any = await teardownChild(child, {
			platform: "win32",
			boundIdentity: out,
			identity: async () => ({ state: "gone" }),
			runTaskkill: tk.fn,
			closeTimeoutMs: 40,
		});
		expect(res.signalled).toBe(false);
		expect(res.probeResidue).toBe(true);
		expect(shouldRemoveSandbox({ ...res })).toBe(false);
	}, 5_000);
});

describe("boundedIdentityProbe", () => {
	// win32 mapping — byte-for-byte the identityOfFor("win32") contract:
	test("win32: exit code and stdout map to the identityOfFor contract (alive digits / gone / unknown)", async () => {
		const mk = (code: number, stdout: string) => {
			const pc = fakeProbeChild({ pid: 111 });
			// The probe attaches its stdout listener synchronously during the
			// call, so emit AFTER the call (like a real child: spawn first,
			// then output, then close).
			const pending = boundedIdentityProbe("win32", { spawn: () => pc.child, probeTimeoutMs: 40 })(1234);
			pc.emitStdout(stdout);
			setTimeout(() => pc.deliverClose(code), 1);
			return pending.then((out: any) => ({ out, pc }));
		};
		const a = await mk(0, "134361180000000000\n");
		expect(a.out).toEqual({ state: "alive", id: "134361180000000000" });
		expect(a.pc.killCalls).toEqual([]);
		const g = await mk(3, "");
		expect(g.out).toEqual({ state: "gone" });
		const u4 = await mk(4, "");
		expect(u4.out.state).toBe("unknown");
		expect(u4.out.error).toContain("exited 4");
		const u2 = await mk(2, "");
		expect(u2.out.state).toBe("unknown");
		expect(u2.out.error).toContain("exited 2");
		// listeners/timers cleared after settlement
		expect(a.pc.child.listenerCount("close")).toBe(0);
		expect(a.pc.child.listenerCount("error")).toBe(0);
		expect(a.pc.child.stdout.listenerCount("data")).toBe(0);
	}, 5_000);

	// darwin mapping — the same parsing as identityOfFor("darwin"):
	test("darwin: Z stat → gone, status 1 + empty → gone, lstart text → alive id, other → unknown", async () => {
		const mk = (code: number, stdout: string) => {
			const pc = fakeProbeChild({ pid: 111 });
			const pending = boundedIdentityProbe("darwin", { spawn: () => pc.child, probeTimeoutMs: 40 })(1234);
			pc.emitStdout(stdout);
			setTimeout(() => pc.deliverClose(code), 1);
			return pending.then((out: any) => ({ out, pc }));
		};
		const a = await mk(0, "S   Mon Oct 10 12:00:00 2026\n");
		expect(a.out).toEqual({ state: "alive", id: "Mon Oct 10 12:00:00 2026" });
		const z = await mk(0, "Z   Mon Oct 10 12:00:00 2026\n");
		expect(z.out).toEqual({ state: "gone" });
		const g1 = await mk(1, "");
		expect(g1.out).toEqual({ state: "gone" });
		const u = await mk(2, "garbage");
		expect(u.out.state).toBe("unknown");
		expect(u.out.error).toContain("ps exited 2");
	}, 5_000);

	// F2 (review port — slow synchronous discovery): NO synchronous
	// subprocess call happens on the probe path: the throwing spawnSync
	// stub is never called, and the probe works through the single
	// asynchronous spawn (no executable discovery, no synchronous ps).
	test("no synchronous subprocess on the probe path: a throwing spawnSync stub is never called", async () => {
		const spawnSyncCalls: string[] = [];
		const throwingSpawnSync = (cmd: string) => {
			spawnSyncCalls.push(cmd);
			throw new Error(`synchronous spawnSync reached the probe path: ${cmd}`);
		};
		const pc = fakeProbeChild({ pid: 111 });
		const pending = boundedIdentityProbe("win32", {
			spawn: () => pc.child,
			spawnSync: throwingSpawnSync,
			probeTimeoutMs: 40,
		})(1234);
		pc.emitStdout("134361180000000000\n");
		setTimeout(() => pc.deliverClose(0), 1);
		const out: any = await pending;
		expect(out).toEqual({ state: "alive", id: "134361180000000000" });
		expect(spawnSyncCalls).toEqual([]);
	}, 5_000);

	// F4 (review port — probe abandonment): a probe child that never closes
	// is killed on the deadline and its close is VERIFIED (a real close
	// event — "reaped"), never assumed.
	test("a probe child that never closes → deadline kill → close verified → unknown + probeCleanup reaped", async () => {
		const pc = fakeProbeChild({ pid: 777, closeOnKill: true });
		const probe = boundedIdentityProbe("win32", {
			spawn: () => pc.child,
			probeTimeoutMs: 20,
			probeKillWaitMs: 40,
		});
		const out: any = await withinMs(probe(1234), 300);
		expect(out).not.toBeNull();
		expect(pc.killCalls).toHaveLength(1);
		expect(out).toEqual({
			state: "unknown",
			error: "identity probe timed out after 20ms",
			probeCleanup: "reaped",
			probePid: 777,
		});
		// every probe listener/timer is gone
		expect(pc.child.listenerCount("close")).toBe(0);
		expect(pc.child.listenerCount("error")).toBe(0);
		expect(pc.child.stdout.listenerCount("data")).toBe(0);
	}, 5_000);

	// F4 (review port): a probe child that SURVIVES the kill is residue —
	// unknown + unreaped (a fake "reaped" would be a success-shaped lie).
	test("a probe child that survives the kill → unknown + probeCleanup unreaped (residue)", async () => {
		const pc = fakeProbeChild({ pid: 778, closeOnKill: false });
		const probe = boundedIdentityProbe("win32", {
			spawn: () => pc.child,
			probeTimeoutMs: 20,
			probeKillWaitMs: 30,
		});
		const out: any = await withinMs(probe(1234), 300);
		expect(out).not.toBeNull();
		expect(pc.killCalls).toHaveLength(1);
		expect(out).toEqual({
			state: "unknown",
			error: "identity probe timed out after 20ms",
			probeCleanup: "unreaped",
			probePid: 778,
		});
	}, 5_000);

	// a spawn `error` event → unknown with the error text (never gone).
	test("a spawn error event → unknown with the error text (never gone)", async () => {
		const pc = fakeProbeChild({ pid: null });
		setTimeout(() => pc.deliverError(new Error("spawn ENOENT")), 1);
		const probe = boundedIdentityProbe("win32", {
			spawn: () => pc.child,
			probeTimeoutMs: 40,
		});
		const out: any = await probe(1234);
		expect(out.state).toBe("unknown");
		expect(out.error).toContain("spawn ENOENT");
	}, 5_000);

	// the pid is validated as a positive integer and inserted as a number
	// only — unvalidated input never reaches a subprocess.
	test("a non-positive-integer pid → unknown without spawning (win32 and darwin)", async () => {
		let spawned = 0;
		const fakeSpawn = () => {
			spawned += 1;
			return fakeProbeChild().child;
		};
		const probeW = boundedIdentityProbe("win32", { spawn: fakeSpawn, probeTimeoutMs: 30 });
		const outW: any = await probeW(-5);
		expect(outW.state).toBe("unknown");
		expect(outW.error).toContain("non-positive-integer");
		const outW2: any = await probeW("12" as never);
		expect(outW2.state).toBe("unknown");
		const probeD = boundedIdentityProbe("darwin", { spawn: fakeSpawn, probeTimeoutMs: 30 });
		const outD: any = await probeD(0);
		expect(outD.state).toBe("unknown");
		expect(spawned).toBe(0);
	}, 5_000);

	// linux delegates to identityOfFor("linux") — a synchronous /proc read,
	// no subprocess to bound or kill.
	test("linux: delegates to the /proc probe (no subprocess, no spawnSync)", async () => {
		const probe = boundedIdentityProbe("linux", { procDir: "/tmp/fake-proce-does-not-exist" });
		const out: any = await probe(4242);
		expect(out).toEqual({ state: "gone" });
		const bad: any = await probe(-1);
		expect(bad.state).toBe("unknown");
	}, 5_000);

	// A timed-out probe's partial output/exit code is NEVER mapped: even a
	// killed probe that "exits 3" (which would read as `gone`) settles as
	// the timeout `unknown` — untrusted partial state.
	test("a killed probe's exit code is never mapped (partial state is untrusted)", async () => {
		const pc = fakeProbeChild({ pid: 779, closeOnKill: true, killCode: 3 });
		const probe = boundedIdentityProbe("win32", {
			spawn: () => pc.child,
			probeTimeoutMs: 20,
			probeKillWaitMs: 40,
		});
		const out: any = await withinMs(probe(1234), 300);
		expect(out).not.toBeNull();
		expect(out.state).toBe("unknown");
		expect(out.error).toContain("timed out after 20ms");
		expect(out.probeCleanup).toBe("reaped");
	}, 5_000);

	// (F5) async kill error after the deadline: an `error` event once the
	// kill was attempted is a KILL failure, not a spawn failure — it must
	// NOT settle the probe as a generic unknown. The verified close still
	// decides "reaped"; the kill error is preserved and no
	// timers/listeners are left after settlement.
	test("(F5) async kill error after the deadline does NOT settle: verified close → unknown + reaped + killError", async () => {
		const pc = fakeProbeChild({ pid: 321, closeOnKill: true, errorOnKill: "kill: EPERM" });
		const ledger = timerLedger();
		const probe = boundedIdentityProbe("win32", {
			spawn: () => pc.child,
			probeTimeoutMs: 20,
			probeKillWaitMs: 40,
			setTimeout: ledger.setTimeout,
			clearTimeout: ledger.clearTimeout,
		});
		const out: any = await probe(321);
		expect(out.state).toBe("unknown");
		expect(out.error).toBe("identity probe timed out after 20ms");
		expect(out.probeCleanup).toBe("reaped");
		expect(out.probePid).toBe(321);
		expect(out.killError).toBe("kill: EPERM");
		expect(pc.killCalls).toHaveLength(1);
		expect(pc.child.listenerCount("close")).toBe(0);
		expect(pc.child.listenerCount("error")).toBe(0);
		expect(pc.child.stdout.listenerCount("data")).toBe(0);
		expect(ledger.active()).toBe(0);
	}, 5_000);

	// (F5) synchronous kill() failure with NO close: the kill-wait timer
	// (installed BEFORE kill()) expires → "unreaped" with the kill error;
	// settlement leaves no timers and no listeners scheduled.
	test("(F5) synchronous kill() failure: no close → kill-wait expires → unknown + unreaped + killError; nothing left after settlement", async () => {
		const pc = fakeProbeChild({ pid: 322, killThrows: "kill: ESRCH" });
		const ledger = timerLedger();
		const probe = boundedIdentityProbe("win32", {
			spawn: () => pc.child,
			probeTimeoutMs: 15,
			probeKillWaitMs: 30,
			setTimeout: ledger.setTimeout,
			clearTimeout: ledger.clearTimeout,
		});
		const out: any = await probe(322);
		expect(out).toEqual({
			state: "unknown",
			error: "identity probe timed out after 15ms",
			probeCleanup: "unreaped",
			probePid: 322,
			killError: "kill: ESRCH",
		});
		expect(pc.killCalls).toHaveLength(1);
		expect(pc.child.listenerCount("close")).toBe(0);
		expect(pc.child.listenerCount("error")).toBe(0);
		expect(pc.child.stdout.listenerCount("data")).toBe(0);
		expect(ledger.active()).toBe(0);
	}, 5_000);
});

// (A8/P3) ONE source builds the fixture ping's argv and hands it to the
// spawn function: the native test passes the REAL spawn (and asserts on
// the real handle's actual `spawnargs`), the deterministic port passes a
// recording spawnFn (and asserts on the recorded argv + derives the
// lifetime from it). The argv the native test ACTUALLY spawns and the
// argv the port models are the same function's output, so a native-only
// spawn-count mutant (a literal ["-n","20",…] in the native spawn call
// only) goes red on the native handle's spawnargs, and a count mutant
// goes red on the port's derived lifetime (the old tautological
// `expect(PING_ARGS).toContain(String(PING_COUNT))` checked a constant,
// not the spawned argv). `ping -n <N>` keeps the process alive ≈ N s.
const PING_COUNT = 120;
function spawnFixturePing<S>(
	spawnFn: (cmd: string, args: string[], opts: { stdio: string; windowsHide: boolean }) => S,
): S {
	const args = ["-n", String(PING_COUNT), "127.0.0.1"];
	return spawnFn("ping", args, { stdio: "ignore", windowsHide: true });
}


/* ---------------- A9 (amendment 9): the split native tests + shrunk-window
   teardown + F-argv -----------------------------------------------
   (F-tail) teardown starts only if the remaining window covers its
   EXISTING bounds (probe 8 s + kill-wait 2 s + taskkill 8 s + close
   10 s) shrunk to the time actually left, PLUS the held-handle
   close-wait margin (the existing 10 s close bound). Shrinking an
   existing option is allowed; NO bound is raised and NO new timeout
   knob exists: every reservation below is derived from the same named
   values that are passed to the calls (no parallel literal).
   (F-self) the native "consistency" check no longer compares
   boundedIdentityProbe with itself: the legacy cross-check is a
   separate childless test (A) on process.pid (never signalled); the
   ping test (B) reaps its own ping with NO reference.
   (F-argv) the native (B) asserts the REAL handle's spawnargs
   IMMEDIATELY after the spawn — BEFORE any probe — so a native-only
   literal-argv mutant goes red at the assert even on a slow host;
   the deterministic port asserts the recorded argv of the SAME
   spawnFixturePing (no CIM, no native child).
   The window clock starts at TEST ENTRY (before any probe) and is
   MONOTONIC (performance.now). The unchanged 30 s per-test cap is
   passed as data. */

const PROBE_MS = 8_000; // the existing default probeTimeoutMs
const PROBE_KILL_WAIT_MS = 2_000; // the existing default probeKillWaitMs
const TASKKILL_MS = 8_000; // the existing default taskkillTimeoutMs
const CLOSE_MS = 10_000; // the existing default closeTimeoutMs; the finally's held-handle close-wait margin
const TEARDOWN_TAIL_MS = PROBE_MS + PROBE_KILL_WAIT_MS + TASKKILL_MS + CLOSE_MS; // 28_000 — derived from the same values, never a parallel literal
const WINDOW_CAP_MS = 30_000; // the unchanged bun per-test cap (passed as data; never broadened)

// (amendment 2) ONE bounded structured line per REAL-process run (pass or
// refusal alike): the exact prefix + a single JSON object, truncated to at
// most 4096 bytes. Written through the injected writer seam — the real
// tests point it at process.stderr.write (never console.log), the
// deterministic tests inject a recording writer and never touch the real
// stderr. The payload carries NO environment values.
const TRACE_PREFIX = "child-teardown-trace ";
const TRACE_MAX_BYTES = 4096;
function buildTraceLine(payload: Record<string, unknown>): string {
	const line = `${TRACE_PREFIX}${JSON.stringify(payload)}`;
	if (Buffer.byteLength(line, "utf8") <= TRACE_MAX_BYTES) return line;
	return Buffer.from(line, "utf8").subarray(0, TRACE_MAX_BYTES).toString("utf8");
}

// (b) The NAMED bounded steps of a signalled:false result: the exact texts
// teardownChild records for each, mapped to the step's SHRUNK bound (the
// same named option the callback passed to the teardown) and to the step's
// MEASURED duration (the teardown result's timings — the injectable-clock
// step measurement). "exited during the pre-signal re-check" is the
// synchronous F1 handle check right after the re-probe: its duration lives
// in the re-probe's measurement. A signalled:false whose refused/errors
// name NONE of these is a red failure (never a silent green). A valid
// runner error ("failed to run") and a runner throw are the SAME bounded
// taskkill step as the timeout / non-zero / malformed / no-status texts.
const BOUNDED_STEPS: Array<{
	category: "identity" | "taskkill";
	match: RegExp;
	bound: (o: { probeTimeoutMs: number; probeKillWaitMs: number; taskkillTimeoutMs: number; closeTimeoutMs: number }) => number;
	timing: (t: any) => number | null;
}> = [
	{
		category: "identity",
		// identity probe timed out / unknown
		match: /identity probe timed out after|identity unknown at the pre-signal re-check|identity probe returned an unexpected shape|identity probe threw|identity probe child pid .* was not reaped after the probe timeout|bound identity .* is unknown/,
		bound: (o) => o.probeTimeoutMs,
		timing: (t) => (typeof t?.timings?.preSignalProbeMs === "number" ? t.timings.preSignalProbeMs : null),
	},
	{
		category: "identity",
		// pid gone
		match: /gone at the pre-signal re-check|bound identity .* is gone/,
		bound: (o) => o.probeTimeoutMs,
		timing: (t) => (typeof t?.timings?.preSignalProbeMs === "number" ? t.timings.preSignalProbeMs : null),
	},
	{
		category: "identity",
		// recycled pid
		match: /identity changed since spawn .* recycled pid/,
		bound: (o) => o.probeTimeoutMs,
		timing: (t) => (typeof t?.timings?.preSignalProbeMs === "number" ? t.timings.preSignalProbeMs : null),
	},
	{
		category: "identity",
		// exited during the pre-signal re-check (the F1 handle check)
		match: /exited during the pre-signal re-check/,
		bound: (o) => o.probeTimeoutMs,
		timing: (t) => (typeof t?.timings?.preSignalProbeMs === "number" ? t.timings.preSignalProbeMs : null),
	},
	{
		category: "taskkill",
		// taskkill timed out / exited non-zero / malformed / no status (the
		// same bounded step: a valid runner error, a runner throw)
		match: /taskkill \/PID \d+ \/T \/F (timed out after|exited|runner returned a malformed error|returned no exit status|failed to run)|taskkill runner threw/,
		bound: (o) => o.taskkillTimeoutMs,
		timing: (t) => (typeof t?.timings?.signalMs === "number" ? t.timings.signalMs : null),
	},
];
/** The first refused/errors entry that names a bounded step (or null). */
function matchBoundedStep(refused: unknown, errors: unknown): {
	category: "identity" | "taskkill";
	entry: string;
	bound: (o: any) => number;
	timing: (t: any) => number | null;
} | null {
	const entries: string[] = [];
	if (Array.isArray(refused)) for (const e of refused) if (typeof e === "string") entries.push(e);
	if (Array.isArray(errors)) for (const e of errors) if (typeof e === "string") entries.push(e);
	for (const step of BOUNDED_STEPS) {
		for (const entry of entries) {
			if (step.match.test(entry)) return { category: step.category, entry, bound: step.bound, timing: step.timing };
		}
	}
	return null;
}

// (A9) The ping-reap callback with injected seams — the SAME code the
// native test (B) runs with real seams and the deterministic tests
// drive with fakes + a virtual clock:
//   1. ONE owned probe on the ping, bounded to the remaining window via
//      the existing probeTimeoutMs cap (PROBE_MS — never raised) with
//      the probe kill-wait (PROBE_KILL_WAIT_MS) reserved; no budget →
//      fail fast with the fact BEFORE probing.
//   2. teardownChild starts ONLY if the remaining window covers its
//      existing bounds (shrunk to the time actually left from the SAME
//      named values — each ≤ its existing default, none raised) PLUS
//      the held-handle close-wait margin (CLOSE_MS). Otherwise it is
//      SKIPPED with the fact and the finally reaps through the held
//      handle (real close only).
//   3. Success requires the real teardown signal: signalled AND reaped
//      (the real close inside the helper's closeTimeoutMs).
//   4. Failure path (finally): held-handle kill, real close only (the
//      at-spawn observer; close is NEVER inferred from
//      exitCode/signalCode/exit), probeDir kept on the fact.
async function runConsistencyCallback(
	seams: {
		ping: {
			kill: (...args: unknown[]) => unknown;
			exitCode: number | null; // ChildProcess surface only — the callback NEVER reads it (F1: real close only)
			signalCode: string | null; // ChildProcess surface only — never read
		};
		pingPid: number;
		owned: (pid: number, probeMs: number) => Promise<any>;
		teardown: (
			pid: number,
			options: { probeTimeoutMs: number; probeKillWaitMs: number; taskkillTimeoutMs: number; closeTimeoutMs: number },
		) => Promise<any>;
		ownedResults: any[];
		teardowns: any[]; // the shrunk options (or { skipped: true, budgetMs }) + the diagnostic record
		clock: { now: () => number }; // real performance.now / the virtual clock
		windowStart: number; // the test's start (real ms / virtual 0) — the window INCLUDES everything before it
		windowCapMs: number; // the unchanged 30 s per-test cap (passed as data)
		closeTracker: { observed: boolean; code: number | null; signal: string | null }; // set ONLY by the at-spawn real-close observer
		awaitClose: () => Promise<void>; // resolves when the REAL close fires (may never resolve)
		setTimeoutFn: (fn: () => void, ms: number) => unknown;
		clearTimeoutFn: (id: unknown) => void;
		rmProbeDir: () => void;
		cleanup: { killRan: boolean; closeObserved: boolean };
		testName: string; // the test's title (the trace line's identity)
		writeTrace: (line: string) => void; // the trace writer (process.stderr.write in the real tests, a recorder in the deterministic ones)
	},
): Promise<{ owned: any; teardown: any }> {
	const deadline = seams.windowStart + seams.windowCapMs; // ONE window deadline from the test start
	const now = () => seams.clock.now();
	let windowExceeded = false; // any window-based fact → probeDir kept
	let success = false;
	let teardownResult: any = null;
	// (amendment 2) the run-wide facts for the ONE trace line the finally
	// emits (pass or refusal alike, before the probeDir decision): the
	// shrunk options once the teardown started, the owned probe's measured
	// duration + result, and who proved the owned real close (reapedBy).
	let startedOptions: any = null;
	let ownedResult: any = null;
	let ownedDurationMs: number | null = null;
	let reapedBy: "teardown" | "test-finally" | null = null;
	let diagnosticRecord: any = null;
	try {
		// (1) the owned probe on the ping, bounded to the remaining
		// window via the existing probeTimeoutMs cap (no new knob): the
		// cap is min(existing default, remaining − the probe kill-wait),
		// so the probe's own worst case (cap + kill-wait) fits the
		// remaining window. No budget → the fact BEFORE probing.
		const ownedRem = deadline - now();
		if (ownedRem <= PROBE_KILL_WAIT_MS) {
			windowExceeded = true;
			throw new Error(
				`consistency fixture: the shared 30 s window has no budget for the owned probe (remaining ${String(ownedRem)} ms ≤ the ${PROBE_KILL_WAIT_MS} ms probe kill-wait reservation); not probed; the ping is cleaned through its held handle and probeDir is kept`,
			);
		}
		const ownedStarted = now();
		const owned = await seams.owned(seams.pingPid, Math.min(PROBE_MS, ownedRem - PROBE_KILL_WAIT_MS));
		ownedDurationMs = now() - ownedStarted;
		ownedResult = owned;
		seams.ownedResults.push(owned);
		const ownedVerdict = consistencyProbeDecision({
			warmup: null,
			results: seams.ownedResults,
			a: null,
			b: null,
			teardowns: seams.teardowns,
		});
		expect(ownedVerdict.residue).toBe(false);
		if (owned.state !== "alive") {
			throw new Error(
				`consistency fixture: owned probe not alive before the teardown (owned: ${JSON.stringify(owned)}); the deterministic tests cover the semantics`,
			);
		}
		// (2) (F-tail) the teardown gate: the remaining window must cover
		// the teardown's EXISTING bounds — shrunk to the time actually
		// left (each option ≤ its existing default, none raised; the
		// reservation is derived from the SAME named values passed to
		// the call, so nothing can drift) — PLUS the held-handle
		// close-wait margin (CLOSE_MS). The shrunk sum ≤ the budget by
		// construction (floors + the remainder into closeTimeoutMs,
		// clamped to its default).
		const budget = deadline - now() - CLOSE_MS;
		if (budget <= 0) {
			windowExceeded = true;
			seams.teardowns.push({ skipped: true, budgetMs: budget });
			throw new Error(
				`consistency fixture: the shared 30 s window cannot cover the teardown + the ${CLOSE_MS} ms held-handle close-wait margin (remaining ${String(deadline - now())} ms; budget ${String(budget)} ms); teardown skipped — the ping is cleaned through its held handle and probeDir is kept`,
			);
		}
		const tProbe = Math.min(PROBE_MS, Math.floor((budget * PROBE_MS) / TEARDOWN_TAIL_MS));
		const tKillWait = Math.min(PROBE_KILL_WAIT_MS, Math.floor((budget * PROBE_KILL_WAIT_MS) / TEARDOWN_TAIL_MS));
		const tTaskkill = Math.min(TASKKILL_MS, Math.floor((budget * TASKKILL_MS) / TEARDOWN_TAIL_MS));
		const tClose = Math.min(CLOSE_MS, budget - (tProbe + tKillWait + tTaskkill));
		if (tProbe < 1 || tKillWait < 1 || tTaskkill < 1 || tClose < 1) {
			windowExceeded = true;
			seams.teardowns.push({ skipped: true, budgetMs: budget });
			throw new Error(
				`consistency fixture: the shared 30 s window cannot cover the minimally shrunk teardown bounds (budget ${String(budget)} ms after the ${CLOSE_MS} ms held-handle close-wait margin); teardown skipped — the ping is cleaned through its held handle and probeDir is kept`,
			);
		}
		const options = {
			probeTimeoutMs: tProbe,
			probeKillWaitMs: tKillWait,
			taskkillTimeoutMs: tTaskkill,
			closeTimeoutMs: tClose,
		};
		seams.teardowns.push({ ...options });
		startedOptions = options;
		// (3) (b) SOUND INVARIANTS replace the bare signalled===true: the
		// bound identity is the callback's own owned probe result (alive —
		// guarded above): the helper still re-checks the identity
		// immediately before the signal (refusing a recycled pid) and
		// applies the F1 exit check; bound-by-caller is the same contract
		// the CLI uses after its own capture.
		const teardownStarted = now();
		teardownResult = await seams.teardown(seams.pingPid, { ...options, boundIdentity: owned });
		// (a) the diagnostic record: pushed for EVERY outcome (signalled
		// true or false, reaped or not) into seams.teardowns and attached
		// to every failure message below — a red run prints the shrunk
		// options, the owned probe's measured duration + result, and the
		// teardown result's fields (JSON.stringify, no console.log).
		const probePid = teardownResult?.signalIdentity?.probePid ?? teardownResult?.boundIdentity?.probePid;
		diagnosticRecord = {
			...options,
			probeResidue: teardownResult?.probeResidue ?? false,
			diagnostic: {
				owned: { durationMs: ownedDurationMs, result: ownedResult },
				teardown: {
					durationMs: now() - teardownStarted,
					signalled: teardownResult?.signalled ?? null,
					reaped: teardownResult?.reaped ?? null,
					refused: teardownResult?.refused ?? null,
					errors: teardownResult?.errors ?? null,
					signalIdentity: teardownResult?.signalIdentity ?? null,
					boundIdentity: teardownResult?.boundIdentity ?? null,
					probeResidue: teardownResult?.probeResidue ?? false,
					timings: teardownResult?.timings ?? null,
					...(probePid != null ? { probePid } : {}),
				},
			},
		};
		seams.teardowns.push(diagnosticRecord);
		if (teardownResult.signalled === true) {
			// A signal only with a RE-PROVED identity: alive, the same id as
			// the bound identity, the real reap (the close inside the
			// helper's closeTimeoutMs), and no recorded faults.
			if (teardownResult.signalIdentity?.state !== "alive" || teardownResult.signalIdentity.id !== owned.id) {
				throw new Error(
					`consistency fixture: a signal WITHOUT a re-proved identity (signalIdentity: ${JSON.stringify(teardownResult.signalIdentity)}; bound: ${JSON.stringify(owned)}); record: ${JSON.stringify(diagnosticRecord)}`,
				);
			}
			if (teardownResult.reaped !== true) {
				throw new Error(
					`consistency fixture: signalled but NOT reaped (the real close never landed inside the close bound); record: ${JSON.stringify(diagnosticRecord)}`,
				);
			}
			if (!Array.isArray(teardownResult.errors) || teardownResult.errors.length !== 0) {
				throw new Error(
					`consistency fixture: signalled with recorded faults (errors: ${JSON.stringify(teardownResult.errors)}); record: ${JSON.stringify(diagnosticRecord)}`,
				);
			}
		} else {
			// signalled:false only with a NAMED bounded step: at least one
			// refused/errors entry names it (the texts above), and its
			// measured duration stayed inside its shrunk bound + the
			// scheduling allowance (PROBE_KILL_WAIT_MS — the existing knob,
			// no new number). success then STAYS FALSE so the finally reaps
			// through the held handle and proves the owned real close
			// (reapedBy "test-finally" — the test's own cleanup, NEVER the
			// product's reaping: a signalled:false green is never called
			// "teardown reaped").
			const step = matchBoundedStep(teardownResult.refused, teardownResult.errors);
			if (step == null) {
				throw new Error(
					`consistency fixture: signalled:false with no named bounded step (refused: ${JSON.stringify(teardownResult.refused)}; errors: ${JSON.stringify(teardownResult.errors)}); record: ${JSON.stringify(diagnosticRecord)}`,
				);
			}
			// A failed or timed-out taskkill can never be reported as reaped
			// by the teardown (reapedBy "teardown") — red.
			if (step.category === "taskkill" && teardownResult.reaped === true) {
				throw new Error(
					`consistency fixture: a failed/timed-out taskkill (${JSON.stringify(step.entry)}) reported reaped by the teardown — the product must not claim a reap it did not prove; record: ${JSON.stringify(diagnosticRecord)}`,
				);
			}
			const measured = step.timing(teardownResult);
			const bound = step.bound(options);
			if (measured != null && measured > bound + PROBE_KILL_WAIT_MS) {
				throw new Error(
					`consistency fixture: the named step (${JSON.stringify(step.entry)}) took ${String(measured)} ms > its shrunk bound ${String(bound)} ms + the ${PROBE_KILL_WAIT_MS} ms scheduling allowance; record: ${JSON.stringify(diagnosticRecord)}`,
				);
			}
		}
		const finalVerdict = consistencyProbeDecision({
			warmup: null,
			results: seams.ownedResults,
			a: null,
			b: null,
			teardowns: seams.teardowns,
		});
		expect(finalVerdict.residue).toBe(false);
		// Only the signalled:true path skips the finally's held-handle
		// reap; the bounded-refusal path reaps through the held handle and
		// proves the owned real close (either way).
		success = teardownResult.signalled === true;
		return { owned, teardown: teardownResult };
	} finally {
		// (reapedBy) who proved the owned real close: the teardown's own
		// bounded close wait (the success path — "teardown") or the
		// finally's held-handle kill + the at-spawn close observer
		// ("test-finally" — the test's own cleanup, NEVER the product's
		// reaping; a signalled:false green is never called "teardown
		// reaped").
		if (success) reapedBy = "teardown";
		if (!success) {
			// (F1) Failure-path cleanup through the HELD handle:
			// ping.kill() (TerminateProcess on that handle — cannot hit a
			// recycled PID), then the REAL close: either already recorded
			// by the AT-SPAWN close observer (a close that happened
			// before the finally is observed WITHOUT waiting) or waited
			// for within the existing 10 s close bound (CLOSE_MS). close
			// is NEVER inferred from exitCode/signalCode/exit.
			let killRan = false;
			try {
				const r = seams.ping.kill();
				// kill() reports delivery with a boolean: only a TRUE
				// return means the signal went out.
				killRan = r === true;
			} catch {
				killRan = false;
			}
			if (seams.closeTracker.observed) {
				// the real close fired before the finally — observed
				// WITHOUT waiting (no close-wait timer is ever armed on
				// this path).
			} else {
				await new Promise<void>((resolve) => {
					let settled = false;
					let t: unknown;
					const finish = () => {
						if (settled) return;
						settled = true;
						if (t != null) seams.clearTimeoutFn(t);
						resolve();
					};
					t = seams.setTimeoutFn(finish, CLOSE_MS);
					seams.awaitClose().then(finish, () => finish());
				});
			}
			seams.cleanup.killRan = killRan;
			// FACT: set only by the at-spawn observer's real close
			// event — never derived from exit metadata.
			seams.cleanup.closeObserved = seams.closeTracker.observed;
			if (killRan && seams.closeTracker.observed) reapedBy = "test-finally";
			if (!killRan || !seams.cleanup.closeObserved) {
				throw new Error(
					`consistency fixture: ping pid ${String(seams.pingPid)} not confirmed gone after the held-handle kill (kill: ${String(killRan)}; closeObserved: ${String(seams.cleanup.closeObserved)}); probeDir kept for inspection${diagnosticRecord != null ? `; record: ${JSON.stringify(diagnosticRecord)}` : ""}`,
				);
			}
		}
		// (amendment 2) ONE bounded structured trace line per run (pass or
		// refusal alike, red or green): the prefix + a single JSON object,
		// at most 4096 bytes, through the injected writer — the real tests
		// point it at process.stderr.write (never console.log), the
		// deterministic tests inject a recorder and never touch the real
		// stderr. No environment values in the payload.
		seams.writeTrace(
			buildTraceLine({
				testName: seams.testName,
				options: startedOptions,
				owned: { durationMs: ownedDurationMs, result: ownedResult },
				signalled: teardownResult?.signalled ?? null,
				reaped: teardownResult?.reaped ?? null,
				reapedBy,
				refused: teardownResult?.refused ?? null,
				errors: teardownResult?.errors ?? null,
				signalIdentity: teardownResult?.signalIdentity ?? null,
				boundIdentity: teardownResult?.boundIdentity ?? null,
				probeResidue: teardownResult?.probeResidue ?? false,
				...(teardownResult?.signalIdentity?.probePid != null
					? { probePid: teardownResult.signalIdentity.probePid }
					: teardownResult?.boundIdentity?.probePid != null
						? { probePid: teardownResult.boundIdentity.probePid }
						: {}),
				timings: teardownResult?.timings ?? null,
			}),
		);
		// (F6) probeDir is removed ONLY when no owned probe result AND no
		// teardown result carries an unreaped probe child AND no
		// window-based fact left an unaccounted probe. On residue or a
		// window fact the dir is kept for inspection (the assertions
		// above already failed the test).
		if (!consistencyProbeDecision({ warmup: null, results: seams.ownedResults, a: null, b: null, teardowns: seams.teardowns }).residue && !windowExceeded) {
			seams.rmProbeDir();
		}
	}
}

// Flushes the microtask queue so a seam-driven callback (fake async
// probes resolve on microtasks) reaches its next real suspension point
// before a virtual-clock advance is needed.
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

// Drives a seam-driven callback on a virtual clock until it settles:
// flush microtasks, then advance in 10 s steps while the virtual clock
// still has pending timers (the reviewer's pump shape, asserting
// version).
async function pumpVirtual(
	clock: ReturnType<typeof virtualClock>,
	pending: Promise<unknown>,
): Promise<{ error: string; settled: boolean }> {
	let error = "";
	let settled = false;
	const done = pending.then(
		(value) => {
			settled = true;
			return value;
		},
		(e) => {
			settled = true;
			error = String(e);
			return undefined;
		},
	);
	for (let i = 0; i < 10 && !settled; i += 1) {
		await flushMicrotasks();
		if (settled) break;
		if (clock.pending() === 0) {
			await flushMicrotasks();
			break;
		}
		clock.advance(10_000);
	}
	await done;
	return { error, settled };
}

describe("legacy identityOfFor cross-check (real CIM, win32 only)", () => {
	// (A9/F-self) The LEGACY cross-check, split out of the ping test:
	// identityOfFor (the legacy production identity — psExe spawnSync
	// discovery + the .ps1 CIM query under its existing 20 s bound)
	// vs boundedIdentityProbe (the owned probe), BOTH on OUR OWN
	// long-lived process (process.pid — never signalled by any probe):
	// identical `alive` ids. NO child process: no ping window, no
	// held-handle cleanup — the ping reap is test (B). Order and
	// bounds so the sum of the EXISTING bounds fits the window: the
	// legacy probe FIRST (its existing 20 s bound, the first thing in
	// the window), then the owned probe bounded via the existing
	// probeTimeoutMs option to the remaining window (minus the probe
	// kill-wait); fail fast with the facts if the remaining window is
	// too small. Any owned-probe residue keeps probeDir and fails.
	test.skipIf(process.platform !== "win32")("identityOfFor matches boundedIdentityProbe on our own long-lived process", async () => {
		// The window clock starts at TEST ENTRY (monotonic; Bun's 30 s
		// cap starts there too).
		const windowStart = performance.now();
		const probeDir = mkdtempSync(join(tmpdir(), "pinar-legacy-cross-"));
		// The source table is the single wiring point: the LEGACY
		// executor is the oracle. The wiring is asserted (a mutant that
		// compares owned-with-owned goes red here — F-self).
		const legacySource: (platform: string, opts: { probeDir: string }) => (pid: number) => any = identityOfFor;
		const ownedSource: (platform: string, opts?: { probeTimeoutMs: number; probeKillWaitMs: number }) => (pid: number) => any =
			boundedIdentityProbe;
		expect(legacySource).toBe(identityOfFor);
		expect(ownedSource).toBe(boundedIdentityProbe);
		const legacy = await legacySource("win32", { probeDir })(process.pid);
		// (F6) the legacy probe is the first step in the window: if it
		// cannot settle (CIM degraded / bursty host), fail fast with the
		// facts BEFORE the owned probe — no stack of native work against
		// the frozen 30 s cap.
		if (legacy.state !== "alive") {
			rmSync(probeDir, { recursive: true, force: true }); // nothing probed yet: no residue possible
			throw new Error(
				`consistency fixture: the legacy identityOfFor probe did not settle alive on process.pid (legacy: ${JSON.stringify(legacy)}); the deterministic tests cover the semantics`,
			);
		}
		// The owned probe is bounded to the remaining window via the
		// existing probeTimeoutMs option (the existing default PROBE_MS
		// is the cap; remaining − kill-wait is the bound — the probe's
		// own worst case fits the remaining window). No budget → the
		// fact BEFORE probing.
		const remaining = windowStart + WINDOW_CAP_MS - performance.now();
		if (remaining <= PROBE_KILL_WAIT_MS) {
			rmSync(probeDir, { recursive: true, force: true });
			throw new Error(
				`consistency fixture: the shared 30 s window has no budget for the owned probe after the legacy probe (remaining ${String(remaining)} ms ≤ the ${PROBE_KILL_WAIT_MS} ms probe kill-wait reservation); not probed`,
			);
		}
		const owned = await ownedSource("win32", {
			probeTimeoutMs: Math.min(PROBE_MS, remaining - PROBE_KILL_WAIT_MS),
			probeKillWaitMs: PROBE_KILL_WAIT_MS,
		})(process.pid);
		expect(owned.state).toBe("alive");
		// THE cross-check: identical alive identities (the legacy
		// contract vs the owned probe — a divergent id fails closed).
		expect(owned.id).toBe(legacy.id);
		const verdict = consistencyProbeDecision({ warmup: null, results: [owned], a: null, b: null, teardowns: [] });
		expect(verdict.residue).toBe(false);
		if (!verdict.residue) {
			rmSync(probeDir, { recursive: true, force: true });
		}
	}, 30_000);
});

describe("owned probe + teardownChild (real processes, win32 only)", () => {
	// (A9) The PING REAP test — NO reference, NO warm-up probe (test (A)
	// runs first and warms the CIM provider; (B) makes as few CIM calls
	// as possible). Spawn our own `ping -n 120` via spawnFixturePing;
	// assert the REAL handle's spawnargs IMMEDIATELY after the spawn
	// (BEFORE any probe — F-argv: a native-only literal-argv mutant is
	// red at the assert even on a slow host); register the at-spawn
	// close tracker; ONE owned probe on the ping bounded to the
	// remaining window; then teardownChild with its EXISTING options
	// shrunk to the time actually left (the callback's gate).
	// WHAT THIS TEST ASSERTS NOW (instead of the bare signalled===true):
	// SAFETY INVARIANTS plus a MANDATORY DIAGNOSTIC RECORD — a signal only
	// with a re-proved identity (alive, the same id as the bound identity,
	// the real reap, no recorded faults); a signalled:false only with a
	// named bounded step whose measured duration stayed inside its shrunk
	// bound + the scheduling allowance. The diagnostic record (shrunk
	// options, the owned probe's measured duration + result, the teardown
	// result's fields incl. timings) is pushed into seams.teardowns for
	// every outcome and attached to every failure message, and the ONE
	// bounded `child-teardown-trace` stderr line (pass or refusal alike)
	// carries reapedBy — who proved the owned REAL CLOSE EITHER WAY: the
	// teardown's own bounded close wait ("teardown") or the finally's
	// held-handle kill + the at-spawn close observer ("test-finally").
	test.skipIf(process.platform !== "win32")("teardownChild reaps its own ping through the shrunk-window bounds (real close)", async () => {
		// The window clock starts at TEST ENTRY (monotonic; Bun's 30 s
		// cap starts there too).
		const windowStart = performance.now();
		const probeDir = mkdtempSync(join(tmpdir(), "pinar-ping-reap-"));
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		// OUR OWN child only: ping is spawned directly (no shell), so
		// ping.pid is the ping itself — the only pid this test ever
		// signals. `ping -n 120` (≈120 s of lifetime) OUTLIVES the test's
		// whole native window: the child can only end through this
		// test's own verified teardown (or the held-handle finally) —
		// never by natural exit inside the window. The argv is built by
		// spawnFixturePing — the SAME function the deterministic port
		// consumes.
		const ping = spawnFixturePing(spawn);
		// (F-argv) the REAL handle's actual spawnargs are asserted
		// IMMEDIATELY after the spawn — BEFORE any probe: on a slow
		// host this assert is still reached (the old warm-up-first
		// order made it unreachable, and a native-only argv mutant
		// stayed invisible to the port).
		expect(ping.spawnargs).toContain(String(PING_COUNT));
		const pingErrors: Error[] = [];
		const onPingError = (e: Error) => pingErrors.push(e);
		ping.on("error", onPingError);
		const pingPid = ping.pid;
		// (F1) the ping's close observer is registered AT SPAWN (before
		// any await): it records the REAL close event, so a close that
		// already happened is known without waiting — and a held-handle
		// kill that emits only `exit` (no close event) leaves it unset.
		// The callback NEVER infers close from exitCode/signalCode.
		const closeTracker: { observed: boolean; code: number | null; signal: string | null } = {
			observed: false,
			code: null,
			signal: null,
		};
		let closeResolve: (() => void) | null = null;
		const closeWaiter = new Promise<void>((resolve) => {
			closeResolve = resolve;
		});
		const onPingClose = (code: number | null, signal: string | null) => {
			if (!closeTracker.observed) {
				closeTracker.observed = true;
				closeTracker.code = code;
				closeTracker.signal = signal;
			}
			closeResolve?.();
		};
		ping.on("close", onPingClose);
		let callbackRan = false;
		try {
			expect(pingPid, `ping spawn failed: ${pingErrors.map((e) => String(e)).join("; ")}`).not.toBeNull();
			callbackRan = true;
			const record = await runConsistencyCallback({
				ping: ping as any,
				pingPid: pingPid!,
				// The ONE owned probe on the ping: the existing
				// probeTimeoutMs option carries the callback's
				// remaining-window bound (production probeKillWaitMs).
				owned: (pid: number, probeMs: number) =>
					boundedIdentityProbe("win32", { probeTimeoutMs: probeMs, probeKillWaitMs: PROBE_KILL_WAIT_MS })(pid),
				// (F-tail) teardownChild with its EXISTING options
				// shrunk to the time actually left (the callback's gate
				// computes them; each ≤ its existing default, none
				// raised). NO identity seam: the helper's DEFAULT bounded
				// identity runs the production re-check with the shrunk
				// probeTimeoutMs/probeKillWaitMs — the real path.
				teardown: (pid: number, options: any) => teardownChild(ping, options),
				ownedResults,
				teardowns,
				clock: { now: () => performance.now() },
				windowStart,
				windowCapMs: WINDOW_CAP_MS,
				closeTracker,
				awaitClose: () => closeWaiter,
				setTimeoutFn: setTimeout,
				clearTimeoutFn: clearTimeout,
				rmProbeDir: () => rmSync(probeDir, { recursive: true, force: true }),
				cleanup: { killRan: false, closeObserved: false },
				testName: "teardownChild reaps its own ping through the shrunk-window bounds (real close)",
				writeTrace: (line) => process.stderr.write(line),
			});
			// The callback asserted the sound invariants (a signal only with
			// a re-proved identity; a signalled:false only with a named
			// bounded step inside its shrunk bound + the allowance, reaped
			// through the held handle by the finally — reapedBy
			// "test-finally"). The record carries the facts either way; the
			// trace line carries reapedBy.
			expect(record.owned.state).toBe("alive");
			if (record.teardown.signalled === true) {
				expect(record.teardown.reaped).toBe(true);
				expect(record.teardown.errors).toEqual([]);
			}
			// (F-tail) the window math: the shrunk bounds fit the
			// remaining window + the close margin — each ≤ its existing
			// default and the sum ≤ the cap − the margin (by
			// construction, nothing was raised).
			const opts = teardowns[teardowns.length - 1];
			expect(opts.skipped).toBeUndefined();
			expect(opts.probeTimeoutMs).toBeLessThanOrEqual(PROBE_MS);
			expect(opts.probeKillWaitMs).toBeLessThanOrEqual(PROBE_KILL_WAIT_MS);
			expect(opts.taskkillTimeoutMs).toBeLessThanOrEqual(TASKKILL_MS);
			expect(opts.closeTimeoutMs).toBeLessThanOrEqual(CLOSE_MS);
			expect(opts.probeTimeoutMs + opts.probeKillWaitMs + opts.taskkillTimeoutMs + opts.closeTimeoutMs).toBeLessThanOrEqual(
				WINDOW_CAP_MS - CLOSE_MS,
			);
		} finally {
			// (F9 residual) the held-handle cleanup and the probeDir
			// decision live inside runConsistencyCallback's finally; only
			// the spawn-failure path (the pingPid assertion above threw
			// before the callback ran) needs the same probeDir decision
			// here.
			ping.removeListener("error", onPingError);
			ping.removeListener("close", onPingClose);
			if (!callbackRan && !consistencyProbeDecision({ warmup: null, results: ownedResults, a: null, b: null, teardowns }).residue) {
				rmSync(probeDir, { recursive: true, force: true });
			}
		}
	}, 30_000);

	// (amendment 1) HYBRID owned-close check — what it PROVES: the REAL
	// default taskkill runner and the REAL close of an owned ping, under
	// the DEFAULT taskkillTimeoutMs (8_000) / closeTimeoutMs (10_000)
	// bounds (the named constants — no parallel literal). What it does
	// NOT prove: the identity step is a FIXED seam (alive with a fixed id,
	// never calling CIM), so it is NOT a native identity → signal → close
	// proof. The end-to-end native proof comes from two places outside
	// this test: the unchanged real-process test (B) — real CIM identity
	// probe, real signal and real close, when it signals — and the
	// orchestrator's later real native tray smoke and gates. The fixed-id
	// seam is never presented as native identity. The one bounded
	// `child-teardown-trace` stderr line is emitted for this run (pass or
	// refusal alike), with reapedBy: the teardown's bounded close wait
	// ("teardown") or the finally's held-handle kill + the at-spawn close
	// observer ("test-finally" — the test's own cleanup).
	test.skipIf(process.platform !== "win32")("teardownChild real taskkill + real close with an injected identity seam (hybrid; not a native identity proof)", async () => {
		// OUR OWN child only: ping is spawned directly (no shell), so
		// ping.pid is the ping itself — the only pid this test ever
		// signals. The at-spawn close observer is the same shape test (B)
		// registers (the REAL close is the only close).
		const ping = spawnFixturePing(spawn);
		expect(ping.spawnargs).toContain(String(PING_COUNT));
		const pingErrors: Error[] = [];
		const onPingError = (e: Error) => pingErrors.push(e);
		ping.on("error", onPingError);
		const pingPid = ping.pid;
		const closeTracker: { observed: boolean; code: number | null; signal: string | null } = {
			observed: false,
			code: null,
			signal: null,
		};
		let closeResolve: (() => void) | null = null;
		const closeWaiter = new Promise<void>((resolve) => {
			closeResolve = resolve;
		});
		const onPingClose = (code: number | null, signal: string | null) => {
			if (!closeTracker.observed) {
				closeTracker.observed = true;
				closeTracker.code = code;
				closeTracker.signal = signal;
			}
			closeResolve?.();
		};
		ping.on("close", onPingClose);
		// The FIXED identity seam: alive with a fixed id, answered without
		// any CIM call (it calls nothing — never CIM). The bound identity
		// is caller-probound by this test; the helper's pre-signal re-check
		// must come from THIS seam (seamCalls — not from CIM).
		const FIXED_ID = "800000000000000000"; // a fixed, non-CIM id (file-time shaped)
		let seamCalls = 0;
		const identitySeam = async (_pid: number) => {
			seamCalls += 1;
			return { state: "alive", id: FIXED_ID };
		};
		// The REAL default taskkill runner (no runTaskkill seam) with the
		// DEFAULT taskkillTimeoutMs / closeTimeoutMs bounds (the named
		// constants).
		const options: any = {
			platform: "win32",
			boundIdentity: { state: "alive", id: FIXED_ID },
			identity: identitySeam,
			taskkillTimeoutMs: TASKKILL_MS, // the DEFAULT 8_000
			closeTimeoutMs: CLOSE_MS, // the DEFAULT 10_000
		};
		let teardownResult: any = null;
		let reapedBy: "teardown" | "test-finally" | null = null;
		try {
			expect(pingPid, `ping spawn failed: ${pingErrors.map((e) => String(e)).join("; ")}`).not.toBeNull();
			teardownResult = await teardownChild(ping, options);
			// STRICTLY require the real signal and the real close: this
			// test is the no-fallback owned-close proof for the default
			// runner — no bounded-refusal green here (a refusal or a
			// not-observed close is a red, and the finally below reaps
			// through the held handle so the ping never leaks).
			expect(teardownResult.signalled).toBe(true);
			expect(teardownResult.reaped).toBe(true);
			expect(closeTracker.observed).toBe(true);
			expect(seamCalls).toBe(1); // the re-check came from the seam, never CIM
			reapedBy = "teardown";
		} finally {
			ping.removeListener("error", onPingError);
			ping.removeListener("close", onPingClose);
			if (reapedBy == null) {
				// The finally reaps through the HELD handle if anything
				// failed (the same shape the callback's finally uses).
				let killRan = false;
				try {
					killRan = ping.kill() === true;
				} catch {
					killRan = false;
				}
				if (!closeTracker.observed) {
					await new Promise<void>((resolve) => {
						let settled = false;
						let t: unknown;
						const finish = () => {
							if (settled) return;
							settled = true;
							if (t != null) clearTimeout(t);
							resolve();
						};
						t = setTimeout(finish, CLOSE_MS);
						closeWaiter.then(finish, () => finish());
					});
				}
				if (killRan && closeTracker.observed) reapedBy = "test-finally";
			}
			// The one bounded `child-teardown-trace` stderr line for this
			// real-process run (pass or refusal alike) — the identity seam
			// is NAMED as a fixed seam in the payload (never presented as
			// native identity); no environment values.
			process.stderr.write(
				buildTraceLine({
					testName: "teardownChild real taskkill + real close with an injected identity seam (hybrid; not a native identity proof)",
					options: { taskkillTimeoutMs: TASKKILL_MS, closeTimeoutMs: CLOSE_MS, identity: "fixed-id seam (no CIM)" },
					owned: { durationMs: null, result: null },
					signalled: teardownResult?.signalled ?? null,
					reaped: teardownResult?.reaped ?? null,
					reapedBy,
					refused: teardownResult?.refused ?? null,
					errors: teardownResult?.errors ?? null,
					signalIdentity: teardownResult?.signalIdentity ?? null,
					boundIdentity: teardownResult?.boundIdentity ?? null,
					probeResidue: teardownResult?.probeResidue ?? false,
					timings: teardownResult?.timings ?? null,
				}),
			);
		}
	}, 30_000);
});

describe("native consistency fixture (F9 deterministic port, virtual clock)", () => {
	// (F9 + A9) Deterministic port of the ping-reap fixture: the native
	// child (`ping -n 120`, ≈120 s of lifetime) OUTLIVES the test's whole
	// native window (the 30 s cap), so with clean probes (owned capture
	// at virtual 2 s; the teardown's fake re-check + taskkill settle on
	// microtasks at the same virtual instant) the re-check still sees
	// the child ALIVE — the teardown actually signals and reaps it (real
	// close on the held handle), every callback assertion the native
	// test makes passes, and the SHRUNK teardown bounds are the exact
	// deterministic values the window math derives (no parallel
	// literal). No real waiting, no native signalling: fake
	// process/probes/seams and the injected virtual clock. The child's
	// natural exit is scheduled at its 120 s lifetime (derived from the
	// RECORDED spawn argv — F-argv: the SAME spawnFixturePing the native
	// test consumes; a count mutant changes the derived lifetime and
	// the native window invariant goes red) and is never reached
	// inside the window.
	test("clean probes outlive the ping: the child cannot exit naturally inside the window (F9)", async () => {
		const clock = virtualClock();
		// (F-argv) the port spawns the fixture ping through the SAME
		// spawnFixturePing the native test uses, with a recording
		// spawnFn: the recorded argv IS the argv the shared function
		// builds (the native-only literal-argv mutant is invisible to
		// the port by design — the native (B) spawnargs assert is its
		// oracle; M36).
		let recordedArgs: string[] = [];
		const child = spawnFixturePing((_cmd: string, args: string[], _opts: unknown) => {
			recordedArgs = args;
			return fakeChild(8123250);
		});
		expect(recordedArgs).toContain(String(PING_COUNT));
		const PING_LIFETIME_MS = Number.parseInt(recordedArgs[recordedArgs.indexOf("-n") + 1], 10) * 1000;
		// The native fixture invariant: the child OUTLIVES the whole
		// native 30 s window — it can only end through the test's
		// verified teardown (a finite ping that dies inside the window
		// breaks the fixture).
		expect(PING_LIFETIME_MS).toBeGreaterThan(30_000);
		let naturalExitTriggered = false;
		// The fixture's natural exit at its 120 s lifetime: if the
		// window ever reached it, the child would end on its own.
		clock.setTimeout(() => {
			naturalExitTriggered = true;
			exitChild(child, 0, null);
		}, PING_LIFETIME_MS);
		// (F1) the fake ping's close observer is registered AT SPAWN
		// (before any await) — the same shape the native test registers
		// on the real handle.
		const closeTracker: { observed: boolean; code: number | null; signal: string | null } = {
			observed: false,
			code: null,
			signal: null,
		};
		let closeResolve: (() => void) | null = null;
		const closeWaiter = new Promise<void>((resolve) => {
			closeResolve = resolve;
		});
		child.on("close", (code: number | null, signal: string | null) => {
			if (!closeTracker.observed) {
				closeTracker.observed = true;
				closeTracker.code = code;
				closeTracker.signal = signal;
			}
			closeResolve?.();
		});
		// The fixture's clean native window on the virtual timeline:
		// the owned capture at virtual 2 s (the window clock INCLUDES
		// everything from virtual 0 — the test entry; the owned bound is
		// min(8_000, 30_000 − 2_000 kill-wait) = 8_000). The teardown's
		// fake re-check + taskkill settle on microtasks at the same
		// virtual instant (no extra CIM calls — (B) makes as few as
		// possible).
		let ownedBound: number | null = null;
		const ownedProbe = async (pid: number, probeMs: number): Promise<any> => {
			if (pid === 8123250 && ownedBound === null) ownedBound = probeMs;
			clock.advance(2_000);
			// A probe of the fixture child sees `gone` only once its
			// handle actually closed; the long-lived test process always
			// reports an alive identity.
			if (pid === 8123250 && child.exitCode != null) return { state: "gone" };
			return { state: "alive", id: pid === process.pid ? "W" : "A" };
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean; closeObserved: boolean } = { killRan: false, closeObserved: false };
		// The SAME callback the native test runs — fakes + virtual clock
		// only, no real waiting, no native signalling. Teardown is the
		// REAL teardownChild with a FAKE re-check identity (the
		// deterministic port cannot run real CIM; the fake re-check sees
		// the child ALIVE — the re-check's contract is the helper's
		// default bounded identity in the native test) + a
		// status-checked taskkill that closes the handle (synchronously,
		// before waitClose — which then settles from the already-exited
		// handle → reaped).
		const record: any = await runConsistencyCallback({
			ping: child as any,
			pingPid: 8123250,
			owned: ownedProbe,
			// (A9) the seam receives the pid + the shrunk options; the
			// fixture child is the held handle (the real teardownChild
			// runs with a FAKE re-check identity — the deterministic port
			// cannot run real CIM — + a status-checked taskkill that
			// closes the handle).
			teardown: (_pid: number, options: any) =>
				teardownChild(child, {
					...options,
					// The fixture models the native win32 ping-reap (the
					// status-checked taskkill seam): the platform is
					// EXPLICIT so the test takes this branch on every host —
					// the default process.platform would take the POSIX
					// SIGKILL branch on Linux/macOS, where this fixture's
					// fake kill never closes and waitClose would arm a
					// virtual timer nothing advances (the POSIX twin below
					// declares "linux" and lets the kill land).
					platform: "win32",
					identity: async (pid: number) => (pid === 8123250 && child.exitCode != null ? { state: "gone" } : { state: "alive", id: "A" }),
					runTaskkill: () => {
						// A successful taskkill ends the process: the
						// handle closes (synchronously, before
						// waitClose).
						exitChild(child, 0, null);
						return { status: 0, error: null };
					},
					setTimeout: clock.setTimeout,
					clearTimeout: clock.clearTimeout,
				}),
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: () => closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: F9 win32 clean probes",
			writeTrace: () => {},
		});
		// Every one of the callback's assertions passed — the record
		// carries them:
		const { owned, teardown } = record;
		expect(owned).toEqual({ state: "alive", id: "A" });
		expect(teardown.signalled).toBe(true);
		expect(teardown.reaped).toBe(true);
		expect(teardown.exitCode).toBe(0);
		expect(teardown.probeResidue).toBe(false);
		expect(teardown.signalIdentity).toEqual(owned);
		// (F-tail) the SHRUNK teardown bounds: the exact deterministic
		// values the window math derives at virtual 2 s — budget =
		// 30_000 − 2_000 − 10_000 (close margin) = 18_000, split over
		// the four existing bounds proportionally to their existing
		// defaults (floors + the remainder into closeTimeoutMs, clamped
		// to its default): 18_000·8/28 = 5142, ·2/28 = 1285, ·8/28 =
		// 5142, remainder 6431. Each ≤ its existing default; the sum is
		// exactly the budget.
		const opts = teardowns[teardowns.length - 1];
		expect(opts.skipped).toBeUndefined();
		expect(opts.probeTimeoutMs).toBe(5_142);
		expect(opts.probeKillWaitMs).toBe(1_285);
		expect(opts.taskkillTimeoutMs).toBe(5_142);
		expect(opts.closeTimeoutMs).toBe(6_431);
		expect(opts.probeTimeoutMs + opts.probeKillWaitMs + opts.taskkillTimeoutMs + opts.closeTimeoutMs).toBe(18_000);
		// (F9) the window clock INCLUDES everything from virtual 0 (the
		// test entry): the owned bound is min(8_000, 30_000 − 2_000
		// kill-wait) = 8_000.
		expect(ownedBound).toBe(8_000);
		// The window ends at virtual 2 s — far inside the child's 120 s
		// lifetime: the natural exit was scheduled but never reached, so
		// the child ended ONLY through the verified teardown above, and
		// the only pending timer is that scheduled-but-unreached
		// lifetime.
		expect(clock.now()).toBe(2_000);
		expect(clock.now()).toBeLessThan(PING_LIFETIME_MS);
		expect(naturalExitTriggered).toBe(false);
		expect(clock.pending()).toBe(1);
		// Success path: no held-handle kill (the finally's cleanup runs
		// only on failure), and the clean probeDir (no residue) is
		// removed.
		expect(cleanup.killRan).toBe(false);
		expect(removed).toBe(true);
	}, 5_000);

	// (F9 twin) The POSIX-declared twin of the F9 scenario: the SAME
	// fixture (the 120 s ping outliving the whole 30 s window, clean
	// probes, the REAL teardownChild on the virtual clock) with an
	// explicit `platform: "linux"` — the helper's POSIX branch signals
	// the HELD handle with child.kill("SIGKILL") and never runs
	// taskkill. The per-test kill hook makes the SIGKILL land: a real
	// observed close on the held handle carrying the signal (POSIX
	// semantics: a signal, not a status — the shared fakeChild default
	// stays "kill does not close" for the other tests). The darwin
	// path is the SAME `else` branch (the helper keys only on
	// "win32" vs POSIX), so "linux" covers both POSIX hosts. Everything
	// else is the win32 F9 contract: true observed close, the owned
	// bound, the shrunk bounds derived from the whole 30 s cap, the
	// record fields. No real waiting, no virtual-clock pump: the kill
	// lands before waitClose arms a timer, so nothing is advanced.
	test("clean probes outlive the ping on POSIX: the SIGKILL lands and reaps from a true observed close (F9 twin)", async () => {
		const clock = virtualClock();
		let recordedArgs: string[] = [];
		const child = spawnFixturePing((_cmd: string, args: string[], _opts: unknown) => {
			recordedArgs = args;
			return fakeChild(8123250);
		});
		expect(recordedArgs).toContain(String(PING_COUNT));
		const PING_LIFETIME_MS = Number.parseInt(recordedArgs[recordedArgs.indexOf("-n") + 1], 10) * 1000;
		// The native fixture invariant: the child OUTLIVES the whole
		// native 30 s window — it can only end through the test's
		// verified teardown.
		expect(PING_LIFETIME_MS).toBeGreaterThan(30_000);
		let naturalExitTriggered = false;
		// The fixture's natural exit at its 120 s lifetime: if the
		// window ever reached it, the child would end on its own.
		clock.setTimeout(() => {
			naturalExitTriggered = true;
			exitChild(child, 0, null);
		}, PING_LIFETIME_MS);
		// The at-spawn close observer (the same shape the win32 F9
		// fixture and the native test register on the real handle).
		const closeTracker: { observed: boolean; code: number | null; signal: string | null } = {
			observed: false,
			code: null,
			signal: null,
		};
		let closeResolve: (() => void) | null = null;
		const closeWaiter = new Promise<void>((resolve) => {
			closeResolve = resolve;
		});
		child.on("close", (code: number | null, signal: string | null) => {
			if (!closeTracker.observed) {
				closeTracker.observed = true;
				closeTracker.code = code;
				closeTracker.signal = signal;
			}
			closeResolve?.();
		});
		// The per-test kill hook: the SIGKILL on the held handle LANDS
		// (the real observed close with the signal is emitted on the
		// handle). Only SIGKILL lands: an un-signalled kill from the
		// finally's failure-path cleanup would not.
		const originalKill = child.kill;
		child.kill = (signal?: string) => {
			const ok = originalKill(signal);
			if (signal === "SIGKILL") exitChild(child, null, "SIGKILL");
			return ok;
		};
		let ownedBound: number | null = null;
		const ownedProbe = async (pid: number, probeMs: number): Promise<any> => {
			if (pid === 8123250 && ownedBound === null) ownedBound = probeMs;
			clock.advance(2_000);
			// A probe of the fixture child sees `gone` only once its
			// handle actually closed; the long-lived test process always
			// reports an alive identity.
			if (pid === 8123250 && (child.exitCode != null || child.signalCode != null)) return { state: "gone" };
			return { state: "alive", id: pid === process.pid ? "W" : "A" };
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean; closeObserved: boolean } = { killRan: false, closeObserved: false };
		// The recording taskkill seam must stay UNUSED: the POSIX branch
		// signals the held handle and never runs taskkill.
		const tk = taskkillRunner(0);
		const record: any = await runConsistencyCallback({
			ping: child as any,
			pingPid: 8123250,
			owned: ownedProbe,
			teardown: (_pid: number, options: any) =>
				teardownChild(child, {
					...options,
					platform: "linux",
					identity: async (pid: number) =>
						(pid === 8123250 && (child.exitCode != null || child.signalCode != null) ? { state: "gone" } : { state: "alive", id: "A" }),
					runTaskkill: tk.fn,
					setTimeout: clock.setTimeout,
					clearTimeout: clock.clearTimeout,
				}),
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: () => closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: F9 POSIX twin clean probes",
			writeTrace: () => {},
		});
		// The same contract as the win32 F9 test, adapted only where
		// POSIX semantics differ (a signal, not a status):
		const { owned, teardown } = record;
		expect(owned).toEqual({ state: "alive", id: "A" });
		expect(teardown.signalled).toBe(true);
		expect(teardown.reaped).toBe(true);
		// Reaped from a TRUE observed close: the at-spawn observer saw
		// the real close event carrying the SIGKILL signal (never a
		// synthetic reaped from exit metadata).
		expect(closeTracker.observed).toBe(true);
		expect(closeTracker.code).toBeNull();
		expect(closeTracker.signal).toBe("SIGKILL");
		expect(teardown.exitCode).toBeNull();
		expect(teardown.signalCode).toBe("SIGKILL");
		expect(teardown.probeResidue).toBe(false);
		expect(teardown.signalIdentity).toEqual(owned);
		// The POSIX branch signalled the HELD handle with SIGKILL
		// (exactly once — the finally's cleanup kill runs only on
		// failure) and never ran taskkill.
		expect(child.killCalls).toEqual(["SIGKILL"]);
		expect(tk.pids).toEqual([]);
		// The SHRUNK teardown bounds: the SAME platform-independent
		// window math at virtual 2 s — budget = 30_000 − 2_000 − 10_000
		// (close margin) = 18_000, split proportionally to the existing
		// defaults (floors + the remainder into closeTimeoutMs).
		const opts = teardowns[teardowns.length - 1];
		expect(opts.skipped).toBeUndefined();
		expect(opts.probeTimeoutMs).toBe(5_142);
		expect(opts.probeKillWaitMs).toBe(1_285);
		expect(opts.taskkillTimeoutMs).toBe(5_142);
		expect(opts.closeTimeoutMs).toBe(6_431);
		expect(opts.probeTimeoutMs + opts.probeKillWaitMs + opts.taskkillTimeoutMs + opts.closeTimeoutMs).toBe(18_000);
		// The owned bound is min(8_000, 30_000 − 2_000 kill-wait) = 8_000.
		expect(ownedBound).toBe(8_000);
		// The window ends at virtual 2 s — far inside the child's 120 s
		// lifetime: the natural exit was scheduled but never reached, so
		// the child ended ONLY through the verified teardown above, and
		// the only pending timer is that scheduled-but-unreached
		// lifetime.
		expect(clock.now()).toBe(2_000);
		expect(clock.now()).toBeLessThan(PING_LIFETIME_MS);
		expect(naturalExitTriggered).toBe(false);
		expect(clock.pending()).toBe(1);
		// Success path: no held-handle kill (the finally's cleanup runs
		// only on failure), and the clean probeDir (no residue) is
		// removed.
		expect(cleanup.killRan).toBe(false);
		expect(removed).toBe(true);
	}, 5_000);
});

describe("native consistency callback (F9 residual + A9 deterministic)", () => {
	// (A9) Driven through the SAME runConsistencyCallback code the
	// native test (B) runs — fakes + virtual clock, no real waiting, no
	// native signalling. The fake ping's close observer is registered
	// AT SPAWN (before any await — the same shape the native test
	// registers on the real handle); the kill spy usually emits `close`
	// on a microtask (TerminateProcess landing), the exit-only test
	// emits ONLY `exit`, and the no-close test emits nothing (the kill
	// does not land): the REAL close is the only close (F1 — close is
	// never inferred from exitCode/signalCode).
	function makeFakePing(exitOnlyOnKill: boolean, emitCloseOnKill: boolean) {
		const child: any = fakeChild(8123250);
		const closeTracker: { observed: boolean; code: number | null; signal: string | null } = {
			observed: false,
			code: null,
			signal: null,
		};
		let closeResolve: (() => void) | null = null;
		const closeWaiter = new Promise<void>((resolve) => {
			closeResolve = resolve;
		});
		child.on("close", (code: number | null, signal: string | null) => {
			if (!closeTracker.observed) {
				closeTracker.observed = true;
				closeTracker.code = code;
				closeTracker.signal = signal;
			}
			closeResolve?.();
		});
		const realKill = child.kill;
		if (exitOnlyOnKill) {
			// The kill LANDS with exit ONLY — no close event:
			child.kill = () => {
				child.killCalls.push("");
				child.exitCode = 0;
				child.emit("exit", 0);
				return true;
			};
		} else if (emitCloseOnKill) {
			// TerminateProcess lands: the held handle closes on kill.
			child.kill = (...args: unknown[]) => {
				const r = realKill(...args);
				queueMicrotask(() => exitChild(child, null, "SIGTERM"));
				return r;
			};
		}
		// (no-close: the kill does not land — the real child.kill, which
		// records and returns pid != null without emitting close)
		return { child, closeTracker, closeWaiter: () => closeWaiter };
	}

	test("owned unknown (unreaped) → residue assertion, NO teardown call, held-handle kill + close observed → probeDir kept", async () => {
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (pid: number) => {
			if (pid === 8123250) {
				// The owned comparison timed out with an UNREAPED probe
				// child (the residue case).
				return { state: "unknown", error: "identity probe timed out after 8000ms", probeCleanup: "unreaped", probePid: 8123999 };
			}
			return { state: "alive", id: "W" };
		};
		let teardownCalls = 0;
		const teardown = () => {
			teardownCalls += 1;
			return Promise.reject(new Error("teardown must not run on this path"));
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean; closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: owned unknown unreaped",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		// NO teardown call: the owned non-alive result fails before it
		// (here on the residue assertion — F6 residue wins).
		expect(teardownCalls).toBe(0);
		expect(teardowns).toHaveLength(0);
		// Held-handle cleanup: kill ran on the handle, close observed.
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(true);
		expect(child.killCalls).toHaveLength(1);
		// probeDir decision per residue: the unreaped owned probe KEEPS
		// it.
		expect(removed).toBe(false);
		expect(clock.pending()).toBe(0);
	}, 5_000);

	test("owned unknown (reaped) → guard throw BEFORE the teardown call (no teardown call), normal close observed → probeDir removed", async () => {
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (pid: number) => {
			if (pid === 8123250) {
				// The owned comparison timed out but its probe child was
				// reaped (recovered — no residue).
				return { state: "unknown", error: "identity probe timed out after 8000ms", probeCleanup: "reaped", probePid: 8123998 };
			}
			return { state: "alive", id: "W" };
		};
		let teardownCalls = 0;
		const teardown = () => {
			teardownCalls += 1;
			return Promise.reject(new Error("teardown must not run on this path"));
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean; closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: owned unknown reaped",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		// The guard threw BEFORE the teardown was called (the window
		// gate and the teardown itself are unreachable on this path —
		// owned-unknown → no teardown call).
		await expect(pending).rejects.toThrow("owned probe not alive before the teardown");
		expect(teardownCalls).toBe(0);
		expect(teardowns).toHaveLength(0);
		// Normal close: the kill's close microtask landed → observed, no
		// cleanup fact throw → the removal decision runs.
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(true);
		expect(child.killCalls).toHaveLength(1);
		// No residue anywhere → the probeDir decision REMOVES it.
		expect(removed).toBe(true);
		expect(clock.pending()).toBe(0);
	}, 5_000);

	test("(F-tail) teardown with the shrunk bounds at virtual 12 s returns INSIDE the window (the reviewer's tail-teardown-returned shape)", async () => {
		// The reviewer's exact shape: owned ALIVE after 12 s (startedAt
		// 12_000). The OLD code started the teardown with its UNSHRUNK
		// defaults (8 s + 2 s + 8 s + 10 s) and teardownChild RETURNED
		// at virtual 38 s — past the 30 s cap. A9: the remaining window
		// (18 s) minus the close margin (10 s) leaves a budget of 8 s;
		// the teardown starts with its EXISTING bounds shrunk to that
		// budget (the spy consumes the FULL shrunk budget — the worst
		// case) and returns at virtual 20 s — INSIDE the window.
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (_pid: number) => {
			clock.advance(12_000);
			return { state: "alive", id: "A" };
		};
		let teardownCalls = 0;
		let seenOptions: any = null;
		let returnedAt: number | null = null;
		const teardown = (_pid: number, options: any) => {
			teardownCalls += 1;
			seenOptions = options;
			// The worst case: the teardown consumes its FULL (shrunk)
			// budget — the reviewer's `tail-teardown-returned` drives the
			// real teardownChild the same way. returnedAt is captured at
			// the timer's fire (the virtual clock's `advance` jumps to its
			// `until` after firing, so the settlement instant is the fire's
			// `now`, not the clock after the advance).
			return new Promise<any>((resolve) => {
				clock.setTimeout(
					() => {
						returnedAt = clock.now();
						// The (b) invariants read the re-proved identity and
						// the recorded faults: the fake carries them (the
						// same id the owned probe bound, no faults).
						resolve({ signalled: true, reaped: true, probeResidue: false, exitCode: 0, signalIdentity: { state: "alive", id: "A" }, errors: [] });
					},
					options.probeTimeoutMs + options.probeKillWaitMs + options.taskkillTimeoutMs + options.closeTimeoutMs,
				);
			});
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean, closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: tail teardown at virtual 12 s",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		// The teardown STARTED (budget 8_000 > 0) and its FULL shrunk
		// budget was consumed — yet it RETURNED at virtual 20 s (12 s
		// start + 8 s budget), INSIDE the 30 s cap (the reviewer's
		// unshrunk mutant returned at 40 s → M35 red):
		expect(teardownCalls).toBe(1);
		expect(returnedAt).toBe(20_000);
		expect(returnedAt).toBeLessThanOrEqual(WINDOW_CAP_MS);
		// The shrunk bounds: budget = 30_000 − 12_000 − 10_000 = 8_000,
		// split over the existing defaults (floors + the remainder into
		// closeTimeoutMs): 8_000·8/28 = 2285, ·2/28 = 571, ·8/28 = 2285,
		// remainder 2859. Each ≤ its existing default; the sum is
		// exactly the budget.
		expect(seenOptions.probeTimeoutMs).toBe(2_285);
		expect(seenOptions.probeKillWaitMs).toBe(571);
		expect(seenOptions.taskkillTimeoutMs).toBe(2_285);
		expect(seenOptions.closeTimeoutMs).toBe(2_859);
		expect(seenOptions.probeTimeoutMs + seenOptions.probeKillWaitMs + seenOptions.taskkillTimeoutMs + seenOptions.closeTimeoutMs).toBe(8_000);
		// Success: the real teardown signal (the callback asserted it)
		// and the clean probeDir removed:
		expect(cleanup.killRan).toBe(false);
		expect(removed).toBe(true);
		expect(child.killCalls).toHaveLength(0);
		expect(clock.pending()).toBe(0);
	}, 5_000);

	test("(F-tail) no budget for the teardown + close margin at virtual 20 s → teardown SKIPPED, held-handle reap, probeDir kept (the reviewer's tail-unknown-recheck shape, now skipped)", async () => {
		// owned ALIVE after 20 s: remaining 10 s = exactly the close
		// margin → budget 0 → the teardown is SKIPPED with the fact (the
		// reviewer's `tail-unknown-recheck` drove the real teardownChild's
		// 8 s re-check + 10 s close wait PAST the cap; A9 never starts
		// it), and the held-handle finally reaps the ping at virtual 20
		// s — far before the virtual 30 s cap.
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (_pid: number) => {
			clock.advance(20_000);
			return { state: "alive", id: "A" };
		};
		let teardownCalls = 0;
		const teardown = () => {
			teardownCalls += 1;
			return Promise.reject(new Error("teardown must not run on this path"));
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean, closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: no teardown budget at virtual 20 s",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		await expect(pending).rejects.toThrow("teardown skipped");
		// The teardown was NEVER called (its unknown re-check can never
		// run past the window — the reviewer's returnedAt 32_000 shape is
		// unreachable by construction):
		expect(teardownCalls).toBe(0);
		expect(teardowns).toHaveLength(1);
		expect(teardowns[0].skipped).toBe(true);
		// The held-handle cleanup + the retention decision completed
		// BEFORE the virtual 30 s cap (the close landed at virtual 20 s):
		expect(clock.now()).toBe(20_000);
		expect(clock.now()).toBeLessThanOrEqual(WINDOW_CAP_MS);
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(true);
		expect(child.killCalls).toHaveLength(1);
		// Retention: the window fact KEEPS probeDir:
		expect(removed).toBe(false);
		expect(clock.pending()).toBe(0);
	}, 5_000);

	test("teardown returns not-reaped + the held-handle kill does not land → the close-wait margin expires INSIDE the window, the fact keeps probeDir", async () => {
		// The teardown signalled but the helper's close wait came back
		// `reaped: false` (the close never arrived) → the callback's
		// reaped assertion fails → the finally kills through the held
		// handle; TerminateProcess does NOT land (no close event) → the
		// existing 10 s close-wait margin expires at virtual 10 s —
		// INSIDE the window — and the fact keeps probeDir.
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, false);
		const owned = async (_pid: number) => ({ state: "alive", id: "A" });
		let teardownCalls = 0;
		const teardown = (_pid: number, _options: any) => {
			teardownCalls += 1;
			// The (b) invariants read the re-proved identity first (the
			// fake carries it — the same id the owned probe bound); the
			// red then comes from "signalled but NOT reaped", which is
			// what this scenario drives.
			return Promise.resolve({ signalled: true, reaped: false, probeResidue: false, signalIdentity: { state: "alive", id: "A" }, errors: [] });
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean, closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: not-reaped + kill does not land",
			writeTrace: () => {},
		});
		// Let the callback reach its bounded close wait (the fake probes
		// settle on microtasks), then expire the 10 s bound.
		await flushMicrotasks();
		expect(clock.pending()).toBe(1); // the close-wait timer is armed
		clock.advance(10_000);
		await expect(pending).rejects.toThrow("not confirmed gone after the held-handle kill");
		// The failure records the fact: the kill ran but the close was
		// never observed.
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(false);
		expect(child.killCalls).toHaveLength(1);
		expect(teardownCalls).toBe(1);
		expect(clock.now()).toBe(10_000);
		expect(clock.now()).toBeLessThanOrEqual(WINDOW_CAP_MS);
		// probeDir is KEPT with the fact (the throw happens before the
		// removal decision).
		expect(removed).toBe(false);
		expect(clock.pending()).toBe(0);
	}, 5_000);

	test("a held-handle kill that emits exit only (no close) → closeObserved false, probeDir kept (no exit-metadata-as-close)", async () => {
		// The FALSE-CLOSE regression (the parent's case 1 shape): the
		// kill LANDS — the handle's exitCode is set and `exit` fires —
		// but NO close event ever arrives. close is NEVER inferred from
		// exitCode/signalCode: closeObserved stays false, the failure
		// carries the fact, and probeDir is kept.
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(true, false);
		const owned = async (pid: number) => {
			if (pid === 8123250) {
				// The owned comparison timed out (reaped — no residue):
				// the guard path reaches the finally with the ping
				// alive.
				return { state: "unknown", error: "identity probe timed out after 8000ms", probeCleanup: "reaped", probePid: 8123997 };
			}
			return { state: "alive", id: "W" };
		};
		let teardownCalls = 0;
		const teardown = () => {
			teardownCalls += 1;
			return Promise.reject(new Error("teardown must not run on this path"));
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean, closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: exit only (no close)",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		await expect(pending).rejects.toThrow("not confirmed gone after the held-handle kill");
		// The fact: the kill ran and the handle carries exit metadata
		// (exitCode 0)…
		expect(child.exitCode).toBe(0);
		expect(cleanup.killRan).toBe(true);
		// …but no REAL close was observed — close is never inferred from
		// exit metadata — and probeDir is kept.
		expect(cleanup.closeObserved).toBe(false);
		expect(child.killCalls).toHaveLength(1);
		expect(teardownCalls).toBe(0);
		expect(removed).toBe(false);
		expect(clock.pending()).toBe(0);
	}, 5_000);

	test("close before the finally → observed without waiting, the fact fails on the dead-handle kill, probeDir kept", async () => {
		// The ping's REAL close fires DURING the try (before the
		// finally): the at-spawn observer already recorded it, so the
		// cleanup observes it WITHOUT waiting (no close-wait timer is
		// armed, no virtual time passes) — and the kill on the
		// already-closed handle returns false (ESRCH): the fact fails on
		// killRan.
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (pid: number) => {
			if (pid === 8123250) {
				// The owned comparison timed out (reaped) — and the ping
				// itself closes DURING the try (a microtask queued before
				// the callback resumes past the await):
				queueMicrotask(() => exitChild(child, 0, null));
				return { state: "unknown", error: "identity probe timed out after 8000ms", probeCleanup: "reaped", probePid: 8123996 };
			}
			return { state: "alive", id: "W" };
		};
		let teardownCalls = 0;
		const teardown = () => {
			teardownCalls += 1;
			return Promise.reject(new Error("teardown must not run on this path"));
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean, closeObserved: boolean } = { killRan: false, closeObserved: false };
		// The handle is already closed: kill() is ESRCH false.
		child.kill = () => {
			child.killCalls.push("");
			return child.exitCode != null ? false : true;
		};
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: close before the finally",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		await expect(pending).rejects.toThrow("closeObserved: true");
		// Observed WITHOUT waiting: no close-wait timer was ever armed
		// and no virtual time passed.
		expect(cleanup.killRan).toBe(false);
		expect(cleanup.closeObserved).toBe(true);
		expect(clock.now()).toBe(0);
		expect(clock.pending()).toBe(0);
		expect(child.killCalls).toHaveLength(1);
		// The fact throw happens before the removal decision → kept:
		expect(removed).toBe(false);
		expect(teardownCalls).toBe(0);
	}, 5_000);

	test("(F-tail) the owned probe is bounded to the remaining window at a late start (virtual 25 s → bound 3_000, not the 8_000 default)", async () => {
		// The remaining-window bound on the owned probe: the clock is at
		// virtual 25 s when the callback starts (everything before the
		// probe — the window INCLUDES it) → the remaining window is
		// 5_000; the bound is min(8_000, 5_000 − 2_000 kill-wait) = 3_000
		// — NOT the existing 8_000 default (M33: the unbounded mutant
		// passes 8_000 and goes red). The fake probe then returns
		// unknown (reaped) → the guard throw → the normal held-handle
		// close → the clean probeDir is removed.
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		let seenBound: number | null = null;
		const owned = async (pid: number, probeMs: number) => {
			if (pid === 8123250) {
				seenBound = probeMs;
				return { state: "unknown", error: "identity probe timed out after 3000ms", probeCleanup: "reaped", probePid: 8123995 };
			}
			return { state: "alive", id: "W" };
		};
		let teardownCalls = 0;
		const teardown = () => {
			teardownCalls += 1;
			return Promise.reject(new Error("teardown must not run on this path"));
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean, closeObserved: boolean } = { killRan: false, closeObserved: false };
		// The window clock INCLUDES everything before the probe: the
		// callback starts at virtual 25 s.
		clock.advance(25_000);
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: owned probe bounded at a late start",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		await expect(pending).rejects.toThrow("owned probe not alive before the teardown");
		// The bound was SHRUNK to the remaining window (not the default):
		expect(seenBound).toBe(3_000);
		expect(seenBound).toBeLessThan(PROBE_MS);
		expect(teardownCalls).toBe(0);
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(true);
		expect(removed).toBe(true);
		expect(clock.now()).toBe(25_000);
		expect(clock.now()).toBeLessThanOrEqual(WINDOW_CAP_MS);
		expect(clock.pending()).toBe(0);
	}, 5_000);

	test("(F-tail) no budget for the owned probe at all (virtual 29 s) → not probed, window fact, held-handle reap, probeDir kept", async () => {
		// At virtual 29 s the remaining window (1_000) is below the probe
		// kill-wait reservation (2_000): the owned probe is NOT called
		// (M33: the un-gated mutant calls it and goes red), the window
		// fact fires, and the held-handle finally reaps the ping at
		// virtual 29 s — INSIDE the cap.
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		let ownedCalls = 0;
		const owned = async (_pid: number, _probeMs: number) => {
			ownedCalls += 1;
			return { state: "unknown", error: "identity probe timed out after 3000ms", probeCleanup: "reaped", probePid: 8123994 };
		};
		let teardownCalls = 0;
		const teardown = () => {
			teardownCalls += 1;
			return Promise.reject(new Error("teardown must not run on this path"));
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean, closeObserved: boolean } = { killRan: false, closeObserved: false };
		// The window clock INCLUDES everything before the probe: the
		// callback starts at virtual 29 s.
		clock.advance(29_000);
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9: no budget for the owned probe",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		await expect(pending).rejects.toThrow("no budget for the owned probe");
		// The owned probe was NEVER called (no live probe to abandon) and
		// the teardown was never reached:
		expect(ownedCalls).toBe(0);
		expect(teardownCalls).toBe(0);
		// The held-handle cleanup completed INSIDE the cap (the close
		// landed at virtual 29 s):
		expect(clock.now()).toBe(29_000);
		expect(clock.now()).toBeLessThanOrEqual(WINDOW_CAP_MS);
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(true);
		expect(child.killCalls).toHaveLength(1);
		// Retention: the window fact KEEPS probeDir:
		expect(removed).toBe(false);
		expect(clock.pending()).toBe(0);
	}, 5_000);

	// (A9b) signalled:false with the taskkill-timeout text PASSES: the
	// named bounded step stayed inside its shrunk bound + the allowance,
	// and the finally reaped through the held handle (reapedBy
	// "test-finally" — the test's own cleanup, never the product's). The
	// diagnostic record is present for the outcome; the trace line (the
	// injected recorder — the real tests write stderr, this one never
	// touches the real stderr) carries the same facts.
	test("signalled:false + taskkill timeout text passes: named step inside its bound, reapedBy test-finally, the record present (A9b)", async () => {
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (_pid: number) => {
			clock.advance(2_000);
			return { state: "alive", id: "A" };
		};
		const teardown = async (_pid: number, _options: any) => ({
			signalled: false,
			reaped: false,
			refused: [],
			errors: ["taskkill /PID 8123250 /T /F timed out after 5142ms; the child may still be running"],
			signalIdentity: { state: "alive", id: "A" },
			boundIdentity: { state: "alive", id: "A" },
			probeResidue: false,
			timings: { preSignalProbeMs: 0, signalMs: 5_142, closeWaitMs: 6_431 },
		});
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean; closeObserved: boolean } = { killRan: false, closeObserved: false };
		const trace: string[] = [];
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9b: signalled:false taskkill timeout passes",
			writeTrace: (line: string) => trace.push(line),
		});
		await pumpVirtual(clock, pending);
		// The bounded refusal PASSES: the named step (taskkill timed out)
		// stayed inside its shrunk bound + the allowance, and the finally
		// reaped through the held handle (the owned real close happened —
		// the test's own cleanup).
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(true);
		expect(removed).toBe(true);
		expect(clock.pending()).toBe(0);
		// The diagnostic record is present for the outcome:
		const record = teardowns[teardowns.length - 1];
		expect(record.skipped).toBeUndefined();
		expect(record.diagnostic).toBeDefined();
		expect(record.diagnostic.owned.durationMs).toBe(2_000);
		expect(record.diagnostic.owned.result).toEqual({ state: "alive", id: "A" });
		expect(record.diagnostic.teardown.signalled).toBe(false);
		expect(record.diagnostic.teardown.errors).toEqual(["taskkill /PID 8123250 /T /F timed out after 5142ms; the child may still be running"]);
		expect(record.diagnostic.teardown.timings.signalMs).toBe(5_142);
		expect(record.probeResidue).toBe(false);
		// The trace line: one per run, prefix + a single JSON object,
		// reapedBy "test-finally" (never "teardown" for a refusal).
		expect(trace).toHaveLength(1);
		expect(trace[0].startsWith("child-teardown-trace ")).toBe(true);
		const payload = JSON.parse(trace[0].slice("child-teardown-trace ".length));
		expect(payload.testName).toBe("A9b: signalled:false taskkill timeout passes");
		expect(payload.options.taskkillTimeoutMs).toBe(5_142);
		expect(payload.owned.durationMs).toBe(2_000);
		expect(payload.owned.result).toEqual({ state: "alive", id: "A" });
		expect(payload.signalled).toBe(false);
		expect(payload.reaped).toBe(false);
		expect(payload.reapedBy).toBe("test-finally");
		expect(payload.errors[0]).toContain("taskkill /PID 8123250 /T /F timed out after");
		expect(payload.probeResidue).toBe(false);
		expect(payload.timings.signalMs).toBe(5_142);
		expect(Buffer.byteLength(trace[0], "utf8")).toBeLessThanOrEqual(4096);
	}, 5_000);

	// (A9b/M3) the REAL teardownChild's taskkill timeout driven through
	// the SAME callback: the runner never settles, the raced timeout fires
	// at the shrunk taskkillTimeoutMs on the virtual clock, and the REAL
	// code records the bounded-step reason (M3 kills exactly that
	// recording — with it removed, errors stay empty and the (b) check
	// goes red with "no named bounded step"). The virtual clock is the
	// helper's monotonic `now`, so the step timings are the exact virtual
	// durations (the measured signal step == the shrunk bound).
	test("the REAL teardownChild's taskkill timeout through the callback: named step + measured duration inside the bound, reapedBy test-finally (A9b/M3)", async () => {
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (_pid: number) => {
			clock.advance(2_000);
			return { state: "alive", id: "A" };
		};
		let teardownCalls = 0;
		const teardown = (_pid: number, options: any) => {
			teardownCalls += 1;
			return teardownChild(child, {
				...options,
				platform: "win32",
				identity: async (pid: number) => (pid === 8123250 && child.exitCode != null ? { state: "gone" } : { state: "alive", id: "A" }),
				runTaskkill: () => new Promise(() => {}),
				setTimeout: clock.setTimeout,
				clearTimeout: clock.clearTimeout,
				now: () => clock.now(),
			});
		};
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean; closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9b: real teardownChild taskkill timeout",
			writeTrace: () => {},
		});
		// Drive the virtual clock MANUALLY (not pumpVirtual's 10 s quantum
		// — the quantum would make the measured step durations include the
		// advance step, not the exact bound): the advances land on the
		// timers' fire times, so the step timings are the EXACT virtual
		// durations. The raced taskkill timeout fires at exactly the shrunk
		// bound (virtual 2_000 + 5_142), the close wait at its shrunk bound.
		await flushMicrotasks(); // the callback reaches the race's await (timer at 7_142)
		expect(clock.pending()).toBe(1);
		clock.advance(5_142); // now = 7_142 — the raced timeout fired at exactly the bound
		await flushMicrotasks(); // the classification records the reason; the close wait arms (timer at 13_573)
		expect(clock.pending()).toBe(1);
		clock.advance(6_431); // now = 13_573 — the close wait fired at exactly its bound
		await flushMicrotasks(); // teardownChild returns; the (b) invariants hold; the finally reaps through the held handle
		// The callback RESOLVES (a red would throw here — e.g. M3, which
		// drops the timeout's recorded reason, leaves errors empty and
		// goes red with "no named bounded step"):
		const res = await pending;
		expect(res.teardown.signalled).toBe(false);
		expect(res.teardown.reaped).toBe(false);
		// The REAL timeout path: the bounded-step text is recorded, the
		// measured step durations are the exact virtual durations, and the
		// finally reaped through the held handle.
		expect(teardownCalls).toBe(1);
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(true);
		const record = teardowns[teardowns.length - 1];
		expect(record.diagnostic.teardown.signalled).toBe(false);
		expect(record.diagnostic.teardown.reaped).toBe(false);
		expect(record.diagnostic.teardown.errors.some((e: string) => e.includes("taskkill /PID 8123250 /T /F timed out after"))).toBe(true);
		expect(record.diagnostic.teardown.timings.preSignalProbeMs).toBe(0);
		expect(record.diagnostic.teardown.timings.signalMs).toBe(record.taskkillTimeoutMs);
		expect(record.diagnostic.teardown.timings.closeWaitMs).toBe(record.closeTimeoutMs);
		expect(removed).toBe(true);
		expect(clock.pending()).toBe(0);
	}, 5_000);

	// (A9b) signalled:false with EMPTY refused and errors → red (never a
	// silent green): the named-bounded-step check fails, and the finally
	// still reaps through the held handle (the owned real close happened);
	// the record is present for the red.
	test("signalled:false with EMPTY refused and errors → red (A9b)", async () => {
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (_pid: number) => {
			clock.advance(2_000);
			return { state: "alive", id: "A" };
		};
		const teardown = async (_pid: number, _options: any) => ({
			signalled: false,
			reaped: false,
			refused: [],
			errors: [],
			signalIdentity: { state: "alive", id: "A" },
			boundIdentity: { state: "alive", id: "A" },
			probeResidue: false,
			timings: { preSignalProbeMs: 0, signalMs: 5_142, closeWaitMs: 6_431 },
		});
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean; closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9b: signalled:false empty refused/errors",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		await expect(pending).rejects.toThrow("no named bounded step");
		// The finally still proved the owned real close, and the record is
		// present for the red:
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(true);
		const record = teardowns[teardowns.length - 1];
		expect(record.diagnostic.teardown.signalled).toBe(false);
		expect(record.diagnostic.teardown.errors).toEqual([]);
		expect(record.diagnostic.teardown.refused).toEqual([]);
	}, 5_000);

	// (A9b) signalled:true with a DIFFERENT signalIdentity id → red (a
	// signal without a re-proved identity is never a green).
	test("signalled:true with a different signalIdentity id → red (A9b)", async () => {
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (_pid: number) => {
			clock.advance(2_000);
			return { state: "alive", id: "A" };
		};
		const teardown = async (_pid: number, _options: any) => ({
			signalled: true,
			reaped: true,
			refused: [],
			errors: [],
			signalIdentity: { state: "alive", id: "B" },
			boundIdentity: { state: "alive", id: "A" },
			probeResidue: false,
			timings: { preSignalProbeMs: 0, signalMs: 5_142, closeWaitMs: 6_431 },
		});
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean; closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9b: signalled:true different identity",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		await expect(pending).rejects.toThrow("WITHOUT a re-proved identity");
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(true);
		const record = teardowns[teardowns.length - 1];
		expect(record.diagnostic.teardown.signalled).toBe(true);
		expect(record.diagnostic.teardown.signalIdentity).toEqual({ state: "alive", id: "B" });
	}, 5_000);

	// (A9b) signalled:true with reaped:false → red (a signal without the
	// real close is never a green).
	test("signalled:true with reaped:false → red (A9b)", async () => {
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (_pid: number) => {
			clock.advance(2_000);
			return { state: "alive", id: "A" };
		};
		const teardown = async (_pid: number, _options: any) => ({
			signalled: true,
			reaped: false,
			refused: [],
			errors: [],
			signalIdentity: { state: "alive", id: "A" },
			boundIdentity: { state: "alive", id: "A" },
			probeResidue: false,
			timings: { preSignalProbeMs: 0, signalMs: 5_142, closeWaitMs: 6_431 },
		});
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean; closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9b: signalled:true not reaped",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		await expect(pending).rejects.toThrow("signalled but NOT reaped");
		expect(cleanup.killRan).toBe(true);
		expect(cleanup.closeObserved).toBe(true);
		const record = teardowns[teardowns.length - 1];
		expect(record.diagnostic.teardown.signalled).toBe(true);
		expect(record.diagnostic.teardown.reaped).toBe(false);
	}, 5_000);

	// (A9b/amendment 3) a failed/timed-out taskkill reported with
	// reapedBy "teardown" (the result claims reaped:true) → red: the
	// product must not claim a reap a failed signal did not prove.
	test("a failed/timed-out taskkill reported reaped by the teardown → red (A9b)", async () => {
		const clock = virtualClock();
		const { child, closeTracker, closeWaiter } = makeFakePing(false, true);
		const owned = async (_pid: number) => {
			clock.advance(2_000);
			return { state: "alive", id: "A" };
		};
		const teardown = async (_pid: number, _options: any) => ({
			signalled: false,
			reaped: true,
			refused: [],
			errors: ["taskkill /PID 8123250 /T /F timed out after 5142ms; the child may still be running"],
			signalIdentity: { state: "alive", id: "A" },
			boundIdentity: { state: "alive", id: "A" },
			probeResidue: false,
			timings: { preSignalProbeMs: 0, signalMs: 5_142, closeWaitMs: 6_431 },
		});
		const ownedResults: any[] = [];
		const teardowns: any[] = [];
		let removed = false;
		const cleanup: { killRan: boolean; closeObserved: boolean } = { killRan: false, closeObserved: false };
		const pending = runConsistencyCallback({
			ping: child,
			pingPid: 8123250,
			owned,
			teardown,
			ownedResults,
			teardowns,
			clock: { now: () => clock.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker,
			awaitClose: closeWaiter,
			setTimeoutFn: clock.setTimeout,
			clearTimeoutFn: clock.clearTimeout,
			rmProbeDir: () => {
				removed = true;
			},
			cleanup,
			testName: "A9b: failed taskkill reported reaped",
			writeTrace: () => {},
		});
		await pumpVirtual(clock, pending);
		await expect(pending).rejects.toThrow("reported reaped by the teardown");
		const record = teardowns[teardowns.length - 1];
		expect(record.diagnostic.teardown.signalled).toBe(false);
		expect(record.diagnostic.teardown.reaped).toBe(true);
	}, 5_000);

	// (A9b/M5) a MALFORMED runner error ({}) is fail-closed: signalled
	// stays false and the recorded text names the malformed error and its
	// type (the REAL teardownChild — M5 treats {} as success and goes red
	// here).
	test("a malformed runner error ({}) is fail-closed: signalled:false + the malformed-error text (A9b/M5)", async () => {
		const child = fakeChild(8123290);
		const teardown: any = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "A" },
			identity: async () => ({ state: "alive", id: "A" }),
			runTaskkill: () => ({ status: 0, error: {} }),
			closeTimeoutMs: 40,
		});
		expect(teardown.signalled).toBe(false);
		expect(teardown.reaped).toBe(false);
		expect(teardown.errors).toHaveLength(1);
		expect(teardown.errors[0]).toContain("taskkill /PID 8123290 /T /F runner returned a malformed error (object)");
		// The step's measured duration was recorded for the refusal:
		expect(typeof teardown.timings.signalMs).toBe("number");
	}, 5_000);

	// (A9b) a runner result WITHOUT a usable exit status (a non-object
	// result, a missing or non-integer status) is fail-closed with the
	// "returned no exit status" text — never a success.
	test("a runner result without a usable exit status is fail-closed: 'returned no exit status' (A9b)", async () => {
		const child = fakeChild(8123291);
		// A non-object result:
		const a: any = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "A" },
			identity: async () => ({ state: "alive", id: "A" }),
			runTaskkill: () => "boom" as never,
			closeTimeoutMs: 40,
		});
		expect(a.signalled).toBe(false);
		expect(a.reaped).toBe(false);
		expect(a.errors[0]).toContain("taskkill /PID 8123291 /T /F returned no exit status");
		// A missing (null) status:
		const b: any = await teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "A" },
			identity: async () => ({ state: "alive", id: "A" }),
			runTaskkill: () => ({ status: null, error: null }),
			closeTimeoutMs: 40,
		});
		expect(b.signalled).toBe(false);
		expect(b.errors[0]).toContain("taskkill /PID 8123291 /T /F returned no exit status");
	}, 5_000);

	// (A9b/amendment 2) the deterministic trace-record check: the writer
	// is INJECTED through the seam (the real tests point it at
	// process.stderr.write — this test never captures the real stderr).
	// Run A: the prefix + a single JSON object with the required fields.
	// Run B: the line is truncated to at most 4096 bytes (a payload too
	// big for the bound is cut, prefix intact).
	test("the trace line: prefix, JSON shape, reapedBy, and the 4096-byte bound (A9b)", async () => {
		// Run A: a bounded refusal (signalled:false + the taskkill timeout
		// text) — the passing path with reapedBy "test-finally".
		const clockA = virtualClock();
		const a = makeFakePing(false, true);
		const ownedA = async (_pid: number) => {
			clockA.advance(2_000);
			return { state: "alive", id: "A" };
		};
		const teardownA = async (_pid: number, _options: any) => ({
			signalled: false,
			reaped: false,
			refused: [],
			errors: ["taskkill /PID 8123250 /T /F timed out after 5142ms; the child may still be running"],
			signalIdentity: { state: "alive", id: "A" },
			boundIdentity: { state: "alive", id: "A" },
			probeResidue: false,
			timings: { preSignalProbeMs: 0, signalMs: 5_142, closeWaitMs: 6_431 },
		});
		const traceA: string[] = [];
		const pendingA = runConsistencyCallback({
			ping: a.child,
			pingPid: 8123250,
			owned: ownedA,
			teardown: teardownA,
			ownedResults: [],
			teardowns: [],
			clock: { now: () => clockA.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker: a.closeTracker,
			awaitClose: a.closeWaiter,
			setTimeoutFn: clockA.setTimeout,
			clearTimeoutFn: clockA.clearTimeout,
			rmProbeDir: () => {},
			cleanup: { killRan: false, closeObserved: false },
			testName: "A9b trace check",
			writeTrace: (line: string) => traceA.push(line),
		});
		await pumpVirtual(clockA, pendingA);
		expect(traceA).toHaveLength(1);
		expect(traceA[0].startsWith("child-teardown-trace ")).toBe(true);
		expect(Buffer.byteLength(traceA[0], "utf8")).toBeLessThanOrEqual(4096);
		const payloadA = JSON.parse(traceA[0].slice("child-teardown-trace ".length));
		expect(payloadA.testName).toBe("A9b trace check");
		expect(payloadA.options.probeTimeoutMs).toBe(5_142);
		expect(payloadA.owned.result).toEqual({ state: "alive", id: "A" });
		expect(payloadA.signalled).toBe(false);
		expect(payloadA.reapedBy).toBe("test-finally");
		expect(payloadA.errors[0]).toContain("timed out after");
		expect(payloadA.signalIdentity).toEqual({ state: "alive", id: "A" });
		expect(payloadA.boundIdentity).toEqual({ state: "alive", id: "A" });
		expect(payloadA.probeResidue).toBe(false);
		expect(payloadA.timings.signalMs).toBe(5_142);
		// Run B: a payload bigger than the bound → truncated to at most
		// 4096 bytes (the prefix stays; the cut object is a log line, not
		// a promise of parseability).
		const clockB = virtualClock();
		const b = makeFakePing(false, true);
		const ownedB = async (_pid: number) => {
			clockB.advance(2_000);
			return { state: "alive", id: "A" };
		};
		const filler = Array.from({ length: 100 }, (_v, i) => `taskkill /PID 8123250 /T /F timed out after 5142ms; filler ${String(i)} ${"x".repeat(120)}`);
		const teardownB = async (_pid: number, _options: any) => ({
			signalled: false,
			reaped: false,
			refused: [],
			errors: filler,
			signalIdentity: { state: "alive", id: "A" },
			boundIdentity: { state: "alive", id: "A" },
			probeResidue: false,
			timings: { preSignalProbeMs: 0, signalMs: 5_142, closeWaitMs: 6_431 },
		});
		const traceB: string[] = [];
		const pendingB = runConsistencyCallback({
			ping: b.child,
			pingPid: 8123250,
			owned: ownedB,
			teardown: teardownB,
			ownedResults: [],
			teardowns: [],
			clock: { now: () => clockB.now() },
			windowStart: 0,
			windowCapMs: WINDOW_CAP_MS,
			closeTracker: b.closeTracker,
			awaitClose: b.closeWaiter,
			setTimeoutFn: clockB.setTimeout,
			clearTimeoutFn: clockB.clearTimeout,
			rmProbeDir: () => {},
			cleanup: { killRan: false, closeObserved: false },
			testName: "A9b trace truncation check",
			writeTrace: (line: string) => traceB.push(line),
		});
		await pumpVirtual(clockB, pendingB);
		expect(traceB).toHaveLength(1);
		expect(traceB[0].startsWith("child-teardown-trace ")).toBe(true);
		expect(Buffer.byteLength(traceB[0], "utf8")).toBeLessThanOrEqual(4096);
		expect(Buffer.byteLength(traceB[0], "utf8")).toBe(4096); // the bound was actually hit and cut
	}, 5_000);
});


describe("cliSandboxDecision (F4)", () => {
	// (F4) exact scenario at the caller level: the initial capture's probe
	// timed out with an UNREAPED probe child and the root exited (during
	// the capture). The CLI now calls teardownChild in EVERY path — even
	// an already-exited root (its early return marks the bound identity's
	// residue before returning and re-reads reaped from the held handle)
	// — and cliSandboxDecision keeps the sandbox on these facts.
	test("root exited during capture + unreaped probe child → reaped root, but the sandbox is kept", async () => {
		const child = fakeChild(6001);
		child.exitCode = 1; // the root exited (during the capture)
		const bound: any = {
			state: "unknown",
			error: "identity probe timed out after 20ms",
			probeCleanup: "unreaped",
			probePid: 777,
		};
		const teardown: any = await teardownChild(child, {
			platform: "win32",
			boundIdentity: bound,
			identity: async () => ({ state: "gone" }),
			closeTimeoutMs: 5,
		});
		expect(teardown.reaped).toBe(true);
		expect(teardown.signalled).toBe(false);
		expect(teardown.probeResidue).toBe(true);
		// The CLI's decision on these exact facts keeps the sandbox:
		expect(cliSandboxDecision({ reaped: teardown.reaped, pid: child.pid, boundIdentity: bound, teardown })).toBe(false);
		// the probe pid fact is preserved in the teardown result:
		expect(JSON.stringify(teardown)).toContain("777");
	}, 5_000);

	// The capture tag alone must keep the sandbox even when the teardown
	// result itself carries no residue (guards the helper's own source —
	// mutation M18 kills exactly this term).
	test("capture residue alone (teardown without residue) keeps the sandbox", () => {
		const bound: any = { state: "gone", probeCleanup: "unreaped", probePid: 778 };
		expect(
			cliSandboxDecision({ reaped: true, pid: 6002, boundIdentity: bound, teardown: { reaped: true, probeResidue: false } }),
		).toBe(false);
	});

	test("clean capture + reaped root → the sandbox is removed", () => {
		expect(
			cliSandboxDecision({ reaped: true, pid: 6003, boundIdentity: { state: "alive", id: "X" }, teardown: { reaped: true, probeResidue: false } }),
		).toBe(true);
	});

	test("not reaped → the sandbox is kept", () => {
		expect(cliSandboxDecision({ reaped: false, pid: 6004, boundIdentity: { state: "alive", id: "X" }, teardown: { reaped: false } })).toBe(false);
	});
});

describe("consistencyProbeDecision (F6)", () => {
	const aliveA = { state: "alive", id: "A" } as const;
	const aliveB = { state: "alive", id: "B" } as const;

	test("warm-up residue → residue true and NO retry (even for a matching pair)", () => {
		const warm: any = { state: "unknown", error: "identity probe timed out after 10ms", probeCleanup: "unreaped", probePid: 1 };
		const v = consistencyProbeDecision({ warmup: warm, results: [aliveA], a: aliveA, b: aliveA });
		expect(v.residue).toBe(true);
		expect(v.retry).toBe(false);
	});

	test("comparison result residue → residue true and NO retry", () => {
		const taggedA: any = { state: "alive", id: "A", probeCleanup: "unreaped", probePid: 2 };
		const v = consistencyProbeDecision({ warmup: { state: "alive", id: "W" }, results: [taggedA], a: taggedA, b: aliveA });
		expect(v.residue).toBe(true);
		expect(v.retry).toBe(false);
	});

	test("mismatch without residue → retry allowed", () => {
		const v = consistencyProbeDecision({ warmup: { state: "alive", id: "W" }, results: [aliveA], a: aliveA, b: aliveB });
		expect(v.residue).toBe(false);
		expect(v.pairOk).toBe(false);
		expect(v.retry).toBe(true);
	});

	test("matching pair without residue → pairOk, no retry", () => {
		const v = consistencyProbeDecision({ warmup: { state: "alive", id: "W" }, results: [aliveA], a: aliveA, b: aliveA });
		expect(v.residue).toBe(false);
		expect(v.pairOk).toBe(true);
		expect(v.retry).toBe(false);
	});

	// (F6, amendment 5) teardown probe residue: an internal re-check probe
	// that timed out unreaped never reaches `results` — its residue lives
	// only in the teardown result (tagged bound/signal identities +
	// probeResidue + error text). The retention predicate must still see
	// it, even when every explicit probe result is clean and the root
	// exited cleanly reaped.
	test("main teardown probeResidue (internal re-check probe) → residue true, no retry", () => {
		const teardown: any = {
			reaped: true,
			exitCode: 1,
			signalled: false,
			probeResidue: true,
			signalIdentity: { state: "unknown", error: "identity probe timed out after 10ms", probeCleanup: "unreaped", probePid: 8123211 },
			errors: ["identity probe child pid 8123211 was not reaped after the probe timeout (probeCleanup: unreaped); the sandbox is kept"],
		};
		const v = consistencyProbeDecision({ warmup: { state: "alive", id: "W" }, results: [aliveA], a: aliveA, b: aliveA, teardowns: [teardown] });
		expect(v.residue).toBe(true);
		expect(v.retry).toBe(false);
	});

	test("finally guard teardown probeResidue → retention stays true even on a clean root exit", () => {
		const guard: any = { reaped: true, exitCode: 1, signalled: false, probeResidue: true };
		const v = consistencyProbeDecision({ warmup: null, results: [{ state: "gone" }], a: null, b: null, teardowns: [guard] });
		expect(v.residue).toBe(true);
	});
});

describe("killError propagation (F8)", () => {
	// The real kill failure must survive every hop (diagnostic-only, never
	// a signal permission): raw probe result → capture (voided on the
	// root exit) → teardown residue facts → the CLI decision's retained
	// facts.
	test("killError survives raw → capture (voided) → teardown → CLI decision facts", async () => {
		const raw: any = {
			state: "unknown",
			error: "identity probe timed out after 10ms",
			probeCleanup: "unreaped",
			probePid: 8123221,
			killError: "kill EPERM: query survived",
		};
		const child = fakeChild(8123220);
		child.exitCode = 1; // the root exited during the capture
		const captured: any = await captureChildIdentity(child, async () => raw);
		expect(captured).toEqual({ state: "gone", probeCleanup: "unreaped", probePid: 8123221, killError: "kill EPERM: query survived" });
		const teardown: any = await teardownChild(child, {
			platform: "win32",
			boundIdentity: captured,
			identity: async () => raw,
			closeTimeoutMs: 5,
		});
		expect(teardown.reaped).toBe(true);
		expect(teardown.probeResidue).toBe(true);
		expect(JSON.stringify(teardown.errors)).toContain("kill EPERM: query survived");
		// the CLI decision keeps the sandbox and its retained facts carry
		// the kill error:
		expect(cliSandboxDecision({ reaped: teardown.reaped, pid: child.pid, boundIdentity: captured, teardown })).toBe(false);
		expect(JSON.stringify({ boundIdentity: captured, teardown })).toContain("kill EPERM: query survived");
	}, 5_000);

	// A pre-signal re-check probe that timed out with a kill failure: the
	// recorded signalIdentity carries the kill error, and the residue
	// error text does too.
	test("a re-check probe kill failure lands in signalIdentity and the teardown errors", async () => {
		const raw: any = {
			state: "unknown",
			error: "identity probe timed out after 10ms",
			probeCleanup: "unreaped",
			probePid: 9123221,
			killError: "kill EPERM: recheck survived",
		};
		const child = fakeChild(9123220);
		const pending = teardownChild(child, {
			platform: "win32",
			boundIdentity: { state: "alive", id: "X" },
			identity: async () => raw,
			runTaskkill: () => ({ status: 0, error: null }),
			closeTimeoutMs: 5,
		});
		const teardown: any = await pending;
		expect(teardown.signalled).toBe(false);
		expect(teardown.probeResidue).toBe(true);
		expect(teardown.signalIdentity).toEqual(raw);
		expect(JSON.stringify(teardown.errors)).toContain("kill EPERM: recheck survived");
	}, 5_000);

	// Reviewer's `reaped-kill-error-voiding` case (F8 residual): the probe's
	// kill emitted an error but the probe CLOSED before the wait expired
	// (recovered), and the root exited during capture. The killError must
	// survive the gone voiding; the residue tags stay CONDITIONAL — a
	// recovered probe leaves no residue (no probeCleanup tag, no probePid).
	test("a recovered (reaped) probe's killError survives the gone voiding (F8 residual)", async () => {
		const raw: any = {
			state: "unknown",
			error: "identity probe timed out after 10ms",
			probeCleanup: "reaped",
			probePid: 8123261,
			killError: "kill EPERM: recovered by natural exit",
		};
		const child = fakeChild(8123260);
		child.exitCode = 1; // the root exits during the capture (voiding)
		const captured: any = await captureChildIdentity(child, async () => raw);
		expect(captured).toEqual({ state: "gone", killError: "kill EPERM: recovered by natural exit" });
		// Residue tags stay CONDITIONAL: a recovered probe is not residue.
		expect(captured.probeCleanup).toBeUndefined();
		expect(captured.probePid).toBeUndefined();
	}, 5_000);
});

describe("shouldRemoveSandbox", () => {
	test("the sandbox is removed only when reaped, or when the child never spawned", () => {
		// reaped → remove
		expect(shouldRemoveSandbox({ reaped: true, pid: 4242 } as never)).toBe(true);
		// not reaped (e.g. taskkill failed, survivor) → keep
		expect(
			shouldRemoveSandbox({
				reaped: false,
				pid: 4242,
				errors: ["taskkill /PID 4242 /T /F exited 128; the child may still be running"],
			} as never),
		).toBe(false);
		// never spawned — an EXPLICIT null pid (undefined is not "never
		// spawned") → nothing was running inside: remove
		expect(shouldRemoveSandbox({ reaped: false, pid: null } as never)).toBe(true);
		// mis-shaped / null → fail closed (an empty object is NOT removable)
		expect(shouldRemoveSandbox({} as never)).toBe(false);
		expect(shouldRemoveSandbox(null as never)).toBe(false);
		// probe residue (an unreaped probe child may still run) → keep —
		// ALWAYS, even alongside a reaped root child
		expect(shouldRemoveSandbox({ reaped: true, pid: 4242, probeResidue: true } as never)).toBe(false);
		expect(shouldRemoveSandbox({ reaped: false, pid: 4242, probeResidue: true } as never)).toBe(false);
		expect(shouldRemoveSandbox({ reaped: true, pid: 4242, probeResidue: false } as never)).toBe(true);
	});
});
