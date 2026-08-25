import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defaultRoot, installHooks } from "./install-hooks.mjs";
import { installMacDesktopApp } from "./install-desktop.mjs";
import { pinarHome } from "./paths.mjs";

export const RUNTIME_SCRIPTS = [
  ["apps/cli/src/cli.mjs", "apps/cli/src/cli.mjs"],
  ["apps/cli/src/ensure.mjs", "apps/cli/src/ensure.mjs"],
  ["apps/cli/src/history.mjs", "apps/cli/src/history.mjs"],
  ["apps/cli/src/install-desktop.mjs", "apps/cli/src/install-desktop.mjs"],
  ["apps/cli/src/install-hooks.mjs", "apps/cli/src/install-hooks.mjs"],
  ["apps/cli/src/install.mjs", "apps/cli/src/install.mjs"],
  ["apps/cli/src/paths.mjs", "apps/cli/src/paths.mjs"],
  ["apps/cli/src/process.mjs", "apps/cli/src/process.mjs"],
  ["apps/cli/src/shots.mjs", "apps/cli/src/shots.mjs"],
];

const STAGING = ".tmp-install";
const MANAGED_DIRS = ["apps", "bin", "hooks"];
const KEEP_TOP = new Set([
  "desktop.json",
  "history.db",
  "history.json",
  "server.pid",
  "shots",
  "tray.pid",
  STAGING,
]);

export function getNativeBinaryPath(source = defaultRoot(), platform = process.platform, arch = process.arch) {
  let target = "";
  if (platform === "darwin") {
    target = arch === "arm64" ? "pinar-darwin-arm64" : "pinar-darwin-x64";
  } else if (platform === "linux") {
    target = arch === "arm64" ? "pinar-linux-arm64" : "pinar-linux-x64";
  } else if (platform === "win32") {
    target = "pinar-windows-x64.exe";
  }
  const binaryInDist = join(source, "dist", "bin", target);
  if (existsSync(binaryInDist)) return binaryInDist;
  const binaryDirect = join(source, "dist", "pinar");
  if (existsSync(binaryDirect)) return binaryDirect;
  return null;
}

function resolveRuntimeSource(root, repoPath) {
  const direct = join(root, repoPath);
  if (existsSync(direct)) return direct;
  return null;
}

export function launcherPath(dest = pinarHome(), platform = process.platform) {
  return join(dest, "bin", platform === "win32" ? "pinar.cmd" : "pinar");
}

export async function removeLegacyDarwinBin(dest = pinarHome()) {
  const bin = join(dest, "bin");
  await rm(bin, { recursive: true, force: true });
  return bin;
}

async function writeStaging(from, staging, platform = process.platform, arch = process.arch) {
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  const nativeBin = getNativeBinaryPath(from, platform, arch);

  // 1. Platform Binary / Launcher
  if (platform === "win32") {
    if (nativeBin) {
      const destBin = join(staging, "bin", "pinar.exe");
      await mkdir(join(destBin, ".."), { recursive: true });
      await cp(nativeBin, destBin, { force: true });
    } else {
      const srcLauncher = resolveRuntimeSource(from, "bin/pinar.cmd");
      if (srcLauncher) {
        const destBin = join(staging, "bin", "pinar.cmd");
        await mkdir(join(destBin, ".."), { recursive: true });
        await cp(srcLauncher, destBin, { force: true });
      }
    }
  } else {
    const destBin = join(staging, "bin", "pinar");
    await mkdir(join(destBin, ".."), { recursive: true });
    if (nativeBin) {
      await cp(nativeBin, destBin, { force: true });
    } else {
      const srcLauncher = resolveRuntimeSource(from, "bin/pinar");
      if (srcLauncher) {
        await cp(srcLauncher, destBin, { force: true });
      }
    }
    await chmod(destBin, 0o755).catch(() => {});
  }

  // 2. Fallback scripts if no native binary
  if (!nativeBin) {
    const serverOutput = join(from, "apps", "server", ".output");
    if (!existsSync(join(serverOutput, "server", "index.mjs"))) {
      execFileSync("bun", ["run", "build:local"], { cwd: from, stdio: "inherit" });
    }
    for (const [fromPath, toPath] of RUNTIME_SCRIPTS) {
      const src = resolveRuntimeSource(from, fromPath);
      if (!src) continue;
      const destFile = join(staging, toPath);
      await mkdir(join(destFile, ".."), { recursive: true });
      await cp(src, destFile, { force: true });
    }
    await cp(serverOutput, join(staging, "apps", "server", ".output"), {
      force: true,
      recursive: true,
    });
  }

  // 3. Platform Hooks
  const hooksPinar = resolveRuntimeSource(from, "hooks/pinar.js");
  if (hooksPinar) {
    const destHooksPinar = join(staging, "hooks", "pinar.js");
    await mkdir(join(destHooksPinar, ".."), { recursive: true });
    await cp(hooksPinar, destHooksPinar, { force: true });
  }

  if (platform === "win32") {
    const hooksEnsureCmd = resolveRuntimeSource(from, "hooks/ensure.cmd");
    if (hooksEnsureCmd) {
      const destHooksCmd = join(staging, "hooks", "ensure.cmd");
      await mkdir(join(destHooksCmd, ".."), { recursive: true });
      await cp(hooksEnsureCmd, destHooksCmd, { force: true });
    }
  } else {
    const hooksEnsureSh = resolveRuntimeSource(from, "hooks/ensure.sh");
    if (hooksEnsureSh) {
      const destHooksSh = join(staging, "hooks", "ensure.sh");
      await mkdir(join(destHooksSh, ".."), { recursive: true });
      await cp(hooksEnsureSh, destHooksSh, { force: true });
      await chmod(destHooksSh, 0o755).catch(() => {});
    }
  }
}

