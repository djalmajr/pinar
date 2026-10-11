import { EventEmitter } from "node:events";
import type { SpawnOptions } from "node:child_process";
import { describe, expect, test } from "bun:test";
// Test-only import of the reference implementation (the production tray never
// bundles the scripts/ smoke harness; only this parity test compares against it).
import { boundedIdentityProbe } from "../../../../scripts/child-teardown.mjs";
import { boundedProcessIdentity, type IdentityOutcome } from "./process-identity";

/**
 * Parity between the production-tray `boundedProcessIdentity` and the
 * reference `boundedIdentityProbe` (scripts/child-teardown.mjs): the SAME
 * fake spawn outputs are fed to both and the results must be identical
 * (same state, same id, same error text, same probe cleanup tags).
 */

const FAKE_PID = 12345;

interface FakeSpawnPolicy {
	code: number;
	stdout?: string;
	/** Emit data+close after this delay (default 0). */
	delayMs?: number;
	/** Emit a close (code null) when kill() is called (default false). */
	closeOnKill?: boolean;
}

function makeFakeSpawn(policy: FakeSpawnPolicy) {
	const spawnArgs: Array<{ exe: string; args: string[]; opts: unknown }> = [];
	const killed: Array<{ atMs: number }> = [];
	let closeSent = false;

	const spawnFn = (exe: string, args: string[], opts: SpawnOptions) => {
		spawnArgs.push({ exe, args, opts });
		const child = new EventEmitter() as unknown as {
			pid: number;
			stdout: EventEmitter | null;
			kill: () => boolean;
		};
		child.pid = FAKE_PID;
		child.stdout = new EventEmitter();
		child.kill = () => {
			killed.push({ atMs: Date.now() });
			if (policy.closeOnKill && !closeSent) {
				closeSent = true;
				setTimeout(() => child.emit("close", null, "SIGKILL"), 5);
			}
			return true;
		};
		const timer = setTimeout(() => {
			if (closeSent) return;
			closeSent = true;
			(child.stdout as EventEmitter).emit("data", policy.stdout ?? "");
			child.emit("close", policy.code, null);
		}, policy.delayMs ?? 0);
		// The probe removes its own listeners on every path; the fake must
		// not keep the test process alive.
		timer.unref?.();
		return child as never;
	};
	return { spawnFn, spawnArgs, killed };
}

type FakeSpawn = ReturnType<typeof makeFakeSpawn>["spawnFn"];

/** Run one scripted spawn case through BOTH implementations and compare. */
async function parityCase(
	platform: string,
	policy: FakeSpawnPolicy,
	probeOptions?: { probeTimeoutMs?: number; probeKillWaitMs?: number; systemRoot?: string },
) {
	const common = {
		...probeOptions,
		probeTimeoutMs: probeOptions?.probeTimeoutMs ?? 30,
		probeKillWaitMs: probeOptions?.probeKillWaitMs ?? 50,
	};
	const fakeA = makeFakeSpawn(policy);
	const fakeB = makeFakeSpawn(policy);
	const [resultA, resultB] = await Promise.all([
		boundedProcessIdentity(platform, { spawn: fakeA.spawnFn as never, ...common })(FAKE_PID),
		boundedIdentityProbe(platform, { spawn: fakeB.spawnFn as never, ...common })(FAKE_PID),
	]);
	// Both implementations must have spawned exactly one probe child each,
	// with the same command line.
	expect(fakeA.spawnArgs.length).toBe(1);
	expect(fakeB.spawnArgs.length).toBe(1);
	expect(fakeA.spawnArgs[0]?.exe).toBe(fakeB.spawnArgs[0]?.exe);
	expect(fakeA.spawnArgs[0]?.args).toEqual(fakeB.spawnArgs[0]?.args);
	expect(resultA).toEqual(resultB);
	return { resultA, resultB, fakeA, fakeB };
}

