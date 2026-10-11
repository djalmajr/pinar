import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHutchExecutable } from "./hutch-exe.mjs";
import { assertHutchMatchesPin } from "./hutch-pin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tray = resolve(root, "apps/tray");
const mode = process.argv[2] ?? "dev";
const args = mode === "build" ? ["electrobun", "build", "--env=stable"] : ["run", "dev"];

// DJA-208: resolve the explicit absolute Hutch executable and spawn it with
// shell: false. A bare "hutch" (through cmd.exe, or via libuv's own search)
// looks in the working directory before PATH, where a planted
// hutch.cmd / hutch.exe would run instead. A resolver failure is a clear
// run-tray: error with exit 1.
let hutchExecutable;
try {
  hutchExecutable = resolveHutchExecutable();
} catch (error) {
  console.error(`run-tray: ${error.message}`);
  process.exit(1);
}

let hutchVersion;
try {
  hutchVersion = assertHutchMatchesPin({
    trayDir: tray,
    resolve: () => hutchExecutable,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`run-tray: hutch ${hutchVersion} (pinned in apps/tray/hutch.config.ts)`);

const child = spawn(hutchExecutable, args, {
  cwd: tray,
  shell: false,
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
