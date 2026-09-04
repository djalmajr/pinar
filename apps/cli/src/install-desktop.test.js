import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { zstdCompressSync } from "node:zlib";
import {
  desktopInstallPath,
  extractWindowsTrayArchive,
  findBuiltDesktopApp,
  findBuiltWindowsApp,
  installMacDesktopApp,
  installWindowsDesktopApp,
  isRunnableWindowsApp,
  windowsBuildFolderNames,
  windowsInstallPath,
} from "./install-desktop.mjs";

describe("install-desktop", () => {
  test("desktopInstallPath is ~/Applications/Pinar.app", () => {
    assert.equal(desktopInstallPath("/tmp/home"), join("/tmp/home", "Applications", "Pinar.app"));
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
    if (process.platform !== "darwin") return;
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

  test("windowsInstallPath is %LOCALAPPDATA%\\Programs\\Pinar", () => {
    assert.equal(
      windowsInstallPath("/tmp/home", "/tmp/home/AppData/Local"),
      join("/tmp/home/AppData/Local", "Programs", "Pinar"),
    );
  });

  test("findBuiltWindowsApp prefers stable Pinar.exe", async () => {
    const source = await mkdtemp(join(tmpdir(), "pinar-win-desk-"));
    assert.equal(findBuiltWindowsApp(source), null);
    const folder = windowsBuildFolderNames("stable")[0];
    const root = join(source, "apps", "tray", "build", folder);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "Pinar.exe"), "");
    const found = findBuiltWindowsApp(source);
    assert.equal(found.root, root);
    assert.equal(found.exe, join(root, "Pinar.exe"));
  });

  test("findBuiltWindowsApp ignores the Electrobun setup stub without cottontail", async () => {
    const source = await mkdtemp(join(tmpdir(), "pinar-win-stub-"));
    const folder = windowsBuildFolderNames("stable")[0];
    const app = join(source, "apps", "tray", "build", folder, "Pinar");
    await mkdir(join(app, "bin"), { recursive: true });
    await writeFile(join(app, "bin", "launcher.exe"), "stub");
    assert.equal(isRunnableWindowsApp(app), false);
    assert.equal(findBuiltWindowsApp(source), null);
  });

  test("findBuiltWindowsApp prefers a runnable extracted app over Setup.exe", async () => {
    const source = await mkdtemp(join(tmpdir(), "pinar-win-runnable-"));
    const folder = windowsBuildFolderNames("stable")[0];
    const root = join(source, "apps", "tray", "build", folder);
    const app = join(root, "Pinar");
    await mkdir(join(app, "bin"), { recursive: true });
    await writeFile(join(app, "bin", "launcher.exe"), "launcher");
    await writeFile(join(app, "bin", "cottontail.exe"), "runtime");
    await writeFile(join(root, "Pinar-Setup.exe"), "setup");
    await writeFile(join(root, "Pinar-Setup.tar.zst"), "archive");
    const found = findBuiltWindowsApp(source);
    assert.equal(found.root, app);
    assert.equal(found.exe, join(app, "bin", "launcher.exe"));
    assert.equal(found.archive, null);
  });

  test("findBuiltWindowsApp uses Pinar-Setup.tar.zst when the app is still packed", async () => {
    const source = await mkdtemp(join(tmpdir(), "pinar-win-setup-"));
    const folder = windowsBuildFolderNames("stable")[0];
    const root = join(source, "apps", "tray", "build", folder);
    await mkdir(join(root, "Pinar", "bin"), { recursive: true });
    await writeFile(join(root, "Pinar", "bin", "launcher.exe"), "stub");
    await writeFile(join(root, "Pinar-Setup.exe"), "setup");
    await writeFile(join(root, "Pinar-Setup.tar.zst"), "archive");
    const found = findBuiltWindowsApp(source);
    assert.equal(found.root, root);
    assert.equal(found.archive, join(root, "Pinar-Setup.tar.zst"));
    assert.equal(found.exe, join(root, "Pinar-Setup.exe"));
  });

  test("extractWindowsTrayArchive unwraps the Pinar prefix", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "pinar-win-extract-"));
    const src = join(tmp, "src");
    await mkdir(join(src, "Pinar", "bin"), { recursive: true });
    await writeFile(join(src, "Pinar", "bin", "launcher.exe"), "launcher");
    await writeFile(join(src, "Pinar", "bin", "cottontail.exe"), "runtime");
    const tarPath = join(tmp, "app.tar");
    execFileSync("tar", ["-cf", tarPath, "Pinar"], { cwd: src, windowsHide: true });
    const archive = join(tmp, "app.tar.zst");
    await writeFile(archive, zstdCompressSync(await readFile(tarPath)));
    const dest = join(tmp, "dest");
    await extractWindowsTrayArchive(archive, dest);
    assert.equal(await readFile(join(dest, "bin", "launcher.exe"), "utf8"), "launcher");
    assert.equal(await readFile(join(dest, "bin", "cottontail.exe"), "utf8"), "runtime");
    assert.equal(existsSync(join(dest, "Pinar")), false);
  });

  test("installWindowsDesktopApp copies the build without opening", async () => {
    if (process.platform !== "win32") return;
    const source = await mkdtemp(join(tmpdir(), "pinar-win-src-"));
    const home = await mkdtemp(join(tmpdir(), "pinar-win-home-"));
    const localAppData = join(home, "AppData", "Local");
    const folder = windowsBuildFolderNames("dev")[0];
    const from = join(source, "apps", "tray", "build", folder);
    await mkdir(from, { recursive: true });
    await writeFile(join(from, "Pinar-dev.exe"), "exe");
    const result = await installWindowsDesktopApp({
      home,
      localAppData,
      log: () => {},
      open: false,
      source,
    });
    assert.equal(result.installed, true);
    assert.equal(result.dest, join(localAppData, "Programs", "Pinar"));
    assert.equal(result.destExe, join(result.dest, "Pinar-dev.exe"));
    assert.equal(await readFile(join(result.dest, "Pinar-dev.exe"), "utf8"), "exe");
  });
});
