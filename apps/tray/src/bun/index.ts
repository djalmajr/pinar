import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Electrobun, { Tray, Updater, Utils } from "electrobun/main";
import { claimInstanceLock } from "./instance-lock";
import {
	ensureDefaultLogin,
	isServerLoginEnabled,
	setServerLoginEnabled,
} from "./login";
import {
	ensurePinarHome,
	findHealthyPort,
	installBundledHooks,
	pinarHome,
	restartServer,
	startServer,
	stopServer,
	waitUntilHealthy,
	workspaceUrl,
} from "./local-server";
import { trayMenuLabels } from "./menu-labels";
import { trayImageOptions } from "./tray-image";
import { windowsSmallIconSize } from "./windows-dpi";
import { createQuitController } from "./tray-quit";
import {
	UPDATE_STATUS_DURATION_MS,
	idleUpdateUi,
	shouldOfferUpdate,
	updateMenuItem,
	type UpdateUiState,
	versionMenuItem,
} from "./update";

function trayPidPath() {
	return join(pinarHome(), "tray.pid");
}

function releaseTrayLock() {
	try {
		const path = trayPidPath();
		if (!existsSync(path)) return;
		const existing = Number(readFileSync(path, "utf8").trim());
		if (existing === process.pid) unlinkSync(path);
	} catch {
		// Best-effort cleanup on quit.
	}
}

function hideDock() {
	if (process.platform !== "darwin") return;
	Utils.setDockIconVisible(false);
}

ensurePinarHome();
hideDock();
let handledInitialReopen = false;
Electrobun.events.on("reopen", () => {
	if (handledInitialReopen) return;
	handledInitialReopen = true;
	hideDock();
});
const ownsTrayLock = await claimInstanceLock(trayPidPath(), (existingPid) => {
	console.error(`pinar tray already running with PID ${existingPid}; refusing duplicate startup`);
	Utils.quit(0);
});
if (!ownsTrayLock) {
	// Keep Cottontail idle while the native runtime completes Utils.quit().
	await new Promise<never>(() => {});
}

const tray = new Tray(trayImageOptions({ smallIconSize: await windowsSmallIconSize() }));

let online = false;
let loginEnabled = false;
let busy = false;
let updateUi: UpdateUiState = idleUpdateUi();
let statusResetTimer: ReturnType<typeof setTimeout> | null = null;
let lastMenu = "";
let loginCheckedAt = 0;
let refreshing: Promise<number | null> | null = null;

// The server state is polled often; the Run key (reg.exe on Windows) and the
// login agent change only through this menu, so they are re-read rarely.
const REFRESH_INTERVAL_MS = 2000;
const LOGIN_RECHECK_MS = 60_000;

function stopStatusResetTimer() {
	if (!statusResetTimer) return;
	clearTimeout(statusResetTimer);
	statusResetTimer = null;
}

function scheduleStatusReset() {
	stopStatusResetTimer();
	statusResetTimer = setTimeout(() => {
		statusResetTimer = null;
		updateUi = idleUpdateUi();
		updateMenu();
	}, UPDATE_STATUS_DURATION_MS);
}

function showTransientStatus(status: "failed" | "updated") {
	updateUi = {
		...idleUpdateUi(),
		failed: status === "failed",
		updated: status === "updated",
	};
	scheduleStatusReset();
}

function updateMenu() {
	const labels = trayMenuLabels();
	const items: Parameters<typeof tray.setMenu>[0] = [
		versionMenuItem(),
		{
			enabled: false,
			label: online ? labels.localServerOn : labels.localServerOff,
			type: "normal",
		},
		{
			action: "login",
			checked: loginEnabled,
			enabled: (process.platform === "darwin" || process.platform === "win32") && !busy,
			label: labels.login,
			type: "normal",
		},
		{ type: "divider" },
		{
			action: "start",
			enabled: !busy,
			label: online ? labels.restart : labels.start,
			type: "normal",
		},
		{ action: "stop", enabled: !busy && online, label: labels.stop, type: "normal" },
		{ type: "divider" },
		{
			action: "open",
			enabled: online,
			label: labels.openWorkspace,
			type: "normal",
		},
		{ action: "folder", label: labels.folder, type: "normal" },
		{ type: "divider" },
		updateMenuItem(updateUi, labels),
		{ type: "divider" },
		{ action: "quit", label: labels.quit, type: "normal" },
	];
	// Rebuilding the native menu on every poll is what the tray did forever;
	// only hand it to Electrobun when something visible changed.
	const key = JSON.stringify(items);
	if (key === lastMenu) return;
	lastMenu = key;
	tray.setMenu(items);
}

