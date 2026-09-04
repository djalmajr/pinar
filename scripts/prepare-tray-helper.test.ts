import { describe, expect, test } from "bun:test";
import { helperCompilePlan, pngsToIco } from "./prepare-tray-helper.mjs";

describe("prepare-tray-helper", () => {
	test("compiles a Darwin helper named pinar", () => {
		expect(helperCompilePlan("darwin", "arm64")).toEqual({
			bunTarget: "bun-darwin-arm64",
			outfileName: "pinar",
		});
	});

	test("compiles a Windows helper named pinar.exe", () => {
		expect(helperCompilePlan("win32", "x64")).toEqual({
			bunTarget: "bun-windows-x64",
			outfileName: "pinar.exe",
		});
	});

	test("skips unknown platforms", () => {
		expect(helperCompilePlan("linux", "x64")).toBeNull();
	});

	test("pngsToIco writes an ICO header for one PNG", () => {
		const png = Buffer.alloc(24);
		png.writeUInt32BE(16, 16);
		png.writeUInt32BE(16, 20);
		const ico = pngsToIco([png]);
		expect(ico.readUInt16LE(0)).toBe(0);
		expect(ico.readUInt16LE(2)).toBe(1);
		expect(ico.readUInt16LE(4)).toBe(1);
		expect(ico.readUInt8(6)).toBe(16);
		expect(ico.readUInt32LE(18)).toBe(6 + 16);
	});
});
