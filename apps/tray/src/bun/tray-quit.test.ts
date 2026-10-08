import { describe, expect, test } from "bun:test";
import { createQuitController } from "./tray-quit";

describe("tray quit", () => {
	test("vetoes before-quit until the helper has been stopped", async () => {
		const events: string[] = [];
		let resolveStop: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			resolveStop = resolve;
		});
		const quit = createQuitController({
			stopServer: async () => {
				events.push("stop");
				await stopped;
			},
			releaseLock: () => events.push("unlock"),
			removeTray: () => events.push("remove"),
			stopTimers: () => events.push("timers"),
			quit: () => events.push("quit"),
		});
		const first = {};
		quit.onBeforeQuit(first);
		expect(first).toEqual({ response: { allow: false } });
		// Timers stop first, so the native graceful quit does not wait on them.
		expect(events).toEqual(["timers", "stop"]);
		resolveStop();
		await quit.finish();
		expect(events).toEqual(["timers", "stop", "unlock", "remove", "quit"]);
		const second = {};
		quit.onBeforeQuit(second);
		expect(second).toEqual({});
	});

	test("menu quit shares the in-flight stop with before-quit", async () => {
		let stops = 0;
		let resolveStop: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			resolveStop = resolve;
		});
		const quit = createQuitController({
			stopServer: async () => {
				stops += 1;
				await stopped;
			},
			releaseLock: () => {},
			removeTray: () => {},
			quit: () => {},
		});
		const first = quit.finish();
		const event = {};
		quit.onBeforeQuit(event);
		expect(stops).toBe(1);
		expect(event).toEqual({ response: { allow: false } });
		resolveStop();
		await first;
		expect(stops).toBe(1);
	});

	test("restart relaunches without stopping the server and lets the native quit through", async () => {
		const events: string[] = [];
		const quit = createQuitController({
			stopServer: async () => {
				events.push("stop");
			},
			releaseLock: () => events.push("unlock"),
			removeTray: () => events.push("remove"),
			stopTimers: () => events.push("timers"),
			quit: () => events.push("quit"),
		});
		await quit.restart(() => events.push("relaunch"));
		expect(events).toEqual(["timers", "unlock", "remove", "relaunch", "quit"]);
		const event = {};
		quit.onBeforeQuit(event);
		expect(event).toEqual({});
		expect(events).not.toContain("stop");
	});
});