describe("boundedProcessIdentity parity with boundedIdentityProbe", () => {
	test("win32 exit 0 + digits → alive with the CreationDate.ToFileTimeUtc() id", async () => {
		const { resultA } = await parityCase("win32", { code: 0, stdout: "13324546654321\n" });
		expect(resultA).toEqual({ state: "alive", id: "13324546654321" });
	});

	test("win32 exit 3 (absent) → gone", async () => {
		const { resultA } = await parityCase("win32", { code: 3 });
		expect(resultA).toEqual({ state: "gone" });
	});

	test("win32 exit 2 (CIM error) → unknown", async () => {
		const { resultA } = await parityCase("win32", { code: 2, stdout: "CIM failure" });
		expect(resultA).toEqual({ state: "unknown", error: "identity probe exited 2" });
	});

	test("win32 exit 4 (no CreationDate) → unknown", async () => {
		const { resultA } = await parityCase("win32", { code: 4 });
		expect(resultA).toEqual({ state: "unknown", error: "identity probe exited 4" });
	});

	test("win32 exit 0 + non-digit stdout → unknown", async () => {
		const { resultA } = await parityCase("win32", { code: 0, stdout: "not-a-timestamp" });
		expect(resultA).toEqual({ state: "unknown", error: "identity probe exited 0" });
	});

	test("darwin exit 0 + lstart → alive with the lstart text", async () => {
		const { resultA } = await parityCase("darwin", { code: 0, stdout: "S    Thu Jan 1 12:00:00 2026\n" });
		expect(resultA).toEqual({ state: "alive", id: "Thu Jan 1 12:00:00 2026" });
	});

	test("darwin exit 0 + Z stat → gone", async () => {
		const { resultA } = await parityCase("darwin", { code: 0, stdout: "Z+   Thu Jan 1 12:00:00 2026\n" });
		expect(resultA).toEqual({ state: "gone" });
	});

	test("darwin exit 1 + empty output → gone", async () => {
		const { resultA } = await parityCase("darwin", { code: 1, stdout: "" });
		expect(resultA).toEqual({ state: "gone" });
	});

	test("darwin exit 0 + unparsable output (no lstart field) → unknown", async () => {
		const { resultA } = await parityCase("darwin", { code: 0, stdout: "S" });
		expect(resultA).toEqual({ state: "unknown", error: "unparsable ps output (no lstart field)" });
	});

	test("timeout with the probe child reaped → unknown + probeCleanup reaped", async () => {
		const { resultA } = await parityCase("win32", { code: 0, delayMs: 5_000, closeOnKill: true });
		expect(resultA).toEqual({
			state: "unknown",
			error: "identity probe timed out after 30ms",
			probeCleanup: "reaped",
			probePid: FAKE_PID,
		});
	});

	test("timeout with the probe child unreaped → unknown + probeCleanup unreaped", async () => {
		const { resultA } = await parityCase("darwin", { code: 0, delayMs: 5_000, closeOnKill: false });
		expect(resultA).toEqual({
			state: "unknown",
			error: "identity probe timed out after 30ms",
			probeCleanup: "unreaped",
			probePid: FAKE_PID,
		});
	});

	test("both implementations spawn the fixed PowerShell path on win32", async () => {
		const { fakeA, fakeB } = await parityCase("win32", { code: 3 });
		// A fixed <SystemRoot> path — no executable discovery.
		expect(String(fakeA.spawnArgs[0]?.exe)).toContain("powershell.exe");
		expect(String(fakeA.spawnArgs[0]?.exe)).toBe(String(fakeB.spawnArgs[0]?.exe));
		expect(fakeA.spawnArgs[0]?.args).toEqual(
			["-NoProfile", "-NonInteractive", "-Command", expect.stringContaining("Get-CimInstance Win32_Process -Filter \"ProcessId=12345\"")],
		);
	});

	test("both implementations reject non-positive-integer pids without spawning", async () => {
		const badPids = [0, -1, 1.5, Number.NaN, null as never, "12" as never];
		for (const pid of badPids) {
			const fakeA = makeFakeSpawn({ code: 0 });
			const fakeB = makeFakeSpawn({ code: 0 });
			const [resultA, resultB] = await Promise.all([
				boundedProcessIdentity("win32", { spawn: fakeA.spawnFn as never })(pid),
				boundedIdentityProbe("win32", { spawn: fakeB.spawnFn as never })(pid),
			]);
			expect(fakeA.spawnArgs.length).toBe(0);
			expect(fakeB.spawnArgs.length).toBe(0);
			expect(resultA).toEqual(resultB);
			expect(resultA.state).toBe("unknown");
		}
	});
});

describe("boundedProcessIdentity live", () => {
	test("live probe of the host's own pid is alive and the id is stable across two calls", async () => {
		const probe = boundedProcessIdentity(process.platform);
		const first = (await probe(process.pid)) as IdentityOutcome;
		const second = (await probe(process.pid)) as IdentityOutcome;
		expect(first.state).toBe("alive");
		expect(second.state).toBe("alive");
		if (first.state === "alive" && second.state === "alive") {
			expect(second.id).toBe(first.id);
			expect(first.id.length).toBeGreaterThan(0);
		}
	}, 30_000);
});