async function replaceManaged(staging, to) {
  for (const dir of MANAGED_DIRS) {
    const next = join(staging, dir);
    const destDir = join(to, dir);
    await rm(destDir, { recursive: true, force: true });
    if (existsSync(next)) await cp(next, destDir, { recursive: true, force: true });
  }
}

export async function migrateShotsDir(to) {
  const previous = join(to, "screenshots");
  const next = join(to, "shots");
  if (!existsSync(previous)) return false;
  if (!existsSync(next)) {
    await rename(previous, next);
    return true;
  }
  await mkdir(next, { recursive: true });
  for (const name of await readdir(previous)) {
    const from = join(previous, name);
    const dest = join(next, name);
    if (!existsSync(dest)) await rename(from, dest);
  }
  await rm(previous, { recursive: true, force: true });
  return true;
}

async function pruneTopLevel(to) {
  const allowed = new Set([...MANAGED_DIRS, ...KEEP_TOP]);
  let entries = [];
  try {
    entries = await readdir(to, { withFileTypes: true });
  } catch {
    return [];
  }
  const removed = [];
  for (const entry of entries) {
    if (allowed.has(entry.name)) continue;
    await rm(join(to, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

export async function installApp({
  source = defaultRoot(),
  dest = pinarHome(),
  platform = process.platform,
  arch = process.arch,
  log = console.error,
} = {}) {
  const from = resolve(source);
  const to = resolve(dest);
  await mkdir(to, { recursive: true });
  const staging = join(to, STAGING);
  await writeStaging(from, staging, platform, arch);
  await replaceManaged(staging, to);
  await migrateShotsDir(to);
  const removed = await pruneTopLevel(to);
  await rm(staging, { recursive: true, force: true });
  if (platform !== "win32") {
    if (existsSync(join(to, "bin", "pinar"))) await chmod(join(to, "bin", "pinar"), 0o755);
    if (existsSync(join(to, "hooks", "ensure.sh"))) await chmod(join(to, "hooks", "ensure.sh"), 0o755);
  }
  if (removed.length) log(`pinar removed ${removed.join(", ")}`);
  log(`pinar files -> ${to}`);
  return { dest: to, copied: from !== to, removed };
}

function pathSnippet(bin, platform = process.platform) {
  if (platform === "win32") return bin;
  return `export PATH="${bin}:$PATH" # pinar`;
}

export async function ensureUserPath({
  home = homedir(),
  dest = pinarHome(),
  platform = process.platform,
  log = console.error,
} = {}) {
  const bin = join(dest, "bin");
  const candidates =
    platform === "win32"
      ? []
      : [
          join(home, ".zshrc"),
          join(home, ".bashrc"),
          join(home, ".bash_profile"),
          join(home, ".profile"),
        ];

  let target = candidates.find((path) => existsSync(path));
  if (!target && platform !== "win32") {
    target = candidates[0];
    await writeFile(target, "", { encoding: "utf8", flag: "a" });
  }

  if (!target) return { changed: [], path: bin, updated: false };

  const content = existsSync(target) ? await readFile(target, "utf8") : "";
  if (content.includes(bin)) return { changed: [], file: target, path: bin, updated: false };

  const snippet = pathSnippet(bin, platform);
  const suffix = content.endsWith("\n") || !content.length ? "" : "\n";
  await writeFile(target, `${content}${suffix}${snippet}\n`, "utf8");
  log(`pinar added ${bin} to ${target}`);
  return { changed: [target], file: target, path: bin, updated: true };
}

export async function runInstall({
  source = defaultRoot(),
  dest = pinarHome(),
  home = homedir(),
  platform = process.platform,
  arch = process.arch,
  log = console.error,
} = {}) {
  if (platform === "darwin") {
    const to = resolve(dest);
    await mkdir(to, { recursive: true });
    await migrateShotsDir(to);
    await removeLegacyDarwinBin(to);
    await installMacDesktopApp({ home, log, source });
    const hooksResult = await installHooks({ dest: to, home, log, platform, root: source });
    return { ...hooksResult, path: { path: to, updated: false } };
  }
  await installApp({ arch, dest, log, platform, source });
  const pathResult = await ensureUserPath({ dest, home, log, platform });
  const hooksResult = await installHooks({ dest, home, log, platform, root: source });
  return { ...hooksResult, path: pathResult };
}

export { runInstall as install };
