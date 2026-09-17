import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.PINAR_SESSION_TEST_PORT || 17383);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/continuous-session.e2e.test.ts", "**/session-groups.e2e.test.ts", "**/menu-language.e2e.test.ts"],
  workers: 1,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: "bun apps/server/.output/server/index.mjs",
    env: { PORT: String(port), PINAR_HOME: mkdtempSync(join(tmpdir(), "pinar-review-ui-")) },
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
  },
});
