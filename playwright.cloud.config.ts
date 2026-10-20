import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 17_384;
const baseURL = `http://127.0.0.1:${PORT}`;

// Workers inherit the same home when they import this config through cloud-signin.
const e2eHome = process.env.PINAR_E2E_HOME || mkdtempSync(join(tmpdir(), "pinar-cloud-e2e-"));
process.env.PINAR_E2E_HOME = e2eHome;
export const CLOUD_E2E_STATE_PATH = join(e2eHome, "cloud-state");

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  reporter: [["list"]],
  testDir: "./tests/e2e",
  testMatch: [
    "**/autenticacao/**/*.e2e.test.ts",
    "**/cloud/**/*.e2e.test.ts",
    "**/ia/**/*.e2e.test.ts",
    "**/monetizacao/success.e2e.test.ts",
    "**/publico/pricing.e2e.test.ts",
  ],
  timeout: 45_000,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun tests/e2e/helpers/cloud-web-server.ts ${PORT}`,
    env: { PINAR_E2E_HOME: e2eHome },
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 120_000,
    url: baseURL,
  },
  workers: 1,
});
