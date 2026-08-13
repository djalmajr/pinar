#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isAddrInUse, isHealthy, waitHealthy } from "./ensure.mjs";
import { startShotServer } from "./http.mjs";
import { install } from "./install.mjs";
import { installHooks } from "./install-hooks.mjs";
import { resolvePort, screenshotsDir } from "./paths.mjs";

const command = process.argv[2] ?? "ensure";
const port = resolvePort();
const root = screenshotsDir();
const self = fileURLToPath(import.meta.url);

async function serve() {
  try {
    await startShotServer({ port, root });
  } catch (error) {
    if (isAddrInUse(error) && (await isHealthy(port))) {
      console.error(`pinar shots already on :${port}`);
      process.exit(0);
    }
    throw error;
  }
  console.error(`pinar shots http://127.0.0.1:${port}`);
  console.error(`store ${root}`);
}

async function ensure() {
  if (await isHealthy(port)) {
    console.error(`pinar shots already on :${port}`);
    return;
  }
  const child = spawn(process.execPath, [self, "serve"], {
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();
  if (await waitHealthy(port)) {
    console.error(`pinar shots started on :${port}`);
    return;
  }
  console.error(`pinar shots failed to start on :${port}`);
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
