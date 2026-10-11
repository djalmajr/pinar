import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:net";
import { describe, expect, test } from "bun:test";
import {
	bundledHelperCandidates,
	bundledHelperPath,
	DEFAULT_HEALTH_PORTS,
	ensurePinarHome,
	findHealthyPort,
	healthPorts,
	killListeningPid,
	parseNetstatListeningPid,
	pinnedHealthPort,
	pinarBin,
	runningAppBundle,
	runningAppRoot,
	stopServer,
	usesShell,
} from "./local-server";
import type { IdentityOutcome } from "./process-identity";

describe("bundled helper paths", () => {
	test("runningAppBundle walks up to the .app wrapper", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-bundle-"));
		const app = join(root, "Pinar.app");
		const execPath = join(app, "Contents", "MacOS", ".cottontail-tmp", "run", "launcher");
		mkdirSync(dirname(execPath), { recursive: true });
		writeFileSync(execPath, "");
		expect(runningAppBundle(execPath)).toBe(app);
	});

	test("pinarBin prefers the helper inside Contents/Helpers", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-helper-"));
		const app = join(root, "Pinar.app");
		const execPath = join(app, "Contents", "MacOS", "Pinar");
		const helper = join(app, "Contents", "Helpers", "pinar");
		mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
		mkdirSync(join(app, "Contents", "Helpers"), { recursive: true });
		writeFileSync(execPath, "");
		writeFileSync(helper, "");
		const previous = process.env.PINAR_BIN;
		delete process.env.PINAR_BIN;
		try {
			expect(bundledHelperCandidates(app)).toContain(helper);
			expect(bundledHelperPath(execPath)).toBe(helper);
			expect(pinarBin(execPath)).toBe(helper);
		} finally {
			if (previous == null) delete process.env.PINAR_BIN;
			else process.env.PINAR_BIN = previous;
		}
	});

	test("PINAR_BIN wins over the bundled helper", () => {
		expect(pinarBin()).not.toBe("/tmp/custom-pinar");
		const previous = process.env.PINAR_BIN;
		process.env.PINAR_BIN = "/tmp/custom-pinar";
		try {
			expect(pinarBin()).toBe("/tmp/custom-pinar");
		} finally {
			if (previous == null) delete process.env.PINAR_BIN;
			else process.env.PINAR_BIN = previous;
		}
	});

	test("runningAppRoot finds a Windows app folder with Helpers/pinar.exe", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-win-bundle-"));
		const execPath = join(root, "runtime", "cottontail.exe");
		const helper = join(root, "Helpers", "pinar.exe");
		mkdirSync(dirname(execPath), { recursive: true });
		mkdirSync(join(root, "Helpers"), { recursive: true });
		writeFileSync(execPath, "");
		writeFileSync(helper, "");
		expect(runningAppRoot(execPath)).toBe(root);
		expect(bundledHelperPath(execPath)).toBe(helper);
		const previous = process.env.PINAR_BIN;
		delete process.env.PINAR_BIN;
		try {
			expect(pinarBin(execPath)).toBe(helper);
		} finally {
			if (previous == null) delete process.env.PINAR_BIN;
			else process.env.PINAR_BIN = previous;
		}
	});

	test("runningAppRoot finds the Setup app folder with Resources/app/Helpers/pinar.exe", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-setup-bundle-"));
		const app = join(root, "app");
		const execPath = join(app, "bin", "cottontail.exe");
		const helper = join(app, "Resources", "app", "Helpers", "pinar.exe");
		mkdirSync(dirname(execPath), { recursive: true });
		mkdirSync(dirname(helper), { recursive: true });
		writeFileSync(execPath, "");
		writeFileSync(helper, "");
		expect(runningAppRoot(execPath)).toBe(app);
		expect(bundledHelperPath(execPath)).toBe(helper);
		const previous = process.env.PINAR_BIN;
		delete process.env.PINAR_BIN;
		try {
			expect(pinarBin(execPath)).toBe(helper);
		} finally {
			if (previous == null) delete process.env.PINAR_BIN;
			else process.env.PINAR_BIN = previous;
		}
	});

	test("runningAppRoot ignores a Resources/app dir without Helpers/pinar.exe", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-setup-partial-"));
		const app = join(root, "app");
		const execPath = join(app, "bin", "cottontail.exe");
		mkdirSync(dirname(execPath), { recursive: true });
		mkdirSync(join(app, "Resources", "app"), { recursive: true });
		writeFileSync(execPath, "");
		expect(runningAppRoot(execPath)).toBeNull();
	});

	test("usesShell is true only for Windows batch launchers", () => {
		expect(usesShell("C:\\pinar\\bin\\pinar.cmd", "win32")).toBe(true);
		expect(usesShell("C:\\pinar\\Helpers\\pinar.exe", "win32")).toBe(false);
		expect(usesShell("/opt/pinar/hooks/ensure.mjs", "darwin")).toBe(false);
	});

	test("darwin does not fall back to ~/.pinar/bin", () => {
		if (process.platform !== "darwin") return;
		const previous = process.env.PINAR_BIN;
		delete process.env.PINAR_BIN;
		try {
			expect(pinarBin("/tmp/not-inside-an-app/launcher")).not.toMatch(/\.pinar\/bin/);
		} finally {
			if (previous == null) delete process.env.PINAR_BIN;
			else process.env.PINAR_BIN = previous;
		}
	});
});

