import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { shotsDir } from "./paths.mjs";

export function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const raw = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Uint8Array.from(Buffer.from(raw, "base64"));
}

export function safeShotName(id) {
  const stem = String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "pin";
  return `${stem}.png`;
}

export async function writeShot(id, dataUrl, root = shotsDir()) {
  await mkdir(root, { recursive: true });
  const path = join(root, safeShotName(id));
  await writeFile(path, decodeDataUrl(dataUrl));
  return path;
}
