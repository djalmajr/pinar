import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { describe, expect, test } from "bun:test";
import { claimInstanceLock, isPinarTrayImage, processIsAlive } from "./instance-lock";

function lockPath() {
	return join(mkdtempSync(join(tmpdir(), "pinar-instance-lock-")), "tray.pid");
}

describe("tray instance lock", () => {
	test("first instance claims the lock", async () => {
		const path = lockPath();
		let duplicate = false;

		expect(
			await claimInstanceLock(path, () => (duplicate = true), { pid: 101 }),
		).toBe(true);
		expect(readFileSync(path, "utf8")).toBe("101\n");
		expect(duplicate).toBe(false);
	});

	test("live existing instance quits the duplicate without replacing its PID", async () => {
		const path = lockPath();
		writeFileSync(path, "101\n");
		let duplicate = false;

		expect(
			await claimInstanceLock(path, () => (duplicate = true), {
				isProcessAlive: (pid) => pid === 101,
				pid: 202,
			}),
		).toBe(false);
		expect(readFileSync(path, "utf8")).toBe("101\n");
		expect(duplicate).toBe(true);
	});

	test("stale existing instance is replaced", async () => {
		const path = lockPath();
		writeFileSync(path, "101\n");

		expect(
			await claimInstanceLock(
				path,
				() => {
					throw new Error("stale lock must not quit");
				},
				{
					isProcessAlive: () => false,
					pid: 202,
				},
			),
		).toBe(true);
		expect(readFileSync(path, "utf8")).toBe("202\n");
	});

	test("dead Windows PID is replaced even when signal probing would report it alive", async () => {
		const path = lockPath();
		writeFileSync(path, "101\n");
		let signalProbeCalled = false;
		const isProcessAlive = (pid: number) =>
			processIsAlive(pid, {
				platform: "win32",
				signalProcess: () => {
					signalProbeCalled = true;
				},
				windowsProcessExists: () => false,
			});

		expect(
			await claimInstanceLock(
				path,
				() => {
					throw new Error("dead Windows PID must not quit");
				},
				{ isProcessAlive, pid: 202 },
			),
		).toBe(true);
		expect(readFileSync(path, "utf8")).toBe("202\n");
		expect(signalProbeCalled).toBe(false);
	});

	test.skipIf(process.platform !== "win32")("Windows probe: running self is alive, an exited or foreign PID is not", async () => {
		expect(await processIsAlive(process.pid)).toBe(true);
		// The exited child's PID can still be opened while Windows keeps its object.
		const exited = Bun.spawnSync(["cmd", "/c", "exit 0"]).pid;
		expect(await processIsAlive(exited)).toBe(false);
		const foreign = Bun.spawn(["ping", "-n", "5", "127.0.0.1"], { stdout: "ignore" });
		try {
			expect(await processIsAlive(foreign.pid)).toBe(false);
		} finally {
			foreign.kill();
		}
	});

	test("current instance can reclaim its own lock", async () => {
		const path = lockPath();
		writeFileSync(path, "202\n");

		expect(
			await claimInstanceLock(
				path,
				() => {
					throw new Error("own lock must not quit");
				},
				{
					isProcessAlive: () => true,
					pid: 202,
				},
			),
		).toBe(true);
		expect(readFileSync(path, "utf8")).toBe("202\n");
	});
});

describe("Pinar tray image", () => {
	const localAppData = win32.join("C:", "Users", "me", "AppData", "Local");
	const app = win32.join(localAppData, "dev.pinar.local", "stable", "app");
	const pinarVersion = JSON.stringify({ identifier: "dev.pinar.local", version: "0.9.4" });

	function layout(files: Record<string, string>) {
		return {
			exists: (path: string) => path in files,
			readText: (path: string) => {
				if (!(path in files)) throw new Error(`missing ${path}`);
				return files[path];
			},
		};
	}

	function installedApp(root: string, version: string) {
		return layout({
			[win32.join(root, "bin", "launcher.exe")]: "",
			[win32.join(root, "Resources", "version.json")]: version,
		});
	}

	test("accepts the Bun runtime of an installed Pinar app", () => {
		const fs = installedApp(app, pinarVersion);
		expect(isPinarTrayImage(win32.join(app, "bin", "bun.exe"), fs)).toBe(true);
	});

	test("accepts the Cottontail runtime of a Pinar app from before Electrobun 2.0.4", () => {
		const fs = installedApp(app, pinarVersion);
		expect(isPinarTrayImage(win32.join(app, "bin", "cottontail.exe"), fs)).toBe(true);
	});

	test("rejects a plain bun.exe that took over a recycled PID", () => {
		const fs = layout({});
		expect(isPinarTrayImage(win32.join("C:", "Users", "me", ".bun", "bin", "bun.exe"), fs)).toBe(false);
	});

	test("rejects the Bun runtime of another Electrobun app", () => {
		const other = win32.join(localAppData, "com.example.app", "stable", "app");
		const fs = installedApp(other, JSON.stringify({ identifier: "com.example.app" }));
		expect(isPinarTrayImage(win32.join(other, "bin", "bun.exe"), fs)).toBe(false);
	});

	test("rejects a Pinar app folder without a readable version.json", () => {
		const fs = layout({ [win32.join(app, "bin", "launcher.exe")]: "" });
		expect(isPinarTrayImage(win32.join(app, "bin", "bun.exe"), fs)).toBe(false);
	});

	test("rejects an executable that is not a tray runtime", () => {
		const fs = installedApp(app, pinarVersion);
		expect(isPinarTrayImage(win32.join(app, "bin", "launcher.exe"), fs)).toBe(false);
	});
});
