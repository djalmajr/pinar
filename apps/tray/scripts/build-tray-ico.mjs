// Builds src/assets/tray-win.ico from src/assets/tray-win.svg.
//
// The Windows notification area asks for 16, 20, 24 or 32 px depending on the
// display scale, and picks the nearest entry of the .ico. A single glyph
// downscaled from the 512 px app icon looks soft at those sizes, so each entry
// is rendered on its own with a stroke width rounded to whole device pixels.
// Entries are stored as 32-bit BMPs (the safest format for tray icons).
//
//   node apps/tray/scripts/build-tray-ico.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = join(root, "src", "assets", "tray-win.svg");
const icoPath = join(root, "src", "assets", "tray-win.ico");
const VIEWBOX = 22;
// Device pixels per size: thick enough to read, thin enough to keep the tail.
const SIZES = [
  { size: 16, stroke: 2 },
  { size: 20, stroke: 2.5 },
  { size: 24, stroke: 3 },
  { size: 32, stroke: 3.5 },
  { size: 48, stroke: 5 },
];

function svgFor(strokePx, size) {
  const source = readFileSync(svgPath, "utf8");
  const stroke = (strokePx * VIEWBOX) / size;
  return source.replace(/stroke-width="[^"]+"/, `stroke-width="${stroke.toFixed(3)}"`);
}

/** Minimal PNG decoder for what Chromium emits: 8-bit RGBA, non-interlaced. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error("expected 8-bit RGBA non-interlaced PNG");
    } else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { height, pixels, width };
}

/** 32-bit BGRA DIB with an empty AND mask, bottom-up rows. */
function bmpEntry({ height, pixels, width }) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(width * height * 4, 20);
  const body = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((height - 1 - y) * width + x) * 4;
      const target = (y * width + x) * 4;
      body[target] = pixels[source + 2];
      body[target + 1] = pixels[source + 1];
      body[target + 2] = pixels[source];
      body[target + 3] = pixels[source + 3];
    }
  }
  const maskStride = Math.ceil(width / 32) * 4;
  const mask = Buffer.alloc(maskStride * height);
  return Buffer.concat([header, body, mask]);
}

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  const bodies = [];
  entries.forEach(({ data, size }, index) => {
    const at = index * 16;
    directory[at] = size >= 256 ? 0 : size;
    directory[at + 1] = size >= 256 ? 0 : size;
    directory[at + 2] = 0;
    directory[at + 3] = 0;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
    bodies.push(data);
  });
  return Buffer.concat([header, directory, ...bodies]);
}

const browser = await chromium.launch();
try {
  const entries = [];
  for (const { size, stroke } of SIZES) {
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { height: size, width: size } });
    const svg = svgFor(stroke, size);
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style>`
      + `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`,
    );
    const png = await page.screenshot({ clip: { height: size, width: size, x: 0, y: 0 }, omitBackground: true, type: "png" });
    await page.close();
    entries.push({ data: bmpEntry(decodePng(png)), size });
  }
  writeFileSync(icoPath, ico(entries));
  console.log(`wrote ${icoPath} (${SIZES.map((entry) => entry.size).join(", ")} px)`);
} finally {
  await browser.close();
}
