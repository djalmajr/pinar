import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	isPinarWindowsExe,
	loginExePath,
	parseRegQueryHasValue,
	runningWindowsLauncher,
	shouldConfigureDefaultLogin,
	windowsRunAddArgs,
	windowsRunDeleteArgs,
	WINDOWS_RUN_VALUE,
} from "./login";

describe("default login configuration", () => {
	test("configures login on first run", () => {
		expect(shouldConfigureDefaultLogin({}, false)).toBe(true);
	});

	test("does not reload an existing enabled login agent", () => {
		expect(
			shouldConfigureDefaultLogin(
				{ loginConfigured: true, loginEnabled: true },
				true,
			),
		).toBe(false);
	});

	test("repairs a missing enabled login agent", () => {
		expect(
			shouldConfigureDefaultLogin(
				{ loginConfigured: true, loginEnabled: true },
				false,
			),
		).toBe(true);
	});

	test("leaves explicitly disabled login alone", () => {
		expect(
			shouldConfigureDefaultLogin(
				{ loginConfigured: true, loginEnabled: false },
				false,
			),
		).toBe(false);
	});

	test("Windows Run args write and delete the Pinar value", () => {
		const add = windowsRunAddArgs("C:\\Users\\me\\AppData\\Local\\Programs\\Pinar\\Pinar.exe");
		expect(add).toContain(WINDOWS_RUN_VALUE);
		expect(add.at(-2)).toBe("C:\\Users\\me\\AppData\\Local\\Programs\\Pinar\\Pinar.exe");
		expect(windowsRunDeleteArgs()).toContain(WINDOWS_RUN_VALUE);
	});

	test("parseRegQueryHasValue detects the Pinar run entry", () => {
		expect(parseRegQueryHasValue("    Pinar    REG_SZ    C:\\Pinar.exe\r\n")).toBe(true);
		expect(parseRegQueryHasValue("    OneDrive    REG_SZ    C:\\OneDrive.exe\r\n")).toBe(false);
	});

	test("isPinarWindowsExe accepts launcher.exe only under Pinar/bin", () => {
		expect(isPinarWindowsExe("C:\\Users\\me\\AppData\\Local\\Programs\\Pinar\\bin\\launcher.exe")).toBe(true);
		expect(isPinarWindowsExe("C:\\Windows\\System32\\launcher.exe")).toBe(false);
		expect(isPinarWindowsExe("C:\\Users\\me\\.cargo\\bin\\bun.exe")).toBe(false);
		expect(isPinarWindowsExe("C:\\Users\\me\\AppData\\Local\\Programs\\Pinar\\Pinar.exe")).toBe(true);
	});
});

describe("running Windows launcher", () => {
	test("runningWindowsLauncher finds launcher.exe next to cottontail.exe", () => {
		const bin = join(mkdtempSync(join(tmpdir(), "pinar-setup-launcher-")), "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "launcher.exe"), "");
		writeFileSync(join(bin, "cottontail.exe"), "");
		expect(runningWindowsLauncher(join(bin, "cottontail.exe"))).toBe(join(bin, "launcher.exe"));
	});

	test("runningWindowsLauncher is null without cottontail.exe", () => {
		const bin = join(mkdtempSync(join(tmpdir(), "pinar-setup-launcher-")), "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "launcher.exe"), "");
		expect(runningWindowsLauncher(join(bin, "launcher.exe"))).toBeNull();
	});

	test("runningWindowsLauncher is null without launcher.exe", () => {
		const bin = join(mkdtempSync(join(tmpdir(), "pinar-setup-launcher-")), "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "cottontail.exe"), "");
		expect(runningWindowsLauncher(join(bin, "cottontail.exe"))).toBeNull();
	});

	test("loginExePath prefers the running Setup launcher over an installed app", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-setup-login-"));
		const bin = join(root, "app", "bin");
		mkdirSync(bin, { recursive: true });
		writeFileSync(join(bin, "launcher.exe"), "");
		writeFileSync(join(bin, "cottontail.exe"), "");
		const installed = join(root, "local", "Programs", "Pinar");
		mkdirSync(join(installed, "bin"), { recursive: true });
		writeFileSync(join(installed, "bin", "launcher.exe"), "");
		writeFileSync(join(installed, "bin", "cottontail.exe"), "");
		const previous = process.env.LOCALAPPDATA;
		process.env.LOCALAPPDATA = join(root, "local");
		try {
			expect(loginExePath(join(bin, "cottontail.exe"))).toBe(join(bin, "launcher.exe"));
		} finally {
			if (previous == null) delete process.env.LOCALAPPDATA;
			else process.env.LOCALAPPDATA = previous;
		}
	});
});
