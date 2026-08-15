import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pinarHome, shotsDir } from "./paths.mjs";

export function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const raw = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Uint8Array.from(Buffer.from(raw, "base64"));
}

export function safeShotName(id) {
  const stem = String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "pin";
  return `${stem}.png`;
}

export async function migrateNestedShots(root = pinarHome()) {
  const targetDir = shotsDir(root);
  const nestedDir = shotsDir(targetDir);
  let entries;
  try {
    entries = await readdir(nestedDir);
  } catch (error) {
    if (error?.code === "ENOENT") return { conflicts: [], moved: [] };
    throw error;
  }

  const conflicts = [];
  const moved = [];
  for (const name of entries) {
    const destination = join(targetDir, name);
    if (existsSync(destination)) {
      conflicts.push(name);
      continue;
    }
    await rename(join(nestedDir, name), destination);
    moved.push(name);
  }
  if (!conflicts.length) await rmdir(nestedDir);
  return { conflicts, moved };
}

export async function writeShot(id, dataUrl, root = pinarHome()) {
  const targetDir = shotsDir(root);
  await mkdir(targetDir, { recursive: true });
  const path = join(targetDir, safeShotName(id));
  await writeFile(path, decodeDataUrl(dataUrl));
  return path;
}
