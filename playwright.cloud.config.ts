import { defineConfig, devices } from "@playwright/test";

const PORT = 17_384;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  reporter: [["list"]],
  testDir: "./tests/e2e/cloud",
  timeout: 45_000,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run dev:cloud -- --port ${PORT} --state-path .wrangler/state/cloud-e2e`,
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 120_000,
    url: baseURL,
  },
  workers: 1,
});
