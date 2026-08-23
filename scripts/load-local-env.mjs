import { readFileSync } from "node:fs";

export function loadLocalEnv(pathname) {
  let source = "";
  try {
    source = readFileSync(pathname, "utf8");
  } catch {
    return;
  }
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (process.env[name] === undefined) process.env[name] = value;
  }
}
