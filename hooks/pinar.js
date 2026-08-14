import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveEnsure() {
  const raw = fileURLToPath(import.meta.url);
  let here = dirname(raw);
  try {
    here = dirname(realpathSync(raw));
  } catch {
    // keep the unresolved directory
  }
  const names = process.platform === "win32" ? ["ensure.cmd", "ensure.sh"] : ["ensure.sh", "ensure.cmd"];
  const folders = [here, join(here, "../hooks"), join(here, "../../hooks")];
  for (const folder of folders) {
    for (const name of names) {
      const path = join(folder, name);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

export default function (pi) {
  const ensure = resolveEnsure();
  pi.on("session_start", () => {
    const winCmd = Boolean(ensure && process.platform === "win32" && ensure.endsWith(".cmd"));
    const child = ensure
      ? spawn(ensure, [], { detached: true, stdio: "ignore", shell: winCmd })
      : spawn("pinar", [], { detached: true, stdio: "ignore", shell: process.platform === "win32" });
    child.unref();
  });
}
