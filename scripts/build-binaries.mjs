import { execSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const targets = [
  { name: "pinar-darwin-arm64", target: "bun-darwin-arm64" },
  { name: "pinar-darwin-x64", target: "bun-darwin-x64" },
  { name: "pinar-linux-x64", target: "bun-linux-x64" },
  { name: "pinar-linux-arm64", target: "bun-linux-arm64" },
  { name: "pinar-windows-x64.exe", target: "bun-windows-x64" },
];

const outDir = resolve(process.cwd(), "dist/bin");
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

console.log("⚡ Building standalone Pinar native binaries with Bun...");
execSync("bun run build:local", { stdio: "inherit" });

for (const { name, target } of targets) {
  const outfile = resolve(outDir, name);
  const cmd = `bun build --compile --target=${target} ./apps/cli/src/cli.mjs --outfile ${outfile}`;
  console.log(`🔨 Compiling ${name} (${target})...`);
  execSync(cmd, { stdio: "inherit" });
}

console.log("✅ All binaries built successfully in dist/bin/!");
