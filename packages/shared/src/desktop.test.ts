import { describe, expect, test } from "bun:test";
import {
  LINUX_HELPER_INSTALL_URL,
  WINDOWS_HELPER_INSTALL_URL,
  freeInstallUrl,
  macosDesktopDmgUrl,
} from "./desktop.js";

describe("desktop install URLs", () => {
  test("macOS defaults to the published DMG name", () => {
    expect(macosDesktopDmgUrl()).toBe(
      "https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg",
    );
    expect(freeInstallUrl()).toBe(macosDesktopDmgUrl());
    expect(freeInstallUrl("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(macosDesktopDmgUrl());
  });

  test("Windows and Linux keep the helper installers until a tray exists", () => {
    expect(freeInstallUrl("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(WINDOWS_HELPER_INSTALL_URL);
    expect(freeInstallUrl("Mozilla/5.0 (X11; Linux x86_64)")).toBe(LINUX_HELPER_INSTALL_URL);
  });
});
