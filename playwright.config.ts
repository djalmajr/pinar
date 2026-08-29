import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PINAR_E2E_PORT ?? 17383);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error("PINAR_E2E_PORT must be an integer between 1 and 65535");
}

const externalBaseUrl = process.env.PINAR_E2E_BASE_URL;
const baseURL = externalBaseUrl || `http://127.0.0.1:${PORT}`;
const e2eHome = process.env.PINAR_E2E_HOME || join(tmpdir(), `pinar-e2e-${PORT}`);
if (!externalBaseUrl) mkdirSync(e2eHome, { recursive: true });

export default defineConfig({
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "mobile-iphone", use: { ...devices["iPhone 14"] } },
    { name: "mobile-android", use: { ...devices["Pixel 7"] } },
  ],
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.test\.ts$/,
  timeout: 30_000,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `env PORT=${PORT} PINAR_HOME=${JSON.stringify(e2eHome)} bun apps/server/.output/server/index.mjs`,
        reuseExistingServer: false,
        stderr: "pipe",
        stdout: "ignore",
        timeout: 60_000,
        url: baseURL,
      },
  workers: 1,
});
