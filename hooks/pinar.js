import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
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
  const folders = [here, join(here, "../hooks"), join(here, "../../hooks")];
  for (const folder of folders) {
    const path = join(folder, "ensure.mjs");
    if (existsSync(path)) return path;
  }
  return null;
}

export default function (pi) {
  const ensure = resolveEnsure();
  pi.on("session_start", () => {
    let child;
    if (ensure) {
      child = spawn("node", [ensure], {
        detached: true,
        stdio: "ignore",
      });
    } else if (process.platform === "darwin") {
      const app = join(homedir(), "Applications", "Pinar.app");
      child = existsSync(app)
        ? spawn("/usr/bin/open", ["-ga", app], {
            detached: true,
            stdio: "ignore",
          })
        : spawn("/usr/bin/open", ["-ga", "Pinar"], {
            detached: true,
            stdio: "ignore",
          });
    } else {
      child = spawn("pinar", ["ensure"], {
        detached: true,
        stdio: "ignore",
        shell: process.platform === "win32",
      });
    }
    child.unref();
  });
}
