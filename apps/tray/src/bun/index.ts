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
import { createQuitController } from "./tray-quit";
import {
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
const ownsTrayLock = claimInstanceLock(trayPidPath(), () => Utils.quit(0));
if (!ownsTrayLock) {
	// Keep Cottontail idle while the native runtime completes Utils.quit().
	await new Promise<never>(() => {});
}

const tray = new Tray(trayImageOptions());

let online = false;
let loginEnabled = false;
let busy = false;
let updateUi: UpdateUiState = {
	available: false,
	checking: false,
	ready: false,
	version: "",
};

function updateMenu() {
	const labels = trayMenuLabels();
	tray.setMenu([
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
	]);
}

async function syncUpdate() {
	if (updateUi.checking) return;
	updateUi = { ...updateUi, checking: true };
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
			updateUi = {
				available: false,
				checking: false,
				ready: false,
				version: "",
			};
		} else {
			updateUi = {
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
				updateUi = {
					available: stillAvailable,
					checking: false,
					ready: stillAvailable && ready.updateReady,
					version: stillAvailable ? ready.version : "",
				};
			} else {
				updateUi = { ...updateUi, checking: false };
			}
		}
	} catch (error) {
		console.error("pinar tray update check failed", error);
		updateUi = { available: false, checking: false, ready: false, version: "" };
	}
	updateMenu();
}

async function refresh() {
	ensurePinarHome();
	const port = await findHealthyPort();
	online = port != null;
	loginEnabled = await isServerLoginEnabled();
	updateMenu();
	return port;
}

async function withBusy(work: () => Promise<void>) {
	if (busy) return;
	busy = true;
	updateMenu();
	try {
		await work();
	} finally {
		busy = false;
		await refresh();
	}
}

updateMenu();
void ensureDefaultLogin()
	.then(async () => {
		installBundledHooks();
		await refresh();
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
setInterval(() => {
	void refresh();
}, 2000);
void syncUpdate();
setInterval(
	() => {
		void syncUpdate();
	},
	6 * 60 * 60 * 1000,
);

const quit = createQuitController({
	quit: (code) => {
		Utils.quit(code ?? 0);
	},
	releaseLock: releaseTrayLock,
	removeTray: () => tray.remove(),
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
