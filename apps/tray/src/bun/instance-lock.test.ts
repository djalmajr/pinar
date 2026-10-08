import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { claimInstanceLock, processIsAlive } from "./instance-lock";

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
