import { createServer } from "node:net";
import { portRange } from "./paths.mjs";

export function shotsUrl(port) {
  return `http://127.0.0.1:${port}`;
}

export async function isHealthy(port) {
  try {
    const response = await fetch(`${shotsUrl(port)}/api/health`);
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

export function canListen(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (isAddrInUse(error)) {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  });
}

export async function findAvailablePort(ports = portRange()) {
  for (const port of asPorts(ports)) {
    if (await canListen(port)) return port;
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
