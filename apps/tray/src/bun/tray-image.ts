import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface TrayImageOptions {
	height: number;
	image: string;
	template: boolean;
	title: string;
	width: number;
}

export function windowsAppIconPath(execPath = process.execPath) {
	return join(dirname(execPath), "..", "Resources", "app.ico");
}

/**
 * Glyph drawn for the notification area (16, 20, 24, 32 and 48 px entries,
 * see scripts/build-tray-ico.mjs). The app icon downscaled from 512 px reads
 * as a smudge at those sizes.
 */
export function windowsTrayIconPath(execPath = process.execPath) {
	return join(dirname(execPath), "..", "Resources", "app", "views", "assets", "tray-win.ico");
}

export function trayImageOptions({
	execPath = process.execPath,
	platform = process.platform,
}: {
	execPath?: string;
	platform?: NodeJS.Platform;
} = {}): TrayImageOptions {
	if (platform === "darwin") {
		return {
			height: 22,
			image: "views://assets/tray-on.pdf",
			template: true,
			title: "",
			width: 22,
		};
	}
	if (platform === "win32") {
		const trayIco = windowsTrayIconPath(execPath);
		const appIco = windowsAppIconPath(execPath);
		const image = existsSync(trayIco) ? trayIco : existsSync(appIco) ? appIco : "views://assets/tray-win.png";
		return {
			height: 16,
			image,
			template: false,
			title: "Pinar",
			width: 16,
		};
	}
	return {
		height: 16,
		image: "views://assets/tray-on.png",
		template: false,
		title: "",
		width: 16,
	};
}
