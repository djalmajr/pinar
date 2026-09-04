import { describe, expect, test } from "bun:test";
import {
	isPinarWindowsExe,
	parseRegQueryHasValue,
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
