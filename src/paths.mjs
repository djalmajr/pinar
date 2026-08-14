import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 17373;
export const PORT_COUNT = 10;

export function portRange(start = resolvePort()) {
  if (process.env.PINAR_PORT) return [start];
  return Array.from({ length: PORT_COUNT }, (_, i) => start + i);
}

export function helperStatePath(home = pinarHome()) {
  return join(home, "helper.json");
}

export function pinarHome() {
  return process.env.PINAR_HOME ?? join(homedir(), ".pinar");
}

export function shotsDir(root = pinarHome()) {
  return join(root, "shots");
}

export function resolvePort() {
  const raw = process.env.PINAR_PORT;
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PINAR_PORT: ${raw}`);
  }
  return port;
}
