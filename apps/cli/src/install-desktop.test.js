import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  desktopInstallPath,
  findBuiltDesktopApp,
  installMacDesktopApp,
} from "./install-desktop.mjs";

describe("install-desktop", () => {
  test("desktopInstallPath is ~/Applications/Pinar.app", () => {
    assert.equal(desktopInstallPath("/tmp/home"), "/tmp/home/Applications/Pinar.app");
  });

  test("findBuiltDesktopApp prefers stable over dev", async () => {
    const source = await mkdtemp(join(tmpdir(), "pinar-desk-"));
    assert.equal(findBuiltDesktopApp(source, "arm64"), null);
    const devRoot = join(source, "apps", "tray", "build", "dev-macos-arm64", "Pinar-dev.app");
    await mkdir(devRoot, { recursive: true });
    assert.equal(findBuiltDesktopApp(source, "arm64"), devRoot);
    const stableRoot = join(source, "apps", "tray", "build", "stable-macos-arm64", "Pinar.app");
    await mkdir(stableRoot, { recursive: true });
    assert.equal(findBuiltDesktopApp(source, "arm64"), stableRoot);
  });

  test("installMacDesktopApp copies the bundle without opening", async () => {
    const source = await mkdtemp(join(tmpdir(), "pinar-desk-src-"));
    const home = await mkdtemp(join(tmpdir(), "pinar-desk-home-"));
    const from = join(source, "apps", "tray", "build", "dev-macos-arm64", "Pinar-dev.app");
    await mkdir(join(from, "Contents", "MacOS"), { recursive: true });
    await writeFile(join(from, "Contents", "Info.plist"), "<plist/>\n");
    const result = await installMacDesktopApp({
      source,
      home,
      log: () => {},
      open: false,
    });
    assert.equal(result.installed, true);
    assert.equal(result.dest, join(home, "Applications", "Pinar.app"));
    assert.equal(await readFile(join(result.dest, "Contents", "Info.plist"), "utf8"), "<plist/>\n");
  });
});
