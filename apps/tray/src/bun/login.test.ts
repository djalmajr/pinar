import { describe, expect, test } from "bun:test";
import { shouldConfigureDefaultLogin } from "./login";

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
});
