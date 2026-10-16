export type BeforeQuitEvent = {
	response?: { allow: boolean };
};

export function createQuitController(options: {
	quit: (code?: number) => void;
	releaseLock: () => void;
	removeTray: () => void;
	stopServer: () => Promise<void>;
	stopTimers?: () => void;
	startTimers?: () => void;
}) {
	let helperStopped = false;
	let inFlight: Promise<void> | null = null;

	async function finish() {
		if (inFlight) return inFlight;
		inFlight = (async () => {
			options.stopTimers?.();
			try {
				await options.stopServer();
			} finally {
				options.releaseLock();
				try {
					options.removeTray();
				} catch {
					// Tray may already be gone.
				}
				helperStopped = true;
				options.quit(0);
			}
		})();
		return inFlight;
	}

	/**
	 * Replaces this tray with a fresh process and leaves the local server
	 * running: the lock is released before the new tray starts so it can
	 * claim it, and the native quit is allowed without stopping the helper.
	 */
	function restart(relaunch: () => void) {
		if (inFlight) return inFlight;
		inFlight = (async () => {
			options.stopTimers?.();
			options.releaseLock();
			try {
				options.removeTray();
			} catch {
				// Tray may already be gone.
			}
			helperStopped = true;
			try {
				relaunch();
			} finally {
				options.quit(0);
			}
		})();
		return inFlight;
	}

	/**
	 * Hands the exit to the update helper: the veto lifts so the updater's
	 * before-quit passes, and a handoff that does not launch the new version
	 * restores the veto, restarts the timers and runs recover.
	 */
	function update(apply: () => Promise<boolean>, recover: () => Promise<void>): Promise<void> {
		if (inFlight) return inFlight;
		inFlight = (async () => {
			options.stopTimers?.();
			let started = false;
			try {
				await options.stopServer();
				helperStopped = true;
				started = await apply();
			} catch {
				// A server that does not stop, or a handoff that throws, is
				// recovered like a handoff that did not start.
			}
			if (!started) {
				helperStopped = false;
				inFlight = null;
				options.startTimers?.();
				await recover();
			}
		})();
		return inFlight;
	}

	function onBeforeQuit(event: BeforeQuitEvent) {
		if (helperStopped) return;
		event.response = { allow: false };
		void finish();
	}

	return { finish, onBeforeQuit, restart, update };
}