async function syncUpdate() {
	if (updateUi.checking) return;
	stopStatusResetTimer();
	updateUi = { ...idleUpdateUi(), checking: true };
	updateMenu();
	try {
		const info = await Updater.checkForUpdate();
		const local = await Updater.getLocalInfo();
		const available = shouldOfferUpdate({
			localHash: local.hash,
			localVersion: local.version,
			remoteHash: info.hash,
			remoteVersion: info.version,
		});
		if (!available) {
			showTransientStatus("updated");
			updateMenu();
			return;
		}
		updateUi = {
			...idleUpdateUi(),
			available: true,
			checking: !info.updateReady,
			ready: info.updateReady,
			version: info.version,
		};
		updateMenu();
		if (!info.updateReady) {
			await Updater.downloadUpdate();
			const ready = Updater.updateInfo();
			const stillAvailable = shouldOfferUpdate({
				localHash: local.hash,
				localVersion: local.version,
				remoteHash: ready.hash,
				remoteVersion: ready.version,
			});
			if (!stillAvailable) {
				showTransientStatus("updated");
			} else {
				updateUi = {
					...idleUpdateUi(),
					available: true,
					ready: ready.updateReady,
					version: ready.version,
				};
			}
		}
	} catch (error) {
		console.error("pinar tray update check failed", error);
		showTransientStatus("failed");
	}
	updateMenu();
}

async function refreshOnce(checkLogin: boolean) {
	ensurePinarHome();
	const port = await findHealthyPort();
	online = port != null;
	if (checkLogin || Date.now() - loginCheckedAt >= LOGIN_RECHECK_MS) {
		loginEnabled = await isServerLoginEnabled();
		loginCheckedAt = Date.now();
	}
	updateMenu();
	return port;
}

/** One refresh at a time: a slow poll never stacks up behind the interval. */
function refresh({ checkLogin = false } = {}) {
	if (refreshing && !checkLogin) return refreshing;
	const previous = refreshing ?? Promise.resolve(null);
	const current: Promise<number | null> = previous
		.catch(() => null)
		.then(() => refreshOnce(checkLogin))
		.finally(() => {
			if (refreshing === current) refreshing = null;
		});
	refreshing = current;
	return current;
}

async function withBusy(work: () => Promise<void>) {
	if (busy) return;
	busy = true;
	updateMenu();
	try {
		await work();
	} finally {
		busy = false;
		await refresh({ checkLogin: true });
	}
}

updateMenu();
void ensureDefaultLogin()
	.then(async () => {
		installBundledHooks();
		await refresh({ checkLogin: true });
		if (!online) {
			startServer();
			await waitUntilHealthy();
			await refresh();
		}
	})
	.catch((error) => {
		console.error("pinar tray login setup failed", error);
		return refresh();
	});
const refreshTimer = setInterval(() => {
	void refresh();
}, REFRESH_INTERVAL_MS);
void syncUpdate();
const updateTimer = setInterval(
	() => {
		void syncUpdate();
	},
	6 * 60 * 60 * 1000,
);

const quit = createQuitController({
	quit: (code) => {
		Utils.quit(code ?? 0);
	},
	releaseLock: () => {
		stopStatusResetTimer();
		releaseTrayLock();
	},
	removeTray: () => tray.remove(),
	// Live timers keep the event loop busy, and Electrobun's graceful quit
	// then waits for its whole timeout before forcing the exit.
	stopTimers: () => {
		clearInterval(refreshTimer);
		clearInterval(updateTimer);
		stopStatusResetTimer();
	},
	stopServer,
});
Electrobun.events.on("before-quit", quit.onBeforeQuit);

console.error("pinar tray started");

tray.on("tray-clicked", (event: unknown) => {
	const action = (event as { data?: { action?: string } }).data?.action;
	if (action === "start") {
		void withBusy(async () => {
			if (online) await restartServer();
			else {
				startServer();
				await waitUntilHealthy();
			}
		});
		return;
	}
	if (action === "stop") {
		void withBusy(() => stopServer());
		return;
	}
	if (action === "open") {
		void refresh().then((port) => {
			if (port != null) Utils.openExternal(workspaceUrl(port));
		});
		return;
	}
	if (action === "folder") {
		Utils.openPath(ensurePinarHome());
		return;
	}
	if (action === "login") {
		void withBusy(async () => {
			await setServerLoginEnabled(!loginEnabled);
		});
		return;
	}
	if (action === "check-update") {
		void syncUpdate();
		return;
	}
	if (action === "apply-update") {
		void Updater.applyUpdate();
		return;
	}
	if (action === "quit") {
		void quit.finish();
	}
});
