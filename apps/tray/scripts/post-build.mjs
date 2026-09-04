import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const trayRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "darwin") {
  await import("./macos-agent-app.mjs");
}

if (process.platform === "win32") {
  const setup = join(trayRoot, "build", "stable-win-x64", "Pinar-Setup.exe");
  if (existsSync(setup)) {
    const artifacts = join(trayRoot, "artifacts");
    mkdirSync(artifacts, { recursive: true });
    copyFileSync(setup, join(artifacts, "win-x64-Pinar-Setup.exe"));
  }
}
