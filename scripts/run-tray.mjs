import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertHutchMatchesPin } from "./hutch-pin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tray = resolve(root, "apps/tray");
const mode = process.argv[2] ?? "dev";
const args = mode === "build" ? ["electrobun", "build", "--env=stable"] : ["run", "dev"];

let hutchVersion;
try {
  hutchVersion = assertHutchMatchesPin({ trayDir: tray, spawnSync });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`run-tray: hutch ${hutchVersion} (pinned in apps/tray/hutch.config.ts)`);

const child = spawn("hutch", args, {
  cwd: tray,
  shell: process.platform === "win32",
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
