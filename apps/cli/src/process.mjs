import { spawn } from "node:child_process";
import { readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pinarHome } from "./paths.mjs";

export function pidPath(root = pinarHome()) {
  return join(root, "server.pid");
}

export async function writeServerPid(pid, root = pinarHome()) {
  await mkdir(root, { recursive: true });
  await writeFile(pidPath(root), `${pid}\n`, "utf8");
}

export async function readServerPid(root = pinarHome()) {
  try {
    const pid = Number((await readFile(pidPath(root), "utf8")).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function clearServerPid(root = pinarHome()) {
  try {
    await unlink(pidPath(root));
  } catch {
    // A missing pid file is the stopped state.
  }
}

export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stopPid(pid, { timeoutMs = 3000, kill = process.kill, wait = sleep } = {}) {
  if (!isPidAlive(pid)) return "already_stopped";
  try {
    kill(pid, "SIGTERM");
  } catch {
    return "already_stopped";
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return "stopped";
    await wait(40);
  }
  try {
    kill(pid, "SIGKILL");
  } catch {
    return "stopped";
  }
  await wait(40);
  return isPidAlive(pid) ? "failed" : "stopped";
}

export function parseNetstatListeningPid(stdout, port) {
  const suffix = `:${port}`;
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    const local = cols[1] ?? "";
    if (!local.endsWith(suffix)) continue;
    const pid = Number(cols[cols.length - 1]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

export async function findListeningPid(port, run = runCommand, platform = process.platform) {
  if (platform === "win32") {
    const stdout = await run(["netstat", "-ano", "-p", "tcp"]);
    return parseNetstatListeningPid(stdout, port);
  }
  const stdout = await run(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  const pid = Number(String(stdout).trim().split(/\s+/)[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function runCommand(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${argv[0]} exited ${code}`));
    });
  });
}
