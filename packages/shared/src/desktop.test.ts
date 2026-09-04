import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  LINUX_HELPER_INSTALL_URL,
  freeInstallUrl,
  macosDesktopDmgUrl,
  windowsDesktopSetupUrl,
} from "./desktop.js";

describe("desktop install URLs", () => {
  test("macOS defaults to the published DMG name", () => {
    assert.equal(
      macosDesktopDmgUrl(),
      "https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg",
    );
    assert.equal(freeInstallUrl(), macosDesktopDmgUrl());
    assert.equal(
      freeInstallUrl("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
      macosDesktopDmgUrl(),
    );
  });

  test("Windows uses the tray setup exe and Linux keeps the helper installer", () => {
    assert.equal(
      windowsDesktopSetupUrl(),
      "https://github.com/djalmajr/pinar/releases/latest/download/win-x64-Pinar-Setup.zip",
    );
    assert.equal(
      freeInstallUrl("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
      windowsDesktopSetupUrl(),
    );
    assert.equal(freeInstallUrl("Mozilla/5.0 (X11; Linux x86_64)"), LINUX_HELPER_INSTALL_URL);
  });
});
