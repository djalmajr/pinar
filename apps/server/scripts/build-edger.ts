/**
 * EdgeR artifact: Vite SSR build without the Cloudflare plugin, plus the
 * manifest and a Deno config, zipped under the 64 MiB install cap. The
 * Cloudflare build (`vite build`) is untouched and keeps its own output.
 *
 *   bun run build:edger
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const edgerDir = join(root, "dist/edger");
const zipPath = join(root, "dist/pinar-edger.zip");
const zipCap = 64 * 1024 * 1024;

function ensureServerEntry() {
  const serverDir = join(edgerDir, "server");
  const target = join(serverDir, "server.js");
  if (existsSync(target)) return;
  const entries = readdirSync(serverDir).filter((name) => name.endsWith(".js"));
  if (entries.length !== 1) {
    throw new Error(
      `Expected dist/edger/server/server.js. Found: ${entries.join(", ") || "(none)"}`,
    );
  }
  renameSync(join(serverDir, entries[0]), target);
}

rmSync(edgerDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(join(root, "dist"), { recursive: true });

const viteBin = join(root, "node_modules/vite/bin/vite.js");
// Vite loads the config through Node's module customization hooks, so the
// CLI must run under Node even when this script runs under Bun (the repo's
// own `vite` bin is shebanged to node).
const nodeBin = basename(process.execPath).startsWith("node") ? process.execPath : "node";
const built = spawnSync(
  nodeBin,
  [viteBin, "build", "--config", "vite.config.edger.ts"],
  { cwd: root, stdio: "inherit" },
);
if (built.status !== 0) {
  throw new Error("vite build failed");
}

ensureServerEntry();
const serverJs = join(edgerDir, "server/server.js");
const serverSource = readFileSync(serverJs, "utf8");
// Every server chunk, not only the entry: with `ssr.noExternal` a binding
// adapter is inlined, and a Cloudflare binding's own source never spells its
// specifier.
const forbidden = ["cloudflare:workers", "cloudflare:email", "@cloudflare/vite-plugin"];
// The EdgeR entry (src/edger-server-entry.ts) owns the internal cron route;
// a bundle without it fell back to the generic TanStack entry.
const requiredMarker = "/_internal/cron/daily";
let hasRequiredMarker = false;
for (const file of listJsFiles(join(edgerDir, "server"))) {
  const source = readFileSync(file, "utf8");
  for (const marker of forbidden) {
    if (source.includes(marker)) {
      throw new Error(`${relative(root, file)} contains ${marker}`);
    }
  }
  if (source.includes(requiredMarker)) hasRequiredMarker = true;
}
if (!hasRequiredMarker) {
  throw new Error(`dist/edger/server does not contain ${requiredMarker}: the EdgeR server entry was not used`);
}
if (
  !serverSource.includes("as default") &&
  !serverSource.includes("export default")
) {
  throw new Error("dist/edger/server/server.js does not default-export fetch");
}
if (!existsSync(join(edgerDir, "client"))) {
  throw new Error("dist/edger/client is missing");
}

cpSync(join(root, "edger/manifest.yaml"), join(edgerDir, "manifest.yaml"));
// Own config root so Deno does not walk up to a repo tsconfig.json wherever
// the zip is extracted. No secrets.
writeFileSync(
  join(edgerDir, "deno.json"),
  `${JSON.stringify({ compilerOptions: { strict: true } }, null, 2)}\n`,
);

const zip = spawnSync("zip", ["-r", "-X", zipPath, ".", "-x", "*.DS_Store"], {
  cwd: edgerDir,
  stdio: "inherit",
});
if (zip.status !== 0) {
  throw new Error("zip failed");
}

const size = statSync(zipPath).size;
if (size >= zipCap) {
  throw new Error(`dist/pinar-edger.zip is ${size} bytes; cap is ${zipCap}`);
}
console.log(`dist/pinar-edger.zip ${size} bytes`);

function listJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(path));
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      out.push(path);
    }
  }
  return out;
}
