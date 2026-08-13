import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 17373;

export function pinarHome() {
  return process.env.PINAR_HOME ?? join(homedir(), ".pinar");
}

export function screenshotsDir(root = pinarHome()) {
  return join(root, "screenshots");
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
