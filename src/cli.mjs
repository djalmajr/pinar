#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findHealthyPort, listenFirstFree, waitHealthy } from "./ensure.mjs";
import { install } from "./install.mjs";
import { installHooks } from "./install-hooks.mjs";
import { portRange, shotsDir } from "./paths.mjs";

const command = process.argv[2] ?? "ensure";
const root = shotsDir();
const self = fileURLToPath(import.meta.url);

async function serve() {
  const found = await listenFirstFree({ root });
  if (found.existing) {
    console.error(`pinar shots already on :${found.port}`);
    process.exit(0);
  }
  console.error(`pinar shots http://127.0.0.1:${found.port}`);
  console.error(`store ${root}`);
}

async function ensure() {
  const existing = await findHealthyPort();
  if (existing != null) {
    console.error(`pinar shots already on :${existing}`);
    return;
  }
  const child = spawn(process.execPath, [self, "serve"], {
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();
  const port = await waitHealthy();
  if (port != null) {
    console.error(`pinar shots started on :${port}`);
    return;
  }
  const range = portRange();
  console.error(`pinar shots failed to start on :${range[0]}-${range.at(-1)}`);
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
