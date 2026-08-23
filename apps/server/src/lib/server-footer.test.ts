import { describe, expect, test } from "bun:test";
import { footerYear } from "./server-footer";

describe("ServerFooter", () => {
  test("derives the copyright year at render time", () => {
    expect(footerYear(new Date("2026-08-22T12:00:00Z"))).toBe(2026);
  });
});