describe("health ports", () => {
	test("healthPorts returns the default 10-port sweep without PINAR_PORT", () => {
		expect(healthPorts({})).toEqual([
			17373, 17374, 17375, 17376, 17377, 17378, 17379, 17380, 17381, 17382,
		]);
		expect(healthPorts({})).toEqual(DEFAULT_HEALTH_PORTS);
	});

	test("healthPorts pins to PINAR_PORT when it is a valid integer 1-65535", () => {
		expect(healthPorts({ PINAR_PORT: "17390" })).toEqual([17390]);
		expect(healthPorts({ PINAR_PORT: "1" })).toEqual([1]);
		expect(healthPorts({ PINAR_PORT: "65535" })).toEqual([65535]);
	});

	test("healthPorts falls back to the sweep for an invalid PINAR_PORT", () => {
		for (const invalid of ["", "0", "65536", "-1", "abc", "12.5", "1e3", "0x10", "17390 junk"]) {
			expect(healthPorts({ PINAR_PORT: invalid })).toEqual(DEFAULT_HEALTH_PORTS);
		}
	});

	test("pinnedHealthPort reports the pinned port or null", () => {
		expect(pinnedHealthPort({ PINAR_PORT: "17390" })).toBe(17390);
		expect(pinnedHealthPort({})).toBeNull();
		expect(pinnedHealthPort({ PINAR_PORT: "0" })).toBeNull();
		expect(pinnedHealthPort({ PINAR_PORT: "65536" })).toBeNull();
		expect(pinnedHealthPort({ PINAR_PORT: "junk" })).toBeNull();
	});

	test("findHealthyPort consults only the pinned port", async () => {
		const requested: string[] = [];
		const fakeFetch: typeof fetch = async (input) => {
			requested.push(String(input));
			return new Response(JSON.stringify({ ok: true, service: "pinar" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const port = await findHealthyPort({ env: { PINAR_PORT: "17390" }, fetch: fakeFetch });
		expect(port).toBe(17390);
		expect(requested).toEqual(["http://127.0.0.1:17390/api/health"]);
	});

	test("findHealthyPort still sweeps the default ports without PINAR_PORT", async () => {
		const requested: string[] = [];
		const fakeFetch: typeof fetch = async (input) => {
			requested.push(String(input));
			if (requested.length === 1) throw new Error("connection refused");
			return new Response(JSON.stringify({ ok: true, service: "pinar" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const port = await findHealthyPort({ env: {}, fetch: fakeFetch });
		expect(port).toBe(17374);
		expect(requested).toEqual([
			"http://127.0.0.1:17373/api/health",
			"http://127.0.0.1:17374/api/health",
		]);
	});

	test("findHealthyPort falls back to the sweep for an invalid PINAR_PORT", async () => {
		const requested: string[] = [];
		const fakeFetch: typeof fetch = async (input) => {
			requested.push(String(input));
			return new Response(JSON.stringify({ ok: true, service: "pinar" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const port = await findHealthyPort({ env: { PINAR_PORT: "not-a-port" }, fetch: fakeFetch });
		expect(port).toBe(17373);
		expect(requested).toEqual(["http://127.0.0.1:17373/api/health"]);
	});

	test("findHealthyPort returns null when the pinned port is not a pinar helper", async () => {
		const requested: string[] = [];
		const fakeFetch: typeof fetch = async (input) => {
			requested.push(String(input));
			return new Response(JSON.stringify({ ok: true, service: "other" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const port = await findHealthyPort({ env: { PINAR_PORT: "17390" }, fetch: fakeFetch });
		expect(port).toBeNull();
		expect(requested).toEqual(["http://127.0.0.1:17390/api/health"]);
	});

	test("findHealthyPort reads PINAR_PORT from process.env by default", async () => {
		const requested: string[] = [];
		const fakeFetch: typeof fetch = async (input) => {
			requested.push(String(input));
			return new Response(JSON.stringify({ ok: true, service: "pinar" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const previous = process.env.PINAR_PORT;
		process.env.PINAR_PORT = "17391";
		try {
			const port = await findHealthyPort({ fetch: fakeFetch });
			expect(port).toBe(17391);
			expect(requested).toEqual(["http://127.0.0.1:17391/api/health"]);
		} finally {
			if (previous == null) delete process.env.PINAR_PORT;
			else process.env.PINAR_PORT = previous;
		}
	});
});

describe("stopServer respects the PINAR_PORT pin", () => {
	async function healthyBody(port: number) {
		const response = await fetch(`http://127.0.0.1:${port}/api/health`);
		return response.ok ? (await response.json()) : null;
	}

	test("leaves a healthy helper on an unpinned port untouched", async () => {
		const killed: number[] = [];
		// A healthy helper on an unpinned port (e.g. a production helper);
		// the tray's own pin is 17396 and nothing healthy is on it.
		const foreign = Bun.serve({
			port: 17397,
			fetch: () => new Response(JSON.stringify({ ok: true, service: "pinar" }), { status: 200 }),
		});
		const previous = process.env.PINAR_PORT;
		process.env.PINAR_PORT = "17396";
		try {
			await stopServer({
				run: async () => 0, // never spawn the real pinar CLI
				killPort: async (port) => {
					killed.push(port);
				},
				unhealthyTimeoutMs: 300,
			});
			// The pinned probe never sees 17397, so nothing is probed or killed:
			expect(killed).toEqual([]);
			// The foreign helper on the unpinned port is still serving.
			expect(await healthyBody(17397)).toEqual({ ok: true, service: "pinar" });
		} finally {
			foreign.stop();
			if (previous == null) delete process.env.PINAR_PORT;
			else process.env.PINAR_PORT = previous;
		}
	});

	test("with a valid pin, never calls run([\"stop\"]) and kills only the pinned listener", async () => {
		const runCalls: string[][] = [];
		const killed: number[] = [];
		const own = Bun.serve({
			port: 17396,
			fetch: () => new Response(JSON.stringify({ ok: true, service: "pinar" }), { status: 200 }),
		});
		const foreign = Bun.serve({
			port: 17397,
			fetch: () => new Response(JSON.stringify({ ok: true, service: "pinar" }), { status: 200 }),
		});
		const previous = process.env.PINAR_PORT;
		process.env.PINAR_PORT = "17396";
		try {
			await stopServer({
				run: async (args) => {
					runCalls.push(args);
					return 0;
				},
				healthyPort: () => findHealthyPort(), // the real probe, pinned by env
				killPort: async (port, seen) => {
					killed.push(port);
					seen.add(killed.length); // a new pid each time: run to the bound
				},
				unhealthyTimeoutMs: 300,
			});
			// `pinar stop` signals PINAR_HOME/server.pid regardless of the pin:
			// with a pin it must not run at all.
			expect(runCalls).toEqual([]);
			// The kill loop still stopped the pinned listener.
			expect(killed.length).toBeGreaterThan(0);
			expect(new Set(killed)).toEqual(new Set([17396]));
			// The foreign helper on the unpinned port is still serving.
			expect(await healthyBody(17397)).toEqual({ ok: true, service: "pinar" });
		} finally {
			own.stop();
			foreign.stop();
			if (previous == null) delete process.env.PINAR_PORT;
			else process.env.PINAR_PORT = previous;
		}
	});

	test("kill loop only targets the port the pinned health probe reports", async () => {
		const killed: number[] = [];
		// Own helper on the pinned port; foreign helper on an unpinned port.
		const own = Bun.serve({
			port: 17396,
			fetch: () => new Response(JSON.stringify({ ok: true, service: "pinar" }), { status: 200 }),
		});
		const foreign = Bun.serve({
			port: 17397,
			fetch: () => new Response(JSON.stringify({ ok: true, service: "pinar" }), { status: 200 }),
		});
		const previous = process.env.PINAR_PORT;
		process.env.PINAR_PORT = "17396";
		try {
			await stopServer({
				run: async () => 0,
				healthyPort: () => findHealthyPort(), // the real probe, pinned by env
				killPort: async (port, seen) => {
					killed.push(port);
					seen.add(killed.length); // a new pid each time: run to the bound
				},
				unhealthyTimeoutMs: 300,
			});
			// The sweep ran to its bound, and every kill was on the pinned port.
			expect(killed.length).toBeGreaterThan(0);
			expect(new Set(killed)).toEqual(new Set([17396]));
			// The foreign helper on the unpinned port is still serving.
			expect(await healthyBody(17397)).toEqual({ ok: true, service: "pinar" });
		} finally {
			own.stop();
			foreign.stop();
			if (previous == null) delete process.env.PINAR_PORT;
			else process.env.PINAR_PORT = previous;
		}
	});
});

describe("data home", () => {
	test("ensurePinarHome recreates a missing folder and shots dir", () => {
		const root = join(mkdtempSync(join(tmpdir(), "pinar-home-")), "gone");
		expect(existsSync(root)).toBe(false);
		expect(ensurePinarHome(root)).toBe(root);
		expect(existsSync(root)).toBe(true);
		expect(existsSync(join(root, "shots"))).toBe(true);
		expect(ensurePinarHome(root)).toBe(root);
	});
});

describe("stopServer", () => {
	test("runs pinar stop and returns once health is gone", async () => {
		const calls: string[][] = [];
		let port: number | null = 17373;
		const killed: number[] = [];
		delete process.env.PINAR_PORT; // no pin: the legacy stop must run
		await stopServer({
			run: async (args) => {
				calls.push(args);
				port = null;
				return 0;
			},
			healthyPort: async () => port,
			killPort: async (next) => {
				killed.push(next);
			},
			wait: async () => {},
		});
		expect(calls).toEqual([["stop"]]);
		expect(killed).toEqual([]);
	});

	test("parses a Windows netstat LISTENING pid", () => {
		const stdout = [
			"  TCP    127.0.0.1:17373        0.0.0.0:0              LISTENING       41156",
			"  TCP    127.0.0.1:443          0.0.0.0:0              LISTENING       4",
		].join("\r\n");
		expect(parseNetstatListeningPid(stdout, 17373)).toBe(41156);
		expect(parseNetstatListeningPid(stdout, 17374)).toBeNull();
	});

	test("falls back to killing the listening pid when pinar stop leaves health up", async () => {
		const killed: number[] = [];
		let port: number | null = 17373;
		delete process.env.PINAR_PORT; // no pin: the legacy stop must run
		await stopServer({
			unhealthyTimeoutMs: 0,
			run: async () => 0,
			healthyPort: async () => port,
			killPort: async (next, seen) => {
				killed.push(next);
				seen.add(42);
				port = null;
			},
			wait: async () => {},
		});
		expect(killed).toEqual([17373]);
	});

	test("records every refusal, signal and error from the kill loop in the result", async () => {
		let calls = 0;
		delete process.env.PINAR_PORT; // no pin: the legacy stop must run
		const result = await stopServer({
			run: async () => 0,
			healthyPort: async () => {
				calls += 1;
				return calls < 3 ? 17373 : null;
			},
			killPort: async (port, seen) => {
				seen.add(7);
				return {
					refusals: [{ pid: 7, port, reason: "reused" as const, step: "pre-sigterm" as const }],
					signals: [{ pid: 7, port, signal: "SIGTERM" as const }],
					errors: ["recorded fault"],
				};
			},
			wait: async () => {},
			unhealthyTimeoutMs: 0,
		});
		expect(result.refusals).toEqual([{ pid: 7, port: 17373, reason: "reused", step: "pre-sigterm" }]);
		expect(result.signals).toEqual([{ pid: 7, port: 17373, signal: "SIGTERM" }]);
		expect(result.errors).toEqual(["recorded fault"]);
	});
});

describe("killListeningPid identity guards (fakes)", () => {
	const PORT = 17401;
	const PID = 4242;
	const A: IdentityOutcome = { state: "alive", id: "1123456789" };
	const B: IdentityOutcome = { state: "alive", id: "9876543210" };
	const UNKNOWN: IdentityOutcome = { state: "unknown", error: "boom" };
	const GONE: IdentityOutcome = { state: "gone" };

	interface HarnessOpts {
		platform?: string;
		/** Listener pids per netstat/lsof call (last entry reused). */
		listening?: (number | null)[];
		/** Identity outcomes per probe call (last entry reused). */
		identity?: IdentityOutcome[];
		sigtermThrows?: boolean;
		taskkillCode?: number | null;
		taskkillTimedOut?: boolean;
	}

	function harness(opts: HarnessOpts = {}) {
		const listeningCalls: number[] = [];
		const listeningSeq = opts.listening ?? [PID, PID];
		const listeningPid = async (port: number): Promise<number | null> => {
			listeningCalls.push(port);
			return listeningSeq[Math.min(listeningCalls.length - 1, listeningSeq.length - 1)] ?? null;
		};
		const identityCalls: number[] = [];
		const identityScript = opts.identity ?? [A];
		const identity = async (pid: number): Promise<IdentityOutcome> => {
			identityCalls.push(pid);
			return identityScript[Math.min(identityCalls.length - 1, identityScript.length - 1)];
		};
		const signals: string[] = [];
		const signal = (pid: number, sig: string): boolean => {
			if (opts.sigtermThrows && sig === "SIGTERM") throw new Error("ESRCH");
			signals.push(`${pid}:${sig}`);
			return true;
		};
		const taskkillCalls: number[] = [];
		const taskkill = async (pid: number) => {
			taskkillCalls.push(pid);
			return opts.taskkillTimedOut ? { code: null, timedOut: true } : { code: opts.taskkillCode ?? 0 };
		};
		const sleepCalls: number[] = [];
		const sleepFn = async (ms: number): Promise<void> => {
			sleepCalls.push(ms);
		};
		return {
			deps: {
				platform: opts.platform ?? process.platform,
				listeningPid,
				identity,
				signal,
				taskkill,
				sleep: sleepFn,
			},
			signals,
			taskkillCalls,
			sleepCalls,
			identityCalls,
			listeningCalls,
		};
	}

	test("signals SIGTERM and SIGKILL only when the bound id is unchanged", async () => {
		const h = harness({ platform: "posix", identity: [A, A, A] });
		const seen = new Set<number>();
		const outcome = await killListeningPid(PORT, seen, h.deps);
		expect(h.signals).toEqual([`${PID}:SIGTERM`, `${PID}:SIGKILL`]);
		expect(outcome.signals).toEqual([
			{ pid: PID, port: PORT, signal: "SIGTERM" },
			{ pid: PID, port: PORT, signal: "SIGKILL" },
		]);
		expect(outcome.refusals).toEqual([]);
		expect(outcome.errors).toEqual([]);
		expect(h.sleepCalls).toEqual([150]);
		expect(seen.has(PID)).toBe(true);
		expect(h.identityCalls).toEqual([PID, PID, PID]);
	});

	test("reused id at pre-SIGTERM: no signal, refusal recorded", async () => {
		const h = harness({ platform: "posix", identity: [A, B] });
		const seen = new Set<number>();
		const outcome = await killListeningPid(PORT, seen, h.deps);
		expect(h.signals).toEqual([]);
		expect(h.taskkillCalls).toEqual([]);
		expect(outcome.signals).toEqual([]);
		expect(outcome.refusals).toEqual([{ pid: PID, port: PORT, reason: "reused", step: "pre-sigterm" }]);
		expect(seen.has(PID)).toBe(true);
	});

	test("reused id after SIGTERM: SIGTERM sent, no escalation, refusal recorded", async () => {
		const h = harness({ platform: "posix", identity: [A, A, B] });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.signals).toEqual([`${PID}:SIGTERM`]);
		expect(outcome.signals).toEqual([{ pid: PID, port: PORT, signal: "SIGTERM" }]);
		expect(outcome.refusals).toEqual([{ pid: PID, port: PORT, reason: "reused", step: "pre-escalation" }]);
		expect(h.sleepCalls).toEqual([150]);
	});

	test("unknown at bind: refusal, no signal, no further probes", async () => {
		const h = harness({ platform: "posix", identity: [UNKNOWN] });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.signals).toEqual([]);
		expect(outcome.refusals).toEqual([{ pid: PID, port: PORT, reason: "unknown", step: "bind" }]);
		expect(h.identityCalls).toEqual([PID]);
	});

	test("unknown at pre-SIGTERM: refusal, no signal", async () => {
		const h = harness({ platform: "posix", identity: [A, UNKNOWN] });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.signals).toEqual([]);
		expect(outcome.refusals).toEqual([{ pid: PID, port: PORT, reason: "unknown", step: "pre-sigterm" }]);
	});

	test("unknown at pre-escalation: SIGTERM sent, refusal, no escalation", async () => {
		const h = harness({ platform: "posix", identity: [A, A, UNKNOWN] });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.signals).toEqual([`${PID}:SIGTERM`]);
		expect(outcome.refusals).toEqual([{ pid: PID, port: PORT, reason: "unknown", step: "pre-escalation" }]);
	});

	test("gone at bind: no signal and no refusal", async () => {
		const h = harness({ platform: "posix", identity: [GONE] });
		const seen = new Set<number>();
		const outcome = await killListeningPid(PORT, seen, h.deps);
		expect(h.signals).toEqual([]);
		expect(outcome.signals).toEqual([]);
		expect(outcome.refusals).toEqual([]);
		expect(seen.has(PID)).toBe(true);
	});

	test("listener-changed after the bind: refusal, no signal", async () => {
		const h = harness({ platform: "posix", listening: [PID, 9999], identity: [A, A] });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.signals).toEqual([]);
		expect(outcome.refusals).toEqual([{ pid: PID, port: PORT, reason: "listener-changed", step: "bind" }]);
	});

	test("SIGTERM throwing on POSIX: no escalation when the pre-escalation re-probe is gone", async () => {
		const h = harness({ platform: "posix", sigtermThrows: true, identity: [A, A, GONE] });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.signals).toEqual([]);
		expect(outcome.signals).toEqual([]);
		expect(outcome.refusals).toEqual([]);
	});

	test("win32 fallback: SIGTERM throws, re-probe same id, taskkill sent, no escalation", async () => {
		const h = harness({ platform: "win32", sigtermThrows: true, identity: [A, A, A, GONE], taskkillCode: 0 });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.signals).toEqual([]); // SIGTERM threw; no handle signal recorded
		expect(h.taskkillCalls).toEqual([PID]); // the fallback only — the pre-escalation re-probe is gone
		expect(outcome.signals).toEqual([{ pid: PID, port: PORT, signal: "taskkill" }]);
		expect(outcome.refusals).toEqual([]);
		expect(outcome.errors).toEqual([]);
	});

	test("win32 fallback: reused id before taskkill, no taskkill", async () => {
		const h = harness({ platform: "win32", sigtermThrows: true, identity: [A, A, B, B] });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.signals).toEqual([]);
		expect(h.taskkillCalls).toEqual([]);
		expect(outcome.refusals).toEqual([
			{ pid: PID, port: PORT, reason: "reused", step: "pre-taskkill" },
			{ pid: PID, port: PORT, reason: "reused", step: "pre-escalation" },
		]);
	});

	test("win32 escalation runs taskkill only with an unchanged id", async () => {
		const h = harness({ platform: "win32", identity: [A, A, A] });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.signals).toEqual([`${PID}:SIGTERM`]);
		expect(h.taskkillCalls).toEqual([PID]); // the escalation (win32 escalates through taskkill)
		expect(outcome.signals).toEqual([
			{ pid: PID, port: PORT, signal: "SIGTERM" },
			{ pid: PID, port: PORT, signal: "taskkill" },
		]);
	});

	test("win32 taskkill failure is recorded, never retried", async () => {
		const h = harness({ platform: "win32", sigtermThrows: true, identity: [A, A, A, GONE], taskkillCode: 1 });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.taskkillCalls).toEqual([PID]);
		expect(outcome.errors).toEqual([`taskkill exited 1 (pid ${PID})`]);
	});

	test("win32 taskkill timeout is recorded", async () => {
		const h = harness({ platform: "win32", sigtermThrows: true, identity: [A, A, A, GONE], taskkillTimedOut: true });
		const outcome = await killListeningPid(PORT, new Set<number>(), h.deps);
		expect(h.taskkillCalls).toEqual([PID]);
		expect(outcome.errors).toEqual([expect.stringMatching(new RegExp(`taskkill timed out after \\d+ms \\(pid ${PID}\\)`))]);
	});

	test("a pid already in seen is not re-signalled", async () => {
		const h = harness({ platform: "posix", identity: [A, A, A] });
		const seen = new Set<number>([PID]);
		const outcome = await killListeningPid(PORT, seen, h.deps);
		expect(h.identityCalls).toEqual([]);
		expect(outcome).toEqual({ refusals: [], signals: [], errors: [] });
	});

	test("no listener on the port: no probe, no signal", async () => {
		const h = harness({ platform: "posix", listening: [null] });
		const seen = new Set<number>();
		const outcome = await killListeningPid(PORT, seen, h.deps);
		expect(h.identityCalls).toEqual([]);
		expect(outcome).toEqual({ refusals: [], signals: [], errors: [] });
		expect(seen.size).toBe(0);
	});
});

describe("killListeningPid native (win32 host)", () => {
	// Our own bun child: a bare TCP listener on 127.0.0.1, job port range only.
	const LISTENER_SOURCE =
		"import { createServer } from 'node:net';\n" +
		"const port = Number(process.argv[2]);\n" +
		"if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(2);\n" +
		"const server = createServer((socket) => socket.end('ok\\n'));\n" +
		"server.once('error', (error) => { console.error(String(error.message)); process.exit(1); });\n" +
		"server.listen(port, '127.0.0.1', () => process.stdout.write('ready\\n'));\n";

	async function freeJobPort(): Promise<number> {
		for (let port = 17401; port <= 17409; port += 1) {
			const free = await new Promise<boolean>((resolve) => {
				const server = createServer();
				server.once("error", () => resolve(false));
				server.listen(port, "127.0.0.1", () => {
					server.close(() => resolve(true));
				});
			});
			if (free) return port;
		}
		throw new Error("no free job port in 127.0.0.1:17401-17409");
	}

	function waitForReady(child: ChildProcess): Promise<void> {
		return new Promise((resolve, reject) => {
			let done = false;
			const timer = setTimeout(() => {
				if (!done) {
					done = true;
					reject(new Error("listener did not become ready"));
				}
			}, 20_000);
			const onData = (chunk: Buffer) => {
				if (!done && String(chunk).includes("ready")) {
					done = true;
					clearTimeout(timer);
					resolve();
				}
			};
			const onExit = () => {
				if (!done) {
					done = true;
					clearTimeout(timer);
					reject(new Error("listener exited before ready"));
				}
			};
			child.stdout?.on("data", onData);
			child.once("exit", onExit);
			child.once("error", onExit);
		});
	}

	function stopOwnChild(child: ChildProcess): Promise<void> {
		return new Promise((resolve) => {
			if (child.exitCode != null || child.signalCode != null) {
				resolve();
				return;
			}
			const timer = setTimeout(() => resolve(), 10_000); // never hang the suite
			child.once("close", () => {
				clearTimeout(timer);
				resolve();
			});
			try {
				// Our own child, through the held handle — never a numeric-PID signal.
				child.kill();
			} catch {
				clearTimeout(timer);
				resolve();
			}
		});
	}

	test.skipIf(process.platform !== "win32")("stops a real listener under the real netstat + bounded identity guards", async () => {
		const port = await freeJobPort();
		const dir = mkdtempSync(join(tmpdir(), "pinar-native-"));
		const script = join(dir, "listener.js");
		writeFileSync(script, LISTENER_SOURCE);
		const child = spawn(process.execPath, [script, String(port)], { stdio: ["ignore", "pipe", "ignore"] });
		try {
			await waitForReady(child);
			expect(child.pid).toBeGreaterThan(0);
			// PID evidence for the "no process left behind" check (acceptance 4).
			console.log(`[native] listener pid=${child.pid} port=${port}`);
			// Observe the close through the HELD handle — the listener must be
			// attached before the kill: the real identity probes take seconds,
			// so the child closes mid-killListeningPid, long before it returns.
			const closePromise = new Promise<boolean>((resolve) => {
				const timer = setTimeout(() => resolve(false), 30_000);
				child.once("close", () => {
					clearTimeout(timer);
					resolve(true);
				});
			});
			const seen = new Set<number>();
			// The real defaults: real netstat, real boundedProcessIdentity, real process.kill.
			const outcome = await killListeningPid(port, seen);
			expect(outcome.signals.length).toBeGreaterThan(0);
			expect(outcome.refusals).toEqual([]);
			expect(outcome.errors).toEqual([]);
			expect(seen.has(child.pid ?? -1)).toBe(true);
			// The child is stopped.
			const closed = await closePromise;
			expect(closed).toBe(true);
		} finally {
			await stopOwnChild(child);
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60_000);

	test.skipIf(process.platform !== "win32")("refuses (no signal) when the identity seam reports a different id at pre-SIGTERM", async () => {
		const port = await freeJobPort();
		const dir = mkdtempSync(join(tmpdir(), "pinar-native-"));
		const script = join(dir, "listener.js");
		writeFileSync(script, LISTENER_SOURCE);
		const child = spawn(process.execPath, [script, String(port)], { stdio: ["ignore", "pipe", "ignore"] });
		let identityCalls = 0;
		const identity = async (pid: number): Promise<IdentityOutcome> => {
			identityCalls += 1;
			// Bind (the first call) reports one creation id; every re-probe
			// reports a different one: the guard must refuse, never signal.
			return identityCalls === 1
				? { state: "alive", id: "100000000000000000" }
				: { state: "alive", id: "200000000000000000" };
		};
		const signals: string[] = [];
		const signal = (pid: number, sig: string): boolean => {
			signals.push(`${pid}:${sig}`);
			return true;
		};
		try {
			await waitForReady(child);
			// PID evidence for the "no process left behind" check (acceptance 4).
			console.log(`[native] refusing listener pid=${child.pid} port=${port}`);
			const outcome = await killListeningPid(port, new Set<number>(), { identity, signal, sleep: async () => {} });
			expect(signals).toEqual([]);
			expect(outcome.signals).toEqual([]);
			expect(outcome.refusals.length).toBeGreaterThan(0);
			for (const refusal of outcome.refusals) expect(refusal.reason).toBe("reused");
			// The child was never signalled: it is still alive.
			expect(child.exitCode).toBeNull();
			expect(child.signalCode).toBeNull();
		} finally {
			// Kill our own child through the held handle.
			await stopOwnChild(child);
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60_000);
});
