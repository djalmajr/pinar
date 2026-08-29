import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { claimInstanceLock } from "./instance-lock";

function lockPath() {
	return join(mkdtempSync(join(tmpdir(), "pinar-instance-lock-")), "tray.pid");
}

describe("tray instance lock", () => {
	test("first instance claims the lock", () => {
		const path = lockPath();
		let duplicate = false;

		expect(
			claimInstanceLock(path, () => (duplicate = true), { pid: 101 }),
		).toBe(true);
		expect(readFileSync(path, "utf8")).toBe("101\n");
		expect(duplicate).toBe(false);
	});

	test("live existing instance quits the duplicate without replacing its PID", () => {
		const path = lockPath();
		writeFileSync(path, "101\n");
		let duplicate = false;

		expect(
			claimInstanceLock(path, () => (duplicate = true), {
				isProcessAlive: (pid) => pid === 101,
				pid: 202,
			}),
		).toBe(false);
		expect(readFileSync(path, "utf8")).toBe("101\n");
		expect(duplicate).toBe(true);
	});

	test("stale existing instance is replaced", () => {
		const path = lockPath();
		writeFileSync(path, "101\n");

		expect(
			claimInstanceLock(
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

	test("current instance can reclaim its own lock", () => {
		const path = lockPath();
		writeFileSync(path, "202\n");

		expect(
			claimInstanceLock(
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
