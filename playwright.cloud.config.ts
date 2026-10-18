import { defineConfig, devices } from "@playwright/test";

const PORT = 17_384;
const baseURL = `http://127.0.0.1:${PORT}`;

// Relative to apps/server, where cloud-local.mjs resolves it. The e2e
// helpers import this single source of truth to reach the run's persisted
// state (tests/e2e/helpers/cloud-signin.ts).
export const CLOUD_E2E_STATE_PATH = ".wrangler/state/cloud-e2e-run";

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
    command: `bun run dev:cloud -- --port ${PORT} --state-path ${CLOUD_E2E_STATE_PATH}`,
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 120_000,
    url: baseURL,
  },
  workers: 1,
});
