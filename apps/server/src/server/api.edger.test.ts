import assert from "node:assert/strict";
import { test } from "node:test";
import { getEdgerCloudEnv, handleApiRequest } from "./api.edger";

// Every variable edgerCloudEnv reads: the test must control all of them,
// otherwise a host environment carrying a partial group (for example a
// CLOUDFLARE_ACCOUNT_ID without CLOUDFLARE_EMAIL_API_TOKEN) would leak into
// the first (memoized) build.
const READ_NAMES = [
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_TRANSCRIPTION_MODEL",
  "ADMIN_API_KEY",
  "ASSISTANT_ENABLED",
  "AUTH_PEPPER",
  "CLOUD_TRIAL_ENABLED",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_EMAIL_API_TOKEN",
  "COMPLIMENTARY_PRO_USER_IDS",
  "DATABASE_AUTH_TOKEN",
  "DATABASE_URL",
  "DEPLOYMENT_ENV",
  "EXTENSION_ORIGIN",
  "PRICING_AI_CREDITS_500_BRL_CENTS",
  "PRICING_AI_CREDITS_500_USD_CENTS",
  "PRICING_STORAGE_1GB_12M_BRL_CENTS",
  "PRICING_STORAGE_1GB_12M_USD_CENTS",
  "PRICING_STORAGE_5GB_12M_BRL_CENTS",
  "PRICING_STORAGE_5GB_12M_USD_CENTS",
  "PRICING_YEARLY_BRL_CENTS",
  "PRICING_YEARLY_USD_CENTS",
  "S3_ACCESS_KEY_ID",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_SECRET_ACCESS_KEY",
  "STRIPE_PRICE_AI_CREDITS_500",
  "STRIPE_PRICE_BR_AI_CREDITS_500",
  "STRIPE_PRICE_BR_STORAGE_1GB_12M",
  "STRIPE_PRICE_BR_STORAGE_5GB_12M",
  "STRIPE_PRICE_BR_YEARLY",
  "STRIPE_PRICE_STORAGE_1GB_12M",
  "STRIPE_PRICE_STORAGE_5GB_12M",
  "STRIPE_PRICE_YEARLY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

test("getEdgerCloudEnv memoizes and handleApiRequest answers /api/health", async () => {
  const saved: Record<string, string | undefined> = {};
  for (const name of READ_NAMES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  process.env.DEPLOYMENT_ENV = "local";
  process.env.ADMIN_API_KEY = "env-test-admin-key";
  try {
    const first = getEdgerCloudEnv();
    assert.equal(getEdgerCloudEnv(), first, "the same instance must be returned on every call");
    const response = await handleApiRequest(new Request("http://x/api/health"));
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.service, "pinar");
  } finally {
    for (const name of READ_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});
