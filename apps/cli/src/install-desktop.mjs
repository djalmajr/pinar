import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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
