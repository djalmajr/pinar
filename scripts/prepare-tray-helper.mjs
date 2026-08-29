import { execSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") {
  process.stdout.write("Skipping macOS helper compile (not Darwin).\n");
  process.exit(0);
}

const arch = process.arch === "arm64" ? "arm64" : "x64";
const bunTarget = arch === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64";
const outDir = resolve(root, "apps/tray/helpers");
const outfile = resolve(outDir, "pinar");
const ensureHook = resolve(outDir, "ensure.sh");

mkdirSync(outDir, { recursive: true });
execSync("bun run build:local", { cwd: root, stdio: "inherit" });
execSync(`bun build --compile --target=${bunTarget} ./apps/cli/src/cli.mjs --outfile ${outfile}`, {
  cwd: root,
  stdio: "inherit",
});
chmodSync(outfile, 0o755);
copyFileSync(resolve(root, "hooks/pinar.js"), resolve(outDir, "pinar.js"));
copyFileSync(resolve(root, "hooks/ensure.sh"), ensureHook);
chmodSync(ensureHook, 0o755);
process.stdout.write(`Embedded helper ready at ${outfile}\n`);
