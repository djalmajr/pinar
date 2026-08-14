import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defaultRoot, installHooks } from "./install-hooks.mjs";
import { pinarHome } from "./paths.mjs";

export const RUNTIME_FILES = [
  ["bin/pinar", "bin/pinar"],
  ["bin/pinar.cmd", "bin/pinar.cmd"],
  ["src/cli.mjs", "lib/cli.mjs"],
  ["src/ensure.mjs", "lib/ensure.mjs"],
  ["src/http.mjs", "lib/http.mjs"],
  ["src/install-hooks.mjs", "lib/install-hooks.mjs"],
  ["src/install.mjs", "lib/install.mjs"],
  ["src/paths.mjs", "lib/paths.mjs"],
  ["src/shots.mjs", "lib/shots.mjs"],
  ["hooks/ensure.cmd", "hooks/ensure.cmd"],
  ["hooks/ensure.sh", "hooks/ensure.sh"],
  ["hooks/pinar.js", "hooks/pinar.js"],
];

const STAGING = ".tmp-install";
const MANAGED_DIRS = ["bin", "lib", "hooks", "extension"];
const KEEP_TOP = new Set(["shots", "helper.json", STAGING]);

function resolveRuntimeSource(root, repoPath) {
  const direct = join(root, repoPath);
  if (existsSync(direct)) return direct;
  if (repoPath.startsWith("src/")) {
    const installed = join(root, "lib", repoPath.slice(4));
    if (existsSync(installed)) return installed;
  }
  return null;
}

export function launcherPath(dest = pinarHome(), platform = process.platform) {
  return join(dest, "bin", platform === "win32" ? "pinar.cmd" : "pinar");
}

async function writeStaging(from, staging) {
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  for (const [fromPath, toPath] of RUNTIME_FILES) {
    const src = resolveRuntimeSource(from, fromPath);
    if (!src) continue;
    const destFile = join(staging, toPath);
    await mkdir(join(destFile, ".."), { recursive: true });
    await cp(src, destFile, { force: true });
  }
  const extFrom = join(from, "extension");
  if (existsSync(extFrom)) {
    await cp(extFrom, join(staging, "extension"), {
      recursive: true,
      force: true,
      filter: (src) => !/\.test\.(js|ts)$/.test(src),
    });
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
  log = console.error,
} = {}) {
  const from = resolve(source);
  const to = resolve(dest);
  await mkdir(to, { recursive: true });
  const staging = join(to, STAGING);
  await writeStaging(from, staging);
  await replaceManaged(staging, to);
  await migrateShotsDir(to);
  const removed = await pruneTopLevel(to);
  await rm(staging, { recursive: true, force: true });
  if (process.platform !== "win32") {
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
