import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	bundledHelperCandidates,
	bundledHelperPath,
	ensurePinarHome,
	parseNetstatListeningPid,
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
