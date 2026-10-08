import { describe, expect, test } from "bun:test";
import {
	MEMORY_CHECK_INTERVAL_MS,
	MEMORY_RESTART_LIMIT_BYTES,
	memoryCheckInterval,
	memoryRestartLimit,
	shouldRestartForMemory,
	windowsPrivateBytes,
} from "./memory-guard";

describe("tray memory guard", () => {
	test("restarts only above the limit and never without a reading", () => {
		expect(shouldRestartForMemory(null, MEMORY_RESTART_LIMIT_BYTES)).toBe(false);
		expect(shouldRestartForMemory(MEMORY_RESTART_LIMIT_BYTES, MEMORY_RESTART_LIMIT_BYTES)).toBe(false);
		expect(shouldRestartForMemory(MEMORY_RESTART_LIMIT_BYTES + 1, MEMORY_RESTART_LIMIT_BYTES)).toBe(true);
		expect(shouldRestartForMemory(600, 500)).toBe(true);
	});

	test("uses 2 GB unless PINAR_TRAY_MEMORY_LIMIT_MB sets a positive number", () => {
		expect(MEMORY_RESTART_LIMIT_BYTES).toBe(2 * 1024 ** 3);
		expect(memoryRestartLimit({})).toBe(MEMORY_RESTART_LIMIT_BYTES);
		expect(memoryRestartLimit({ PINAR_TRAY_MEMORY_LIMIT_MB: "100" })).toBe(100 * 1024 * 1024);
		expect(memoryRestartLimit({ PINAR_TRAY_MEMORY_LIMIT_MB: "0" })).toBe(MEMORY_RESTART_LIMIT_BYTES);
		expect(memoryRestartLimit({ PINAR_TRAY_MEMORY_LIMIT_MB: "abc" })).toBe(MEMORY_RESTART_LIMIT_BYTES);
	});

	test("checks every 5 minutes unless PINAR_TRAY_MEMORY_CHECK_SECONDS sets at least 10 seconds", () => {
		expect(memoryCheckInterval({})).toBe(MEMORY_CHECK_INTERVAL_MS);
		expect(memoryCheckInterval({ PINAR_TRAY_MEMORY_CHECK_SECONDS: "30" })).toBe(30_000);
		expect(memoryCheckInterval({ PINAR_TRAY_MEMORY_CHECK_SECONDS: "5" })).toBe(MEMORY_CHECK_INTERVAL_MS);
	});

	test("reads no counter outside Windows", async () => {
		expect(await windowsPrivateBytes("darwin")).toBeNull();
		expect(await windowsPrivateBytes("linux")).toBeNull();
	});

	test.skipIf(process.platform !== "win32")("reads this process's private bytes on Windows", async () => {
		const before = await windowsPrivateBytes();
		expect(before).not.toBeNull();
		expect(before ?? 0).toBeGreaterThan(1024 * 1024);
		// A large committed allocation shows up in the private counter.
		const block = new Uint8Array(64 * 1024 * 1024).fill(1);
		const after = await windowsPrivateBytes();
		expect((after ?? 0) - (before ?? 0)).toBeGreaterThan(32 * 1024 * 1024);
		expect(block[block.length - 1]).toBe(1);
	});
});
