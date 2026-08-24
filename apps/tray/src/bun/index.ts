import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Tray, Updater, Utils } from "electrobun/main";
import { ensureDefaultLogin, isServerLoginEnabled, setServerLoginEnabled } from "./login";
import {
	findHealthyPort,
	pinarHome,
	restartServer,
	startServer,
	stopServer,
	waitUntilHealthy,
	workspaceUrl,
} from "./local-server";
import { updateMenuItem, type UpdateUiState } from "./update";

function trayPidPath() {
	return join(pinarHome(), "tray.pid");
}

function claimTrayLock() {
	const path = trayPidPath();
	try {
		const existing = Number(readFileSync(path, "utf8").trim());
		if (Number.isInteger(existing) && existing > 0 && existing !== process.pid) {
			try {
				process.kill(existing, 0);
				process.exit(0);
			} catch {
				// Stale lock from a previous tray.
			}
		}
	} catch {
		// Missing lock is the first instance.
	}
	writeFileSync(path, `${process.pid}\n`);
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

claimTrayLock();
Utils.setDockIconVisible(false);

const tray = new Tray({
	height: 22,
	image: "views://assets/tray-on.pdf",
	template: true,
	title: "",
	width: 22,
});

let online = false;
let loginEnabled = false;
let busy = false;
let updateUi: UpdateUiState = { available: false, checking: false, ready: false, version: "" };

function updateMenu() {
	const status = online ? "Local Server: On" : "Local Server: Off";
	tray.setMenu([
		{ enabled: false, label: status, type: "normal" },
		{
			action: "login",
			checked: loginEnabled,
			enabled: process.platform === "darwin" && !busy,
			label: "Start at Login",
			type: "normal",
		},
		{ type: "divider" },
		{ action: "start", enabled: !busy, label: online ? "Restart" : "Start", type: "normal" },
		{ action: "stop", enabled: !busy && online, label: "Stop", type: "normal" },
		{ type: "divider" },
		{ action: "open", enabled: online, label: "Open Workspace", type: "normal" },
		{ action: "folder", label: "Open Folder", type: "normal" },
		{ type: "divider" },
		updateMenuItem(updateUi),
		{ type: "divider" },
		{ action: "quit", label: "Quit", type: "normal" },
	]);
}

async function syncUpdate() {
	if (updateUi.checking) return;
	updateUi = { ...updateUi, checking: true };
	updateMenu();
	try {
		const info = await Updater.checkForUpdate();
		updateUi = {
			available: info.updateAvailable,
			checking: info.updateAvailable && !info.updateReady,
			ready: info.updateReady,
			version: info.version,
		};
		updateMenu();
		if (info.updateAvailable && !info.updateReady) {
			await Updater.downloadUpdate();
			const ready = Updater.updateInfo();
			updateUi = {
				available: ready.updateAvailable,
				checking: false,
				ready: ready.updateReady,
				version: ready.version,
			};
		} else {
			updateUi = { ...updateUi, checking: false };
		}
	} catch (error) {
		console.error("pinar tray update check failed", error);
		updateUi = { available: false, checking: false, ready: false, version: "" };
	}
	updateMenu();
}

async function refresh() {
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
	.then(() => refresh())
	.catch((error) => {
		console.error("pinar tray login setup failed", error);
		return refresh();
	});
setInterval(() => {
	void refresh();
}, 2000);
void syncUpdate();
setInterval(() => {
	void syncUpdate();
}, 6 * 60 * 60 * 1000);

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
		Utils.openPath(pinarHome());
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
		void (async () => {
			await stopServer();
			releaseTrayLock();
			tray.remove();
			process.exit(0);
		})();
	}
});
