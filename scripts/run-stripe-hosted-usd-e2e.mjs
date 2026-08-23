import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./load-local-env.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
loadLocalEnv(join(ROOT, ".env.local"));

const baseUrl = process.env.PINAR_E2E_BASE_URL || "https://stg.pinar.dev";
const consumeTestCharges = process.argv.includes("--consume-test-charges");
const target = new URL(baseUrl);

if (target.protocol !== "https:" || target.hostname !== "stg.pinar.dev") {
  throw new Error("Stripe-hosted USD E2E is restricted to https://stg.pinar.dev");
}
if (!consumeTestCharges) {
  throw new Error("Pass --consume-test-charges to acknowledge Stripe Test Checkout charges against staging");
}
if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) {
  throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required for the protected staging environment");
}
if (!process.env.STRIPE_TEST_RESTRICTED_KEY?.startsWith("rk_test_")) {
  throw new Error("STRIPE_TEST_RESTRICTED_KEY must be a Stripe test restricted key");
}

const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const email = process.env.PINAR_STRIPE_USD_EMAIL || `pinar-usd-e2e+${runId}@example.com`;
const playwrightCli = join(ROOT, "node_modules", "@playwright", "test", "cli.js");
const result = spawnSync(process.execPath, [
  playwrightCli,
  "test",
  "tests/e2e/monetizacao/stripe-hosted-usd.e2e.test.ts",
  "--project=firefox",
], {
  cwd: ROOT,
  env: {
    ...process.env,
    PINAR_E2E_BASE_URL: baseUrl,
    PINAR_STRIPE_HOSTED_USD_E2E: "1",
    PINAR_STRIPE_USD_EMAIL: email,
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
