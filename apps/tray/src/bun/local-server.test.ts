import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	bundledHelperCandidates,
	bundledHelperPath,
	DEFAULT_HEALTH_PORTS,
	ensurePinarHome,
	findHealthyPort,
	healthPorts,
	parseNetstatListeningPid,
	pinnedHealthPort,
	pinarBin,
	runningAppBundle,
	runningAppRoot,
	stopServer,
	usesShell,
} from "./local-server";

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
});
