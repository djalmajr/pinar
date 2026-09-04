import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { zstdDecompressSync } from "node:zlib";

export function desktopInstallPath(home = homedir()) {
  return join(home, "Applications", "Pinar.app");
}

export function macosCpu(arch = process.arch) {
  return arch === "arm64" ? "arm64" : "x64";
}

export function findBuiltDesktopApp(source, arch = process.arch) {
  const cpu = macosCpu(arch);
  for (const env of ["stable", "canary", "dev"]) {
    const root = join(source, "apps", "tray", "build", `${env}-macos-${cpu}`);
    const stable = join(root, "Pinar.app");
    if (existsSync(stable)) return stable;
    const dev = join(root, "Pinar-dev.app");
    if (existsSync(dev)) return dev;
  }
  return null;
}

export async function installMacDesktopApp({
  source,
  home = homedir(),
  log = console.error,
  open = true,
} = {}) {
  if (process.platform !== "darwin") return { installed: false, reason: "not-darwin" };
  const from = findBuiltDesktopApp(source);
  if (!from) {
    log("pinar desktop app not built (apps/tray). Skipping macOS app copy.");
    return { installed: false, reason: "missing-build" };
  }
  const dest = desktopInstallPath(home);
  await mkdir(join(home, "Applications"), { recursive: true });
  await rm(dest, { recursive: true, force: true });
  await cp(from, dest, { recursive: true, force: true });
  log(`pinar desktop -> ${dest}`);
  if (open) {
    const child = spawn("open", ["-ga", dest], { detached: true, stdio: "ignore" });
    child.unref();
  }
  return { installed: true, dest, from };
}

export function windowsInstallPath(home = homedir(), localAppData = process.env.LOCALAPPDATA) {
  const base = localAppData || join(home, "AppData", "Local");
  return join(base, "Programs", "Pinar");
}

export function windowsBuildFolderNames(env, arch = "x64") {
  return [`${env}-win-${arch}`, `${env}-windows-${arch}`, `${env}-win32-${arch}`];
}

export function isRunnableWindowsApp(root) {
  return existsSync(join(root, "bin", "launcher.exe")) && existsSync(join(root, "bin", "cottontail.exe"));
}

export function windowsTrayExe(root) {
  return join(root, "bin", "launcher.exe");
}

export async function extractWindowsTrayArchive(archive, dest) {
  const staging = `${dest}.pinar-extract`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const tarPath = join(staging, "app.tar");
  try {
    await writeFile(tarPath, zstdDecompressSync(await readFile(archive)));
    execFileSync("tar", ["-xf", tarPath, "-C", staging], { windowsHide: true });
    await rm(tarPath, { force: true });
    const nested = join(staging, "Pinar");
    const from = isRunnableWindowsApp(nested) ? nested : staging;
    if (!isRunnableWindowsApp(from)) {
      throw new Error(`pinar tray archive is missing launcher.exe and cottontail.exe: ${archive}`);
    }
    await rm(dest, { recursive: true, force: true });
    await mkdir(join(dest, ".."), { recursive: true });
    await cp(from, dest, { recursive: true, force: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function findBuiltWindowsApp(source) {
  for (const env of ["stable", "canary", "dev"]) {
    for (const folder of windowsBuildFolderNames(env)) {
      const root = join(source, "apps", "tray", "build", folder);
      const extracted = join(root, "Pinar");
      if (isRunnableWindowsApp(extracted)) {
        return { archive: null, exe: windowsTrayExe(extracted), root: extracted };
      }
      if (isRunnableWindowsApp(root)) {
        return { archive: null, exe: windowsTrayExe(root), root };
      }
      const setupTar = join(root, "Pinar-Setup.tar.zst");
      if (existsSync(setupTar)) {
        return { archive: setupTar, exe: join(root, "Pinar-Setup.exe"), root };
      }
      for (const name of ["Pinar.exe", "Pinar-dev.exe"]) {
        const exe = join(root, name);
        if (existsSync(exe)) return { archive: null, exe, root };
      }
    }
  }
  return null;
}

export async function installWindowsDesktopApp({
  home = homedir(),
  localAppData = process.env.LOCALAPPDATA,
  log = console.error,
  open = true,
  source,
} = {}) {
  if (process.platform !== "win32") return { installed: false, reason: "not-win32" };
  const built = findBuiltWindowsApp(source);
  if (!built) {
    log("pinar desktop app not built (apps/tray). Skipping Windows app copy.");
    return { installed: false, reason: "missing-build" };
  }
  const dest = windowsInstallPath(home, localAppData);
  await mkdir(join(dest, ".."), { recursive: true });
  let destExe;
  if (built.archive) {
    log(`pinar desktop extracting ${built.archive}`);
    await extractWindowsTrayArchive(built.archive, dest);
    destExe = windowsTrayExe(dest);
  } else {
    await rm(dest, { recursive: true, force: true });
    await cp(built.root, dest, { recursive: true, force: true });
    destExe = join(dest, relative(built.root, built.exe));
  }
  log(`pinar desktop -> ${destExe}`);
  if (open) {
    if (!existsSync(destExe)) throw new Error(`pinar desktop executable missing: ${destExe}`);
    const child = spawn(destExe, [], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  }
  return { dest, destExe, from: built.archive ?? built.root, installed: true };
}
