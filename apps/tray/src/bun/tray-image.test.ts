import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { trayImageOptions, windowsAppIconPath } from "./tray-image";

describe("tray image", () => {
	test("macOS uses the template PDF", () => {
		expect(trayImageOptions({ platform: "darwin" })).toEqual({
			height: 22,
			image: "views://assets/tray-on.pdf",
			template: true,
			title: "",
			width: 22,
		});
	});

	test("Windows prefers the packaged app.ico next to the launcher", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-tray-ico-"));
		mkdirSync(join(root, "Resources"), { recursive: true });
		const ico = join(root, "Resources", "app.ico");
		writeFileSync(ico, "ico");
		const execPath = join(root, "bin", "launcher.exe");
		expect(windowsAppIconPath(execPath)).toBe(ico);
		expect(trayImageOptions({ execPath, platform: "win32" })).toEqual({
			height: 16,
			image: ico,
			template: false,
			title: "Pinar",
			width: 16,
		});
	});

	test("Windows falls back to the colored PNG when app.ico is missing", () => {
		const execPath = join(tmpdir(), "missing-pinar", "bin", "launcher.exe");
		expect(trayImageOptions({ execPath, platform: "win32" })).toEqual({
			height: 16,
			image: "views://assets/tray-win.png",
			template: false,
			title: "Pinar",
			width: 16,
		});
	});

	test("Linux keeps the outline PNG", () => {
		expect(trayImageOptions({ platform: "linux" })).toEqual({
			height: 16,
			image: "views://assets/tray-on.png",
			template: false,
			title: "",
			width: 16,
		});
	});
});
