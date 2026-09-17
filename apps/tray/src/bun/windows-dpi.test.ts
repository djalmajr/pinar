import { describe, expect, test } from "bun:test";
import { smallIconSizeFor, windowsSmallIconSize } from "./windows-dpi";

describe("windows small icon size", () => {
	test("trusts the shell metric when it is sane", () => {
		expect(smallIconSizeFor({ dpi: 144, metric: 24 })).toBe(24);
		expect(smallIconSizeFor({ dpi: 96, metric: 16 })).toBe(16);
		expect(smallIconSizeFor({ dpi: 192, metric: 32 })).toBe(32);
	});

	test("derives the size from the DPI when the metric is missing or virtualized", () => {
		expect(smallIconSizeFor({ dpi: 120 })).toBe(20);
		expect(smallIconSizeFor({ dpi: 144, metric: 0 })).toBe(24);
		expect(smallIconSizeFor({ dpi: 96 })).toBe(16);
	});

	test("never goes below 16 px", () => {
		expect(smallIconSizeFor({ dpi: 48 })).toBe(16);
		expect(smallIconSizeFor({})).toBe(16);
	});

	test("other platforms keep the 16 px default without touching FFI", async () => {
		expect(await windowsSmallIconSize("darwin")).toBe(16);
		expect(await windowsSmallIconSize("linux")).toBe(16);
	});
});
