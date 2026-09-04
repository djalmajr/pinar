import { execSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function helperCompilePlan(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") {
    const cpu = arch === "arm64" ? "arm64" : "x64";
    return {
      bunTarget: cpu === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64",
      outfileName: "pinar",
    };
  }
  if (platform === "win32") {
    return {
      bunTarget: "bun-windows-x64",
      outfileName: "pinar.exe",
    };
  }
  return null;
}

export function pngsToIco(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  const images = [];
  let offset = 6 + 16 * count;
  for (const png of pngBuffers) {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images]);
}

function writeWindowsIcon(root, outDir) {
  const names = ["icon_16x16.png", "icon_32x32.png", "icon_256x256.png"];
  const pngs = [];
  for (const name of names) {
    const path = join(root, "apps", "tray", "icon.iconset", name);
    pngs.push(readFileSync(path));
  }
  const ico = pngsToIco(pngs);
  const dest = join(outDir, "icon.ico");
  writeFileSync(dest, ico);
  copyFileSync(dest, join(root, "apps", "tray", "icon.ico"));
  return dest;
}

function compileHelper(root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const plan = helperCompilePlan();
  if (!plan) {
    process.stdout.write(`Skipping tray helper compile (${process.platform}).\n`);
    return;
  }

  const outDir = resolve(root, "apps/tray/helpers");
  const outfile = resolve(outDir, plan.outfileName);
  mkdirSync(outDir, { recursive: true });
  execSync("bun run build:local", { cwd: root, stdio: "inherit" });
  execSync(`bun build --compile --target=${plan.bunTarget} ./apps/cli/src/cli.mjs --outfile ${outfile}`, {
    cwd: root,
    stdio: "inherit",
  });
  if (process.platform !== "win32") chmodSync(outfile, 0o755);
  copyFileSync(resolve(root, "hooks/pinar.js"), resolve(outDir, "pinar.js"));
  copyFileSync(resolve(root, "hooks/ensure.mjs"), resolve(outDir, "ensure.mjs"));
  if (process.platform !== "win32") chmodSync(resolve(outDir, "ensure.mjs"), 0o755);
  if (process.platform === "win32") writeWindowsIcon(root, outDir);
  process.stdout.write(`Embedded helper ready at ${outfile}\n`);
}

if (process.argv[1] && basename(process.argv[1]) === "prepare-tray-helper.mjs") {
  compileHelper();
}
