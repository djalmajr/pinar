#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findAvailablePort, findHealthyPort, waitHealthy } from "./ensure.mjs";
import { install } from "./install.mjs";
import { installHooks } from "./install-hooks.mjs";
import { pinarHome, portRange, shotsDir } from "./paths.mjs";
import { migrateNestedShots } from "./shots.mjs";

const isCompiled = import.meta.url.includes("$bunfs");
const commands = new Set(["ensure", "install", "install-hooks", "serve"]);
const command = process.argv.slice(1).find((argument) => commands.has(argument)) ?? "ensure";
const root = pinarHome();
const self = fileURLToPath(import.meta.url);

async function serve() {
  const migration = await migrateNestedShots(root);
  if (migration.moved.length) console.error(`pinar moved ${migration.moved.length} nested shots`);
  if (migration.conflicts.length) {
    console.error(`pinar kept ${migration.conflicts.length} conflicting nested shots`);
  }
  const existing = await findHealthyPort();
  if (existing != null) {
    console.error(`pinar server already on :${existing}`);
    process.exit(0);
  }
  const port = await findAvailablePort();
  if (port == null) {
    const range = portRange();
    throw new Error(`pinar: no free port in ${range[0]}-${range.at(-1)}`);
  }
  process.env.HOST = "127.0.0.1";
  process.env.PORT = String(port);
  await import("../../server/.output/server/index.mjs");
  console.error(`pinar server http://127.0.0.1:${port}`);
  console.error(`store ${shotsDir(root)}`);
}

async function ensure() {
  const existing = await findHealthyPort();
  if (existing != null) {
    console.error(`pinar server already on :${existing}`);
    return;
  }
  const child = spawn(process.execPath, isCompiled ? ["serve"] : [self, "serve"], {
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();
  const port = await waitHealthy();
  if (port != null) {
    console.error(`pinar server started on :${port}`);
    return;
  }
  const range = portRange();
  console.error(`pinar server failed to start on :${range[0]}-${range.at(-1)}`);
  process.exit(1);
}

if (command === "serve") {
  await serve();
} else if (command === "ensure") {
  await ensure();
} else if (command === "install") {
  await install();
} else if (command === "install-hooks") {
  await installHooks();
} else {
  console.error("Usage: pinar <ensure|serve|install|install-hooks>");
  process.exit(1);
}
