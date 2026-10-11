export type BeforeQuitEvent = {
	response?: { allow: boolean };
};

export function createQuitController(options: {
	quit: (code?: number) => void;
	releaseLock: () => void;
	removeTray: () => void;
	stopServer: () => Promise<void>;
	stopTimers?: () => void;
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
	 * Hands the quit to Electrobun's updater. `apply` asks before-quit for
	 * approval before it writes the update plan, so the veto below would cancel
	 * the update and still close the tray. The helper is stopped first (its
	 * executable lives in the folder the updater swaps), then that native quit
	 * is allowed through. `apply` resolves false when the updater did not hand
	 * off; the tray is then relaunched instead of leaving nothing running.
	 */
	function update(apply: () => Promise<boolean>, relaunch: () => void) {
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
			}
			let handedOff = false;
			try {
				handedOff = await apply();
			} finally {
				if (!handedOff) {
					try {
						relaunch();
					} finally {
						options.quit(0);
					}
				}
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
