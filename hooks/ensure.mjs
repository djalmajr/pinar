#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin } from "node:process";

export function hooksDir(here = dirname(fileURLToPath(import.meta.url))) {
  return here;
}

export function repoRoot(here = hooksDir()) {
  return join(here, "..");
}

export function pinarLauncher(root, platform = process.platform) {
  if (platform === "win32") {
    const exe = join(root, "bin", "pinar.exe");
    if (existsSync(exe)) return { args: ["ensure"], bin: exe, shell: false };
    return { args: ["ensure"], bin: join(root, "bin", "pinar.cmd"), shell: true };
  }
  return { args: ["ensure"], bin: join(root, "bin", "pinar"), shell: false };
}

export function darwinOpenArgs(home = homedir()) {
  const app = join(home, "Applications", "Pinar.app");
  if (existsSync(app)) return { args: ["-ga", app], bin: "/usr/bin/open" };
  return { args: ["-ga", "Pinar"], bin: "/usr/bin/open" };
}

export function trayPidPath(home = homedir()) {
  return join(home, ".pinar", "tray.pid");
}

export function readAlivePid(pidFile) {
  try {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export async function drainStdin(stream = stdin, timeoutMs = 200) {
  if (stream.isTTY) return;
  await Promise.race([
    new Promise((resolve) => {
      stream.resume();
      stream.on("data", () => {});
      stream.on("end", resolve);
      stream.on("error", resolve);
    }),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function spawnWait(bin, args, { shell = false, spawnFn = spawn } = {}) {
  const child = spawnFn(bin, args, {
    shell,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => resolve(status ?? 1));
  });
}

async function ensureDarwin({
  home = homedir(),
  spawnFn = spawn,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  mkdirSync(join(home, ".pinar"), { recursive: true });
  if (readAlivePid(trayPidPath(home)) != null) return 0;
  const open = darwinOpenArgs(home);
  const code = await spawnWait(open.bin, open.args, { spawnFn });
  if (code !== 0) return code;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (readAlivePid(trayPidPath(home)) != null) return 0;
    await wait(50);
  }
  return 0;
}

export async function runEnsure({
  drain = drainStdin,
  home = homedir(),
  json = process.env.PINAR_HOOK_JSON === "1",
  platform = process.platform,
  root = repoRoot(),
  spawnFn = spawn,
} = {}) {
  await drain();
  let code = 0;
  if (platform === "darwin") {
    code = await ensureDarwin({ home, spawnFn });
  } else {
    const launcher = pinarLauncher(root, platform);
    code = await spawnWait(launcher.bin, launcher.args, { shell: launcher.shell, spawnFn });
  }
  if (json) {
    process.stdout.write("{}\n");
    return 0;
  }
  return code;
}

if (process.argv[1] && basename(process.argv[1]) === "ensure.mjs") {
  process.exit(await runEnsure());
}
