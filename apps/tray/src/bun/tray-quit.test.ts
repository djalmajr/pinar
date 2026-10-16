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

	test("update stops the timers and the server before apply and lifts the veto", async () => {
		const events: string[] = [];
		let resolveApply: (started: boolean) => void = () => {};
		const applyStarted = new Promise<boolean>((resolve) => {
			resolveApply = resolve;
		});
		const quit = createQuitController({
			stopServer: async () => {
				events.push("stop");
			},
			releaseLock: () => events.push("unlock"),
			removeTray: () => events.push("remove"),
			stopTimers: () => events.push("timers"),
			startTimers: () => events.push("start"),
			quit: () => events.push("quit"),
		});
		const done = quit.update(
			async () => {
				events.push("apply");
				return applyStarted;
			},
			async () => {
				events.push("recover");
			},
		);
		// Give the handoff a turn so apply is running before the veto is probed.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(events).toEqual(["timers", "stop", "apply"]);
		const event = {};
		quit.onBeforeQuit(event);
		expect(event).toEqual({});
		resolveApply(true);
		await done;
		// A launched handoff leaves the lock, the tray and the exit to the updater.
		expect(events).toEqual(["timers", "stop", "apply"]);
	});

	test("a handoff that does not start restores the veto and recovers", async () => {
		const events: string[] = [];
		let resolveApply: (started: boolean) => void = () => {};
		const applyStarted = new Promise<boolean>((resolve) => {
			resolveApply = resolve;
		});
		const quit = createQuitController({
			stopServer: async () => {
				events.push("stop");
			},
			releaseLock: () => events.push("unlock"),
			removeTray: () => events.push("remove"),
			stopTimers: () => events.push("timers"),
			startTimers: () => events.push("start"),
			quit: () => events.push("quit"),
		});
		const done = quit.update(
			async () => {
				events.push("apply");
				return applyStarted;
			},
			async () => {
				events.push("recover");
			},
		);
		resolveApply(false);
		await done;
		// The veto is back, the timers restart and recover runs last.
		expect(events).toEqual(["timers", "stop", "apply", "start", "recover"]);
		const event = {};
		quit.onBeforeQuit(event);
		expect(event).toEqual({ response: { allow: false } });
		await quit.finish();
		expect(events).toEqual([
			"timers",
			"stop",
			"apply",
			"start",
			"recover",
			"timers",
			"stop",
			"unlock",
			"remove",
			"quit",
		]);
	});

	test("a handoff that throws recovers like a failed one", async () => {
		const events: string[] = [];
		const quit = createQuitController({
			stopServer: async () => {
				events.push("stop");
			},
			releaseLock: () => events.push("unlock"),
			removeTray: () => events.push("remove"),
			stopTimers: () => events.push("timers"),
			startTimers: () => events.push("start"),
			quit: () => events.push("quit"),
		});
		await quit.update(
			async () => {
				events.push("apply");
				throw new Error("handoff failed");
			},
			async () => {
				events.push("recover");
			},
		);
		expect(events).toEqual(["timers", "stop", "apply", "start", "recover"]);
		const event = {};
		quit.onBeforeQuit(event);
		expect(event).toEqual({ response: { allow: false } });
		await quit.finish();
		expect(events).toEqual([
			"timers",
			"stop",
			"apply",
			"start",
			"recover",
			"timers",
			"stop",
			"unlock",
			"remove",
			"quit",
		]);
	});

	test("a server that does not stop recovers without starting the handoff", async () => {
		const events: string[] = [];
		let stopFails = true;
		const quit = createQuitController({
			stopServer: async () => {
				events.push("stop");
				if (stopFails) {
					stopFails = false;
					throw new Error("server still running");
				}
			},
			releaseLock: () => events.push("unlock"),
			removeTray: () => events.push("remove"),
			stopTimers: () => events.push("timers"),
			startTimers: () => events.push("start"),
			quit: () => events.push("quit"),
		});
		await quit.update(
			async () => {
				events.push("apply");
				return true;
			},
			async () => {
				events.push("recover");
			},
		);
		expect(events).toEqual(["timers", "stop", "start", "recover"]);
		const event = {};
		quit.onBeforeQuit(event);
		expect(event).toEqual({ response: { allow: false } });
	});

	test("update shares its in-flight promise and runs apply once", async () => {
		let applies = 0;
		let resolveApply: () => void = () => {};
		const applyStarted = new Promise<void>((resolve) => {
			resolveApply = resolve;
		});
		const quit = createQuitController({
			stopServer: async () => {},
			releaseLock: () => {},
			removeTray: () => {},
			quit: () => {},
		});
		const first = quit.update(
			async () => {
				applies += 1;
				await applyStarted;
				return true;
			},
			async () => {},
		);
		const second = quit.update(
			async () => {
				applies += 1;
				return true;
			},
			async () => {},
		);
		expect(second).toBe(first);
		resolveApply();
		await first;
		expect(applies).toBe(1);
	});

	test("update does not start a handoff while a finish is in flight", async () => {
		let applyCalls = 0;
		let resolveStop: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			resolveStop = resolve;
		});
		const quit = createQuitController({
			stopServer: async () => {
				await stopped;
			},
			releaseLock: () => {},
			removeTray: () => {},
			quit: () => {},
		});
		const first = quit.finish();
		const second = quit.update(
			async () => {
				applyCalls += 1;
				return true;
			},
			async () => {},
		);
		expect(applyCalls).toBe(0);
		resolveStop();
		await first;
		await second;
		expect(applyCalls).toBe(0);
	});
});
