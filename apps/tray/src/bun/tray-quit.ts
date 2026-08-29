export type BeforeQuitEvent = {
	response?: { allow: boolean };
};

export function createQuitController(options: {
	quit: (code?: number) => void;
	releaseLock: () => void;
	removeTray: () => void;
	stopServer: () => Promise<void>;
}) {
	let helperStopped = false;
	let inFlight: Promise<void> | null = null;

	async function finish() {
		if (inFlight) return inFlight;
		inFlight = (async () => {
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

	function onBeforeQuit(event: BeforeQuitEvent) {
		if (helperStopped) return;
		event.response = { allow: false };
		void finish();
	}

	return { finish, onBeforeQuit };
}
