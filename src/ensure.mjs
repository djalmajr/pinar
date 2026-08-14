import { mkdir, writeFile } from "node:fs/promises";
import { startShotServer } from "./http.mjs";
import { helperStatePath, pinarHome, portRange } from "./paths.mjs";

export function shotsUrl(port) {
  return `http://127.0.0.1:${port}`;
}

export async function isHealthy(port) {
  try {
    const response = await fetch(`${shotsUrl(port)}/health`);
    const body = await response.json();
    return response.ok && body.ok === true && body.service === "pinar";
  } catch {
    return false;
  }
}

export function isAddrInUse(error) {
  if (error && error.code === "EADDRINUSE") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /in use|EADDRINUSE|Failed to start server/i.test(message);
}

function asPorts(ports) {
  if (ports == null) return portRange();
  return Array.isArray(ports) ? ports : [ports];
}

export async function findHealthyPort(ports = portRange()) {
  for (const port of asPorts(ports)) {
    if (await isHealthy(port)) return port;
  }
  return null;
}

export async function waitHealthy(ports = portRange(), timeoutMs = 2000) {
  const list = asPorts(ports);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const port = await findHealthyPort(list);
    if (port != null) return port;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return findHealthyPort(list);
}

export async function writeHelperState({ port, pid = process.pid }) {
  await mkdir(pinarHome(), { recursive: true });
  await writeFile(
    helperStatePath(),
    `${JSON.stringify({ pid, port, url: shotsUrl(port) }, null, 2)}\n`,
  );
}

export async function listenFirstFree({
  root,
  ports = portRange(),
  startServer = startShotServer,
} = {}) {
  const existing = await findHealthyPort(ports);
  if (existing != null) return { existing: true, port: existing };
  let lastError;
  for (const port of asPorts(ports)) {
    try {
      const started = await startServer({ port, root });
      return { ...started, existing: false };
    } catch (error) {
      if (!isAddrInUse(error)) throw error;
      lastError = error;
    }
  }
  const list = asPorts(ports);
  throw lastError ?? new Error(`pinar: no free port in ${list[0]}-${list.at(-1)}`);
}
