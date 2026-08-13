import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defaultRoot, installHooks } from "./install-hooks.mjs";
import { pinarHome } from "./paths.mjs";

export const PAYLOAD_DIRS = ["bin", "src", "hooks", "extension"];
export const PAYLOAD_FILES = ["package.json", "AGENTS.md"];

export function launcherPath(dest = pinarHome(), platform = process.platform) {
  return join(dest, "bin", platform === "win32" ? "pinar.cmd" : "pinar");
}

export async function installApp({
  source = defaultRoot(),
  dest = pinarHome(),
  log = console.error,
} = {}) {
  const from = resolve(source);
  const to = resolve(dest);
  if (from === to) {
    log(`pinar files already at ${to}`);
    return { dest: to, copied: false };
  }
  await mkdir(to, { recursive: true });
  for (const dir of PAYLOAD_DIRS) {
    const src = join(from, dir);
    if (!existsSync(src)) continue;
    await cp(src, join(to, dir), { recursive: true, force: true });
  }
  for (const file of PAYLOAD_FILES) {
    const src = join(from, file);
    if (!existsSync(src)) continue;
    await cp(src, join(to, file), { force: true });
  }
  if (process.platform !== "win32") {
    await chmod(join(to, "bin", "pinar"), 0o755);
    if (existsSync(join(to, "hooks", "ensure.sh"))) {
      await chmod(join(to, "hooks", "ensure.sh"), 0o755);
    }
  }
  log(`pinar files -> ${to}`);
  return { dest: to, copied: true };
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
  const bin = join(resolve(dest), "bin");
  const changed = [];
  if (platform === "win32") {
    const script = [
      `$bin = ${JSON.stringify(bin)}`,
      `$path = [Environment]::GetEnvironmentVariable('Path', 'User')`,
      `if ([string]::IsNullOrEmpty($path)) { $path = '' }`,
      `if (-not (($path -split ';') -contains $bin)) {`,
      `  if ($path -eq '') { [Environment]::SetEnvironmentVariable('Path', $bin, 'User') }`,
      `  else { [Environment]::SetEnvironmentVariable('Path', $bin + ';' + $path, 'User') }`,
      `}`,
    ].join("; ");
    execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore" });
    changed.push("User PATH");
    log(`pinar PATH (user) += ${bin}`);
    return { bin, changed };
  }
  const line = pathSnippet(bin, platform);
  const profiles = [".zprofile", ".zshrc", ".bash_profile", ".bashrc", ".profile"];
  let target = null;
  for (const name of profiles) {
    const file = join(home, name);
    if (!existsSync(file)) continue;
    const text = await readFile(file, "utf8");
    if (text.includes(".pinar/bin") || text.includes(bin)) {
      return { bin, changed: [] };
    }
    if (!target) target = { file, text };
  }
  if (!target) {
    const file = join(home, ".profile");
    await writeFile(file, `${line}\n`);
    changed.push(file);
  } else {
    const next =
      target.text.endsWith("\n") || target.text.length === 0
        ? `${target.text}${line}\n`
        : `${target.text}\n${line}\n`;
    await writeFile(target.file, next);
    changed.push(target.file);
  }
  for (const file of changed) log(`pinar PATH += ${file}`);
  return { bin, changed };
}

export async function install({
  home = homedir(),
  source = defaultRoot(),
  dest = pinarHome(),
  log = console.error,
  platform = process.platform,
} = {}) {
  const app = await installApp({ source, dest, log });
  await ensureUserPath({ home, dest: app.dest, platform, log });
  const hooks = await installHooks({ home, root: app.dest, platform, log });
  log(`pinar launcher ${launcherPath(app.dest, platform)}`);
  return { dest: app.dest, hooks };
}
