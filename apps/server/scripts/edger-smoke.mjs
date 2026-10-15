/**
 * EdgeR artifact smoke: prove the Vite SSR bundle runs in Deno, without a
 * database. Run through the package script so the permissions are exactly
 * `--allow-read=<artifact> --allow-env --deny-net --deny-write`.
 *
 *   deno run --allow-read=dist/edger --allow-env --deny-net --deny-write \
 *     scripts/edger-smoke.mjs dist/edger
 *
 * Prints one line per call (`<method> <path> <status>`) and exits 1 when an
 * expectation fails.
 */
import { pathToFileURL } from "node:url";

const dir = Deno.args[0];
if (!dir) {
  console.error("usage: edger-smoke.mjs <artifact dir>");
  Deno.exit(1);
}

// The smoke proves a clean install: the EdgeR worker starts from the
// manifest's empty env, so scrub the Pinar keys the environment builder
// reads (apps/server/src/server/edger/env.ts) and run without a database.
// `--allow-env` grants the deletes.
const SMOKED_ENV_KEYS = [
  "ADMIN_API_KEY",
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_TRANSCRIPTION_MODEL",
  "AUTH_PEPPER",
  "CLOUD_TRIAL_ENABLED",
  "COMPLIMENTARY_PRO_USER_IDS",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_EMAIL_API_TOKEN",
  "CLOUDFLARE_ORIGIN_SECRET",
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
];
for (const key of SMOKED_ENV_KEYS) Deno.env.delete(key);

const entry = await import(pathToFileURL(`${dir}/server/server.js`).href);
const handler = entry.default?.fetch;
if (typeof handler !== "function") {
  console.error(`${dir}/server/server.js does not default-export fetch`);
  Deno.exit(1);
}

const origin = "http://smoke.test";
let failed = false;

async function expect(method, path, check, headers = {}) {
  const request = new Request(`${origin}${path}`, {
    headers,
    method,
    signal: AbortSignal.timeout(30_000),
  });
  const response = await handler(request);
  console.log(`${method} ${path} ${response.status}`);
  const detail = (await check(response)) ?? null;
  if (detail !== null) {
    console.error(`${method} ${path}: ${detail}`);
    failed = true;
  }
  // Release the response body (streaming SSR responses hold the event loop
  // open until the stream is read or cancelled).
  await response.body?.cancel().catch(() => {});
}

// No Pinar credentials in this environment: the health route answers
// without a database and reports the service name.
await expect("GET", "/api/health", async (response) => {
  if (response.status !== 200) return `expected 200, got ${response.status}`;
  let body;
  try {
    body = await response.json();
  } catch {
    return "body is not JSON";
  }
  if (body.service !== "pinar") return `expected service "pinar", got ${JSON.stringify(body.service)}`;
});

// The SSR entry renders the app shell as HTML.
await expect("GET", "/", async (response) => {
  if (response.status !== 200) return `expected 200, got ${response.status}`;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return `expected text/html, got ${contentType || "(none)"}`;
});

// The cron route must not reveal itself to external traffic: without the
// internal header it answers the EdgeR entry's plain 404 (the TanStack
// not-found page would mean the bundle lost src/edger-server-entry.ts).
await expect("POST", "/_internal/cron/daily", async (response) => {
  if (response.status !== 404) return `expected 404, got ${response.status}`;
  const body = await response.text();
  if (body !== "Not found") return `expected the entry's "Not found", got ${JSON.stringify(body.slice(0, 80))}`;
});

// With the header EdgeR's scheduler sends, the entry runs the four daily
// jobs and reports each one. Without a database they may fail (500); the
// report itself proves the route is wired.
await expect("POST", "/_internal/cron/daily", async (response) => {
  if (response.status !== 200 && response.status !== 500) return `expected 200 or 500, got ${response.status}`;
  let body;
  try {
    body = await response.json();
  } catch {
    return "body is not JSON";
  }
  const jobs = Array.isArray(body.jobs) ? body.jobs.map((job) => job.job) : [];
  const expected = ["cleanupOldRecords", "reconcileBillingEntitlements", "refundStaleAiReservations", "sendStorageExpiryNotices"];
  if (JSON.stringify(jobs) !== JSON.stringify(expected)) return `expected the four daily jobs, got ${JSON.stringify(jobs)}`;
}, { "x-edger-internal": "true" });

// The marketing page renders.
await expect("GET", "/pricing", async (response) => {
  if (response.status !== 200) return `expected 200, got ${response.status}`;
});

// Exit explicitly: the server module may keep handles (pools, streams) that
// would otherwise keep the process alive after the expectations are in.
Deno.exit(failed ? 1 : 0);
