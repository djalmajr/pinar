import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const baseUrl = process.env.PINAR_E2E_BASE_URL || "https://stg.pinar.dev";
const consumeFounderSlot = process.argv.includes("--consume-founder-slot");
const target = new URL(baseUrl);

if (target.protocol !== "https:" || target.hostname !== "stg.pinar.dev") {
  throw new Error("Stripe-hosted E2E is restricted to https://stg.pinar.dev");
}
if (!consumeFounderSlot) {
  throw new Error("Pass --consume-founder-slot to acknowledge that this Stripe Test run consumes one staging Founder slot");
}
if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) {
  throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required for the protected staging environment");
}

const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const email = process.env.PINAR_STRIPE_FOUNDER_EMAIL || `pinar-founder-e2e+${runId}@example.com`;
const playwrightCli = join(ROOT, "node_modules", "@playwright", "test", "cli.js");
const result = spawnSync(process.execPath, [
  playwrightCli,
  "test",
  "tests/e2e/monetizacao/stripe-hosted-founder.e2e.test.ts",
  "--project=chromium",
], {
  cwd: ROOT,
  env: {
    ...process.env,
    PINAR_E2E_BASE_URL: baseUrl,
    PINAR_STRIPE_FOUNDER_EMAIL: email,
    PINAR_STRIPE_HOSTED_E2E: "1",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
