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
		const ico = windowsAppIconPath(execPath);
		return {
			height: 16,
			image: existsSync(ico) ? ico : "views://assets/tray-win.png",
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
