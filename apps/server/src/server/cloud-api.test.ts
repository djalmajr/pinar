import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { FREE_STORAGE_BYTES, STORAGE_5GB_BYTES } from "../lib/entitlements";
import {
  authorizeCloudAppRequest,
  type CloudEnv,
  cleanupOldRecords,
  handleCloudApiRequest,
  handleCloudPublicRequest,
  resetCloudMemoryStateForTests,
  sendStorageExpiryNotices,
  seedCloudAccountForTests,
  seedCloudStorageGrantForTests,
  seedCloudStorageUsageForTests,
  setCloudMigrationFailureForTests,
  setCloudNowForTests,
} from "./cloud-api";
import { exerciseProjectApiContract } from "./project-api.contract";

const identityA = { id: `ins_${"A".repeat(24)}`, token: `pit_${"a".repeat(43)}` };
const identityB = { id: `ins_${"B".repeat(24)}`, token: `pit_${"b".repeat(43)}` };
const identityC = { id: `ins_${"C".repeat(24)}`, token: `pit_${"c".repeat(43)}` };
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function identityHeaders(identity: typeof identityA, extra: HeadersInit = {}) {
  return new Headers({
    authorization: `Bearer ${identity.token}`,
    "x-pinar-installation-id": identity.id,
    ...Object.fromEntries(new Headers(extra)),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonBody(response: Response) {
  const body: unknown = await response.json();
  assert.ok(isRecord(body));
  return body;
}

function sessionIds(body: Record<string, unknown>) {
  assert.ok(Array.isArray(body.sessions));
  return body.sessions.map((session) => {
    assert.ok(isRecord(session));
    assert.equal(typeof session.id, "string");
    return session.id;
  });
}

const TEST_ENV: CloudEnv = {
  AUTH_PEPPER: "test-auth-pepper",
  EXTENSION_ORIGIN: "chrome-extension://pinar-test",
  PRICING_AI_CREDITS_1000_BRL_CENTS: "990",
  PRICING_AI_CREDITS_1000_USD_CENTS: "299",
  PRICING_LIFETIME_BRL_CENTS: "12990",
  PRICING_LIFETIME_USD_CENTS: "3900",
  PRICING_MONTHLY_BRL_CENTS: "490",
  PRICING_MONTHLY_USD_CENTS: "299",
  PRICING_STORAGE_20GB_12M_BRL_CENTS: "2990",
  PRICING_STORAGE_20GB_12M_USD_CENTS: "799",
  PRICING_STORAGE_5GB_12M_BRL_CENTS: "990",
  PRICING_STORAGE_5GB_12M_USD_CENTS: "299",
  PRICING_YEARLY_BRL_CENTS: "3990",
  PRICING_YEARLY_USD_CENTS: "1900",
};

function api(path: string, init: RequestInit = {}, env: CloudEnv = TEST_ENV) {
  return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), env);
}

function requestForCountry(path: string, country: string, init: RequestInit = {}) {
  const request = new Request(`https://pinar.test${path}`, init);
  Object.defineProperty(request, "cf", { value: { country } });
  return request;
}

function register(identity: typeof identityA) {
  return api("/api/installations", {
    body: JSON.stringify({ installationId: identity.id, installationToken: identity.token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function upload(identity: typeof identityA, id: string, title: string) {
  return api("/api/shots", {
    body: JSON.stringify({
      id,
      image: VALID_PNG,
      page: { title, url: `https://example.test/${id}` },
      pins: [{ comment: `Pin for ${title}`, number: 1 }],
    }),
    headers: identityHeaders(identity, { "content-type": "application/json" }),
    method: "POST",
  });
}

function aiEnv(run: (model: string, input: unknown) => Promise<unknown>): CloudEnv {
  return {
    ...TEST_ENV,
    AI: { run } as unknown as Ai,
  };
}

function emailBinding() {
  const codes: string[] = [];
  const binding = {
    async send(message: unknown) {
      if (!isRecord(message) || typeof message.text !== "string") throw new Error("email text missing");
      const code = message.text.match(/\b\d{6}\b/)?.[0];
      if (code) codes.push(code);
      return { messageId: `test-${codes.length}` };
    },
  } as unknown as NonNullable<CloudEnv["EMAIL"]>;
  return { binding, codes };
}

async function requestEmailCode(email: string, env: CloudEnv) {
  return api("/api/auth/email-codes", {
    body: JSON.stringify({ email }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }, env);
}

async function verifyEmailCode(
  email: string,
  code: string,
  env: CloudEnv,
  identity?: typeof identityA,
) {
  return api("/api/auth/email-codes/verify", {
    body: JSON.stringify({
      code,
      email,
      installationId: identity?.id,
      installationToken: identity?.token,
      returnTo: "/app",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }, env);
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("remote installation isolation", () => {
  beforeEach(() => resetCloudMemoryStateForTests());

  test("data and extension-code web sessions remain installation-scoped", async () => {
    assert.equal((await register(identityA)).status, 201);
    assert.equal((await register(identityB)).status, 201);
    assert.equal((await register(identityA)).status, 200);

    assert.equal((await upload(identityA, "session_A_001", "Owner A")).status, 201);
    assert.equal((await upload(identityB, "session_B_001", "Owner B")).status, 201);
    assert.equal((await api("/api/shots", {
      body: JSON.stringify({ id: "broken_session", image: "data:image/png;base64,iVBORw==" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    })).status, 400);

    assert.equal((await api("/api/history")).status, 401);
    assert.equal(await authorizeCloudAppRequest(new Request("https://pinar.test/app"), TEST_ENV), false);

    const historyA = await api("/api/history", { headers: identityHeaders(identityA) });
    assert.deepEqual(sessionIds(await jsonBody(historyA)), ["session_A_001"]);
    const historyB = await api("/api/history", { headers: identityHeaders(identityB) });
    assert.deepEqual(sessionIds(await jsonBody(historyB)), ["session_B_001"]);
    assert.equal((await upload(identityB, "session_A_001", "Overwrite A")).status, 409);

    const codeResponse = await api("/api/auth/extension-codes", {
      headers: identityHeaders(identityA),
      method: "POST",
    });
    assert.equal(codeResponse.status, 201);
    const codeBody = await jsonBody(codeResponse);
    assert.match(String(codeBody.code), /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
    const exchange = await api("/api/auth/extension-codes/exchange", {
      body: JSON.stringify({ code: codeBody.code, returnTo: "/app" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(exchange.status, 200);
    assert.equal((await jsonBody(exchange)).redirectTo, "/app");
    const sessionCookie = exchange.headers.get("set-cookie")?.split(";", 1)[0] || "";
    assert.match(sessionCookie, /^pinar_session=pws_/);
    assert.match(exchange.headers.get("set-cookie") || "", /HttpOnly; Secure; SameSite=Lax/);
    assert.equal((await api("/api/auth/extension-codes/exchange", {
      body: JSON.stringify({ code: codeBody.code }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status, 400);

    const appRequest = new Request("https://pinar.test/app", { headers: { cookie: sessionCookie } });
    assert.equal(await authorizeCloudAppRequest(appRequest, TEST_ENV), true);
    const webHistory = await api("/api/history", { headers: { cookie: sessionCookie } });
    assert.deepEqual(sessionIds(await jsonBody(webHistory)), ["session_A_001"]);

    const publicSession = await api("/api/sessions/session_A_001");
    assert.equal(publicSession.status, 200);
    const markdown = await handleCloudPublicRequest(new Request("https://pinar.test/v/session_A_001.md"), {});
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /Owner A/);

    assert.equal(
      (await api("/api/history/session_A_001", { headers: identityHeaders(identityB), method: "DELETE" })).status,
      404,
    );
    assert.equal(
      (await api("/api/history/session_A_001", { headers: identityHeaders(identityA), method: "DELETE" })).status,
      200,
    );
    assert.deepEqual(
      sessionIds(await jsonBody(await api("/api/history", { headers: identityHeaders(identityA) }))),
      [],
    );
    assert.equal((await api("/api/auth/browser-ticket", { method: "POST" })).status, 404);
    assert.equal((await api("/api/installations/rotate", { method: "POST" })).status, 404);
    assert.equal((await api("/api/auth/verify")).status, 404);
  });

  test("expires extension codes, validates origins and constrains returnTo", async () => {
    setCloudNowForTests("2026-08-16T12:00:00.000Z");
    await register(identityA);
    const created = await jsonBody(await api("/api/auth/extension-codes", {
      headers: identityHeaders(identityA),
      method: "POST",
    }));
    assert.equal((await api("/api/auth/extension-codes", {
      headers: identityHeaders(identityA, { origin: "https://attacker.test" }),
      method: "POST",
    })).status, 403);
    assert.equal((await api("/api/auth/extension-codes", {
      headers: identityHeaders(identityA, { origin: "chrome-extension://attacker" }),
      method: "POST",
    })).status, 403);
    assert.equal((await api("/api/auth/extension-codes", {
      headers: identityHeaders(identityA, { origin: TEST_ENV.EXTENSION_ORIGIN || "" }),
      method: "POST",
    })).status, 201);

    setCloudNowForTests("2026-08-16T12:05:01.000Z");
    assert.equal((await api("/api/auth/extension-codes/exchange", {
      body: JSON.stringify({ code: created.code }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status, 400);

    setCloudNowForTests("2026-08-16T12:06:00.000Z");
    const fresh = await jsonBody(await api("/api/auth/extension-codes", {
      headers: identityHeaders(identityA),
      method: "POST",
    }));
    const exchange = await api("/api/auth/extension-codes/exchange", {
      body: JSON.stringify({ code: fresh.code, returnTo: "//attacker.test" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal((await jsonBody(exchange)).redirectTo, "/app");
  });

  test("rate limits temporary extension codes by installation and IP", async () => {
    await register(identityA);
    for (let index = 0; index < 10; index += 1) {
      assert.equal((await api("/api/auth/extension-codes", {
        headers: identityHeaders(identityA, { "cf-connecting-ip": "192.0.2.10" }),
        method: "POST",
      })).status, 201);
    }
    assert.equal((await api("/api/auth/extension-codes", {
      headers: identityHeaders(identityA, { "cf-connecting-ip": "192.0.2.10" }),
      method: "POST",
    })).status, 429);
  });

  test("does not enumerate accounts and rejects a sixth email-code attempt", async () => {
    const mail = emailBinding();
    const env: CloudEnv = { ...TEST_ENV, EMAIL: mail.binding };
    seedCloudAccountForTests({ email: "paid@example.test", plan: "pro" });
    const known = await requestEmailCode("paid@example.test", env);
    const unknown = await requestEmailCode("unknown@example.test", env);
    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    assert.deepEqual(await jsonBody(known), await jsonBody(unknown));
    assert.equal(mail.codes.length, 1);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await verifyEmailCode("paid@example.test", "000000", env)).status, 400);
    }
    const locked = await verifyEmailCode("paid@example.test", mail.codes[0], env);
    assert.equal(locked.status, 400);
    assert.equal(locked.headers.get("set-cookie"), null);
  });

  test("signs a paid account in directly with a single-use email code", async () => {
    const mail = emailBinding();
    const env: CloudEnv = { ...TEST_ENV, EMAIL: mail.binding };
    seedCloudAccountForTests({ email: "owner@example.test", plan: "lifetime" });
    await requestEmailCode("OWNER@example.test", env);
    const response = await verifyEmailCode("owner@example.test", mail.codes[0], env);
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
    assert.match(cookie, /^pinar_session=pws_/);
    const session = await jsonBody(await api("/api/auth/session", { headers: { cookie } }, env));
    assert.ok(isRecord(session.session));
    assert.equal(session.session.kind, "account");
    assert.equal(session.session.plan, "lifetime");
    assert.equal((await verifyEmailCode("owner@example.test", mail.codes[0], env)).status, 400);
  });

  test("expires email codes after ten minutes", async () => {
    const mail = emailBinding();
    const env: CloudEnv = { ...TEST_ENV, EMAIL: mail.binding };
    setCloudNowForTests("2026-08-16T12:00:00.000Z");
    seedCloudAccountForTests({ email: "expires@example.test", plan: "pro" });
    await requestEmailCode("expires@example.test", env);
    setCloudNowForTests("2026-08-16T12:10:01.000Z");
    const response = await verifyEmailCode("expires@example.test", mail.codes[0], env);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("set-cookie"), null);
  });

  test("atomically migrates a Free tree before issuing a device token", async () => {
    const mail = emailBinding();
    const env: CloudEnv = { ...TEST_ENV, EMAIL: mail.binding };
    await register(identityA);
    const project = await jsonBody(await api("/api/projects", {
      body: JSON.stringify({ name: "Website" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }, env));
    assert.ok(isRecord(project.project));
    const projectId = String(project.project.id);
    const collection = await jsonBody(await api(`/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Review" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }, env));
    assert.ok(isRecord(collection.collection));
    const collectionId = String(collection.collection.id);
    assert.equal((await api("/api/shots", {
      body: JSON.stringify({ collectionId, id: "migrated_session", image: VALID_PNG, page: {}, pins: [] }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }, env)).status, 201);

    seedCloudAccountForTests({ email: "migrate@example.test", plan: "pro" });
    await requestEmailCode("migrate@example.test", env);
    const verified = await verifyEmailCode("migrate@example.test", mail.codes[0], env, identityA);
    assert.equal(verified.status, 200);
    const verifiedBody = await jsonBody(verified);
    assert.ok(isRecord(verifiedBody.device));
    const deviceToken = String(verifiedBody.device.token);
    assert.match(deviceToken, /^pdt_/);

    const deviceHeaders = { authorization: `Bearer ${deviceToken}` };
    const tree = await jsonBody(await api("/api/project-tree", { headers: deviceHeaders }, env));
    assert.ok(isRecord(tree.tree));
    assert.ok(Array.isArray(tree.tree.projects));
    assert.equal(tree.tree.projects.some((item) => isRecord(item) && item.id === projectId), true);
    const migratedProject = tree.tree.projects.find((item) => isRecord(item) && item.id === projectId);
    assert.ok(isRecord(migratedProject));
    assert.ok(Array.isArray(migratedProject.collections));
    assert.equal(migratedProject.collections.some((item) => isRecord(item) && item.id === collectionId), true);
    assert.equal((await api("/api/project-tree", { headers: identityHeaders(identityA) }, env)).status, 401);
    assert.equal((await api("/api/shots", {
      body: JSON.stringify({ id: "account_capture", image: VALID_PNG, page: {}, pins: [] }),
      headers: { ...deviceHeaders, "content-type": "application/json" },
      method: "POST",
    }, env)).status, 201);
  });

  test("keeps Free data intact and emits no token when migration fails", async () => {
    const mail = emailBinding();
    const env: CloudEnv = { ...TEST_ENV, EMAIL: mail.binding };
    await register(identityA);
    await upload(identityA, "atomic_session", "Atomic");
    seedCloudAccountForTests({ email: "atomic@example.test", plan: "pro" });
    await requestEmailCode("atomic@example.test", env);
    setCloudMigrationFailureForTests(true);
    const response = await verifyEmailCode("atomic@example.test", mail.codes[0], env, identityA);
    assert.equal(response.status, 409);
    assert.equal("device" in await jsonBody(response), false);
    assert.deepEqual(
      sessionIds(await jsonBody(await api("/api/history", { headers: identityHeaders(identityA) }, env))),
      ["atomic_session"],
    );
  });

  test("supports multiple devices, logout and 180-day expiry independently", async () => {
    const mail = emailBinding();
    const env: CloudEnv = { ...TEST_ENV, EMAIL: mail.binding };
    setCloudNowForTests("2026-01-01T00:00:00.000Z");
    seedCloudAccountForTests({ email: "devices@example.test", plan: "pro" });
    await register(identityB);
    await register(identityC);
    await requestEmailCode("devices@example.test", env);
    const first = await jsonBody(await verifyEmailCode("devices@example.test", mail.codes.at(-1) || "", env, identityB));
    assert.ok(isRecord(first.device));
    await requestEmailCode("devices@example.test", env);
    const second = await jsonBody(await verifyEmailCode("devices@example.test", mail.codes.at(-1) || "", env, identityC));
    assert.ok(isRecord(second.device));
    const firstHeaders = { authorization: `Bearer ${String(first.device.token)}` };
    const secondHeaders = { authorization: `Bearer ${String(second.device.token)}` };
    assert.equal((await api("/api/auth/session", { headers: firstHeaders }, env)).status, 200);
    assert.equal((await api("/api/auth/session", { headers: secondHeaders }, env)).status, 200);
    assert.equal((await api("/api/auth/logout", { headers: firstHeaders, method: "POST" }, env)).status, 200);
    assert.equal((await api("/api/auth/session", { headers: firstHeaders }, env)).status, 401);
    assert.equal((await api("/api/auth/session", { headers: secondHeaders }, env)).status, 200);
    setCloudNowForTests("2026-07-01T00:00:01.000Z");
    assert.equal((await api("/api/auth/session", { headers: secondHeaders }, env)).status, 401);
  });

  test("keeps login while a signed Stripe cancellation changes the plan to Free", async () => {
    const mail = emailBinding();
    const webhookSecret = "whsec_test";
    const env: CloudEnv = { ...TEST_ENV, EMAIL: mail.binding, STRIPE_WEBHOOK_SECRET: webhookSecret };
    const now = "2026-08-16T12:00:00.000Z";
    setCloudNowForTests(now);
    seedCloudAccountForTests({
      email: "cancel@example.test",
      plan: "pro",
      stripeCustomerId: "cus_cancel",
      stripeSubscriptionId: "sub_cancel",
    });
    await register(identityA);
    await requestEmailCode("cancel@example.test", env);
    const login = await jsonBody(await verifyEmailCode("cancel@example.test", mail.codes[0], env, identityA));
    assert.ok(isRecord(login.device));
    const headers = { authorization: `Bearer ${String(login.device.token)}` };
    const event = JSON.stringify({
      data: { object: { customer: "cus_cancel" } },
      id: "evt_cancel",
      type: "customer.subscription.deleted",
    });
    const timestamp = String(Math.floor(new Date(now).getTime() / 1000));
    const signature = await hmacSha256(webhookSecret, `${timestamp}.${event}`);
    const webhook = await api("/api/stripe/webhook", {
      body: event,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      method: "POST",
    }, env);
    assert.equal(webhook.status, 200);
    const session = await jsonBody(await api("/api/auth/session", { headers }, env));
    assert.ok(isRecord(session.session));
    assert.equal(session.session.plan, "free");
    assert.equal((await api("/api/stripe/webhook", {
      body: event,
      headers: { "stripe-signature": `t=${timestamp},v1=invalid` },
      method: "POST",
    }, env)).status, 400);
  });

  test("creates subscription checkout with dynamic payment methods", async () => {
    const originalFetch = globalThis.fetch;
    let stripeInit: RequestInit | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      stripeInit = init;
      return Response.json({ url: "https://checkout.stripe.test/session" });
    };
    try {
      const response = await handleCloudApiRequest(
        new Request("https://pinar.test/api/stripe/checkout", {
          body: JSON.stringify({ interval: "year" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        {
          STRIPE_PRICE_YEARLY: "price_yearly_test",
          STRIPE_SECRET_KEY: "sk_test_example",
        },
      );
      assert.equal(response.status, 200);
      assert.equal((await jsonBody(response)).url, "https://checkout.stripe.test/session");
    } finally {
      globalThis.fetch = originalFetch;
    }

    const params = new URLSearchParams(String(stripeInit?.body));
    assert.equal(params.get("mode"), "subscription");
    assert.equal(params.get("line_items[0][price]"), "price_yearly_test");
    assert.equal(params.get("metadata[pinar_offer]"), "pro_year");
    assert.equal(params.get("subscription_data[metadata][pinar_offer]"), "pro_year");
    assert.equal(params.has("payment_method_types[0]"), false);
    assert.match(params.get("integration_identifier") || "", /^pinar_web_[a-z]{8}$/);
    const stripeHeaders = new Headers(stripeInit?.headers);
    assert.match(stripeHeaders.get("idempotency-key") || "", /^pinar:checkout:pro_year:[A-Za-z0-9_-]{24}$/);
    assert.equal(stripeHeaders.get("stripe-version"), "2026-07-29.dahlia");
  });

  test("uses the Cloudflare country for Brazil pricing and checkout", async () => {
    // Mutation captured: trusting a client header or body lets callers select another regional price.
    const pricingResponse = await handleCloudApiRequest(
      requestForCountry("/api/pricing?country=US", "BR", {
        headers: { "cf-ipcountry": "US" },
      }),
      TEST_ENV,
    );
    assert.equal(pricingResponse.status, 200);
    assert.equal(pricingResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(pricingResponse.headers.get("vary"), "CF-IPCountry");
    const pricing = await jsonBody(pricingResponse);
    assert.equal(pricing.country, "BR");
    assert.equal(pricing.currency, "BRL");
    assert.ok(isRecord(pricing.prices));
    assert.deepEqual(pricing.prices.year, { amount: 3_990, originalAmount: null });
    assert.deepEqual(pricing.prices.aiCredits1000, { amount: 990, originalAmount: null });

    const originalFetch = globalThis.fetch;
    let stripeInit: RequestInit | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      stripeInit = init;
      return Response.json({ url: "https://checkout.stripe.test/brazil" });
    };
    try {
      const checkoutResponse = await handleCloudApiRequest(
        requestForCountry("/api/stripe/checkout", "BR", {
          body: JSON.stringify({ country: "US", interval: "year" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        {
          ...TEST_ENV,
          STRIPE_PRICE_BR_YEARLY: "price_br_yearly_test",
          STRIPE_PRICE_YEARLY: "price_us_yearly_test",
          STRIPE_SECRET_KEY: "sk_test_example",
        },
      );
      assert.equal(checkoutResponse.status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const params = new URLSearchParams(String(stripeInit?.body));
    assert.equal(params.get("line_items[0][price]"), "price_br_yearly_test");
  });

  test("does not silently charge USD when the Brazil Stripe price is missing", async () => {
    // Mutation captured: falling back to the global price makes the UI show BRL while Stripe charges USD.
    const response = await handleCloudApiRequest(
      requestForCountry("/api/stripe/checkout", "BR", {
        body: JSON.stringify({ interval: "month" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      {
        ...TEST_ENV,
        STRIPE_PRICE_MONTHLY: "price_us_monthly_test",
        STRIPE_SECRET_KEY: "sk_test_example",
      },
    );
    assert.equal(response.status, 500);
    assert.equal((await jsonBody(response)).error, "Stripe price is not configured");
  });

  test("creates one-time add-on checkout with stable offer metadata and idempotency", async () => {
    const originalFetch = globalThis.fetch;
    let stripeInit: RequestInit | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      stripeInit = init;
      return Response.json({ url: "https://checkout.stripe.test/storage" });
    };
    try {
      const response = await api("/api/stripe/checkout", {
        body: JSON.stringify({
          offer: "storage_20gb_12m",
          requestId: "checkout_request_123456",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }, {
        STRIPE_PRICE_STORAGE_20GB_12M: "price_storage_20_test",
        STRIPE_SECRET_KEY: "sk_test_example",
      });
      assert.equal(response.status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const params = new URLSearchParams(String(stripeInit?.body));
    assert.equal(params.get("customer_creation"), "always");
    assert.equal(params.get("line_items[0][price]"), "price_storage_20_test");
    assert.equal(params.get("metadata[pinar_offer]"), "storage_20gb_12m");
    assert.equal(params.get("mode"), "payment");
    assert.equal(
      new Headers(stripeInit?.headers).get("idempotency-key"),
      "pinar:checkout:storage_20gb_12m:checkout_request_123456",
    );
    assert.equal((await api("/api/stripe/checkout", {
      body: JSON.stringify({ offer: "unknown_offer" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, { STRIPE_SECRET_KEY: "sk_test_example" })).status, 400);
  });

  test("turns a confirmed checkout into an account and a 30-day web session", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({
      customer: "cus_checkout",
      customer_details: { email: "checkout@example.test" },
      mode: "subscription",
      payment_status: "paid",
      status: "complete",
      subscription: "sub_checkout",
    });
    try {
      const response = await api("/api/stripe/success?session_id=cs_test", {}, {
        ...TEST_ENV,
        STRIPE_SECRET_KEY: "sk_test_example",
      });
      assert.equal(response.status, 200);
      const body = await jsonBody(response);
      assert.ok(isRecord(body.account));
      assert.equal(body.account.email, "checkout@example.test");
      assert.equal(body.account.plan, "pro");
      const cookieHeader = response.headers.get("set-cookie") || "";
      assert.match(cookieHeader, /Max-Age=2592000/);
      const cookie = cookieHeader.split(";", 1)[0];
      assert.equal((await api("/api/auth/session", { headers: { cookie } })).status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("grants five initial credits and blocks new Free storage above 250 MB", async () => {
    await register(identityA);
    const initial = await jsonBody(await api("/api/account/entitlements", {
      headers: identityHeaders(identityA),
    }));
    assert.ok(isRecord(initial.aiCredits));
    assert.equal(initial.aiCredits.balance, 5);
    assert.ok(isRecord(initial.storage));
    assert.equal(initial.storage.baseBytes, FREE_STORAGE_BYTES);
    assert.equal(initial.storage.quotaBytes, FREE_STORAGE_BYTES);

    seedCloudStorageUsageForTests({
      byteSize: FREE_STORAGE_BYTES - 10,
      ownerId: identityA.id,
    });
    const blocked = await upload(identityA, "new_storage_overage", "Over quota");
    assert.equal(blocked.status, 413);
    assert.equal((await jsonBody(blocked)).code, "storage_quota_exceeded");
    const replacement = await upload(identityA, "seeded_storage_usage", "Smaller replacement");
    assert.equal(replacement.status, 201);
  });

  test("summarizes an owned session once, replays idempotently and refunds failures", async () => {
    const calls: Array<{ input: unknown; model: string }> = [];
    let shouldFail = false;
    const env = aiEnv(async (model, input) => {
      calls.push({ input, model });
      if (shouldFail) throw new Error("upstream unavailable");
      return {
        choices: [{ message: { content: JSON.stringify({
          highlights: ["Clarify the primary action", "Improve contrast"],
          summary: "The annotations focus on clarity and visual hierarchy.",
        }) } }],
        usage: { completion_tokens: 24, prompt_tokens: 120, total_tokens: 144 },
      };
    });
    assert.equal((await register(identityA)).status, 201);
    assert.equal((await upload(identityA, "ai_session_001", "AI owner")).status, 201);

    const request = () => api("/api/ai/session-summary", {
      body: JSON.stringify({
        language: "pt",
        requestId: "ai_summary_request_0001",
        sessionId: "ai_session_001",
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }, env);
    const first = await request();
    assert.equal(first.status, 200);
    const firstBody = await jsonBody(first);
    assert.equal(firstBody.creditsCharged, 1);
    assert.equal(firstBody.idempotent, false);
    assert.ok(isRecord(firstBody.aiCredits));
    assert.equal(firstBody.aiCredits.balance, 4);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "@cf/zai-org/glm-4.7-flash");
    assert.ok(isRecord(calls[0].input));
    assert.ok(Array.isArray(calls[0].input.messages));
    const messages = calls[0].input.messages;
    assert.ok(isRecord(messages[0]));
    assert.match(String(messages[0].content), /untrusted data/);

    const replay = await jsonBody(await request());
    assert.equal(replay.idempotent, true);
    assert.ok(isRecord(replay.aiCredits));
    assert.equal(replay.aiCredits.balance, 4);
    assert.equal(calls.length, 1);

    assert.equal((await upload(identityA, "ai_session_002", "Other resource")).status, 201);
    const conflict = await api("/api/ai/session-summary", {
      body: JSON.stringify({
        requestId: "ai_summary_request_0001",
        sessionId: "ai_session_002",
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }, env);
    assert.equal(conflict.status, 409);
    assert.equal((await jsonBody(conflict)).code, "request_id_conflict");

    shouldFail = true;
    const failed = await api("/api/ai/session-summary", {
      body: JSON.stringify({
        requestId: "ai_summary_request_0002",
        sessionId: "ai_session_001",
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }, env);
    assert.equal(failed.status, 503);
    assert.match(String((await jsonBody(failed)).error), /refunded/i);
    const entitlements = await jsonBody(await api("/api/account/entitlements", {
      headers: identityHeaders(identityA),
    }, env));
    assert.ok(isRecord(entitlements.aiCredits));
    assert.equal(entitlements.aiCredits.balance, 4);
  });

  test("refills 200 Pro credits monthly without rollover on an annual subscription", async () => {
    const originalFetch = globalThis.fetch;
    setCloudNowForTests("2026-01-31T12:30:00.000Z");
    globalThis.fetch = async () => Response.json({
      customer: "cus_annual",
      customer_details: { email: "annual@example.test" },
      id: "cs_annual",
      metadata: { pinar_offer: "pro_year" },
      mode: "subscription",
      payment_status: "paid",
      status: "complete",
      subscription: "sub_annual",
    });
    let cookie = "";
    try {
      const response = await api("/api/stripe/success?session_id=cs_annual", {}, {
        ...TEST_ENV,
        STRIPE_SECRET_KEY: "sk_test_example",
      });
      assert.equal(response.status, 200);
      cookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
    } finally {
      globalThis.fetch = originalFetch;
    }
    const first = await jsonBody(await api("/api/account/entitlements", { headers: { cookie } }));
    assert.ok(isRecord(first.aiCredits));
    assert.equal(first.aiCredits.balance, 200);
    assert.equal(first.aiCredits.nextExpiryAt, "2026-02-28T12:30:00.000Z");

    setCloudNowForTests("2026-02-28T12:30:00.000Z");
    const renewed = await jsonBody(await api("/api/account/entitlements", { headers: { cookie } }));
    assert.ok(isRecord(renewed.aiCredits));
    assert.equal(renewed.aiCredits.balance, 200);
    assert.equal(renewed.aiCredits.nextExpiryAt, "2026-03-28T12:30:00.000Z");
    const duplicate = await jsonBody(await api("/api/account/entitlements", { headers: { cookie } }));
    assert.ok(isRecord(duplicate.aiCredits));
    assert.equal(duplicate.aiCredits.balance, 200);
  });

  test("fulfills a storage add-on once across webhook retries and success polling", async () => {
    const webhookSecret = "whsec_test";
    const now = "2026-03-01T00:00:00.000Z";
    setCloudNowForTests(now);
    seedCloudAccountForTests({
      email: "storage@example.test",
      everPaid: false,
      id: "usr_storage_existing",
      plan: "free",
    });
    seedCloudStorageUsageForTests({
      byteSize: 1024,
      ownerId: "usr_storage_existing",
      sessionId: "storage_existing_session",
    });
    const checkoutSession = {
      customer: "cus_storage",
      customer_details: { email: "storage@example.test" },
      id: "cs_storage",
      metadata: { pinar_offer: "storage_5gb_12m" },
      mode: "payment",
      payment_status: "paid",
      status: "complete",
    };
    const event = JSON.stringify({
      data: { object: checkoutSession },
      id: "evt_storage",
      type: "checkout.session.completed",
    });
    const timestamp = String(Math.floor(new Date(now).getTime() / 1000));
    const signature = await hmacSha256(webhookSecret, `${timestamp}.${event}`);
    const env: CloudEnv = { ...TEST_ENV, STRIPE_WEBHOOK_SECRET: webhookSecret };
    assert.equal((await api("/api/stripe/webhook", {
      body: event,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      method: "POST",
    }, env)).status, 200);
    const duplicateWebhook = await jsonBody(await api("/api/stripe/webhook", {
      body: event,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      method: "POST",
    }, env));
    assert.equal(duplicateWebhook.duplicate, true);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json(checkoutSession);
    let cookie = "";
    try {
      const success = await api("/api/stripe/success?session_id=cs_storage", {}, {
        ...env,
        STRIPE_SECRET_KEY: "sk_test_example",
      });
      assert.equal(success.status, 200);
      cookie = success.headers.get("set-cookie")?.split(";", 1)[0] || "";
    } finally {
      globalThis.fetch = originalFetch;
    }
    const entitlements = await jsonBody(await api("/api/account/entitlements", { headers: { cookie } }));
    assert.equal(entitlements.plan, "free");
    assert.ok(isRecord(entitlements.storage));
    assert.equal(entitlements.storage.activeAddOnBytes, STORAGE_5GB_BYTES);
    assert.equal(entitlements.storage.nextExpiryAt, "2027-03-01T00:00:00.000Z");
    assert.equal(entitlements.storage.quotaBytes, FREE_STORAGE_BYTES + STORAGE_5GB_BYTES);
    const preserved = await jsonBody(await api("/api/sessions/storage_existing_session"));
    assert.ok(isRecord(preserved.session));
    assert.equal(preserved.session.isPermanent, true);

    const addedDuringPack = await api("/api/shots", {
      body: JSON.stringify({
        id: "storage_pack_session",
        image: VALID_PNG,
        page: { title: "Stored during pack", url: "https://example.test/storage-pack" },
        pins: [],
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    }, env);
    assert.equal(addedDuringPack.status, 201);
    assert.equal((await jsonBody(addedDuringPack)).isPermanent, true);
  });

  test("sends storage expiry notices at 30, 7 and 1 days without deleting content", async () => {
    const userId = "usr_storage_notice";
    const expiresAt = "2027-06-30T12:00:00.000Z";
    setCloudNowForTests("2027-05-31T12:00:00.000Z");
    seedCloudAccountForTests({
      email: "storage-notice@example.test",
      id: userId,
      plan: "pro",
    });
    seedCloudStorageGrantForTests({ expiresAt, userId });
    seedCloudStorageUsageForTests({
      byteSize: 1024,
      ownerId: userId,
      sessionId: "storage_notice_session",
    });
    const sent: Array<Record<string, unknown>> = [];
    const env: CloudEnv = {
      ...TEST_ENV,
      EMAIL: {
        async send(message: unknown) {
          assert.ok(isRecord(message));
          sent.push(message);
          return { messageId: `notice-${sent.length}` };
        },
      } as unknown as NonNullable<CloudEnv["EMAIL"]>,
    };

    assert.deepEqual(await sendStorageExpiryNotices(env), { delivered: 1, failed: 0, pending: 0 });
    assert.match(String(sent[0].subject), /30 days/);
    assert.match(String(sent[0].text), /not be automatically deleted/i);
    assert.equal((await sendStorageExpiryNotices(env)).delivered, 0);

    setCloudNowForTests("2027-06-23T12:00:00.000Z");
    assert.equal((await sendStorageExpiryNotices(env)).delivered, 1);
    assert.match(String(sent[1].subject), /7 days/);

    setCloudNowForTests("2027-06-29T12:00:00.000Z");
    assert.equal((await sendStorageExpiryNotices(env)).delivered, 1);
    assert.match(String(sent[2].subject), /1 day$/);

    setCloudNowForTests("2027-07-01T12:00:00.000Z");
    assert.equal((await sendStorageExpiryNotices(env)).delivered, 0);
    assert.equal(sent.length, 3);
    assert.equal((await api("/api/sessions/storage_notice_session")).status, 200);
  });

  test("keeps the subscription customer when a signed-out account buys an add-on", async () => {
    const email = "existing@example.test";
    seedCloudAccountForTests({
      email,
      plan: "pro",
      stripeCustomerId: "cus_subscription",
      stripeSubscriptionId: "sub_existing",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({
      customer: "cus_addon_checkout",
      customer_details: { email },
      id: "cs_existing_addon",
      metadata: { pinar_offer: "ai_credits_1000" },
      mode: "payment",
      payment_status: "paid",
      status: "complete",
    });
    let cookie = "";
    try {
      const success = await api("/api/stripe/success?session_id=cs_existing_addon", {}, {
        ...TEST_ENV,
        STRIPE_SECRET_KEY: "sk_test_example",
      });
      cookie = success.headers.get("set-cookie")?.split(";", 1)[0] || "";
    } finally {
      globalThis.fetch = originalFetch;
    }

    const webhookSecret = "whsec_test";
    const now = "2026-08-17T12:00:00.000Z";
    setCloudNowForTests(now);
    const event = JSON.stringify({
      data: { object: { customer: "cus_subscription" } },
      id: "evt_existing_cancel",
      type: "customer.subscription.deleted",
    });
    const timestamp = String(Math.floor(new Date(now).getTime() / 1000));
    const signature = await hmacSha256(webhookSecret, `${timestamp}.${event}`);
    assert.equal((await api("/api/stripe/webhook", {
      body: event,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      method: "POST",
    }, { ...TEST_ENV, STRIPE_WEBHOOK_SECRET: webhookSecret })).status, 200);
    const auth = await jsonBody(await api("/api/auth/session", { headers: { cookie } }));
    assert.ok(isRecord(auth.session));
    assert.equal(auth.session.plan, "free");
  });

  test("fulfills Lifetime and purchased AI credits without duplicate grants", async () => {
    const originalFetch = globalThis.fetch;
    setCloudNowForTests("2026-04-30T12:30:00.000Z");
    const sessions = [
      {
        customer: "cus_lifetime",
        customer_details: { email: "lifetime@example.test" },
        id: "cs_lifetime",
        metadata: { pinar_offer: "lifetime_founder" },
        mode: "payment",
        payment_status: "paid",
        status: "complete",
      },
      {
        customer: "cus_ai",
        customer_details: { email: "ai@example.test" },
        id: "cs_ai",
        metadata: { pinar_offer: "ai_credits_1000" },
        mode: "payment",
        payment_status: "paid",
        status: "complete",
      },
    ];
    let index = 0;
    globalThis.fetch = async () => Response.json(sessions[index]);
    try {
      const lifetime = await api("/api/stripe/success?session_id=cs_lifetime", {}, {
        ...TEST_ENV,
        STRIPE_SECRET_KEY: "sk_test_example",
      });
      const lifetimeCookie = lifetime.headers.get("set-cookie")?.split(";", 1)[0] || "";
      const lifetimeEntitlements = await jsonBody(await api(
        "/api/account/entitlements",
        { headers: { cookie: lifetimeCookie } },
      ));
      assert.equal(lifetimeEntitlements.plan, "lifetime");
      assert.ok(isRecord(lifetimeEntitlements.aiCredits));
      assert.equal(lifetimeEntitlements.aiCredits.balance, 500);

      index = 1;
      const ai = await api("/api/stripe/success?session_id=cs_ai", {}, {
        ...TEST_ENV,
        STRIPE_SECRET_KEY: "sk_test_example",
      });
      const aiCookie = ai.headers.get("set-cookie")?.split(";", 1)[0] || "";
      assert.equal((await api("/api/stripe/success?session_id=cs_ai", {}, {
        ...TEST_ENV,
        STRIPE_SECRET_KEY: "sk_test_example",
      })).status, 200);
      const aiEntitlements = await jsonBody(await api(
        "/api/account/entitlements",
        { headers: { cookie: aiCookie } },
      ));
      assert.ok(isRecord(aiEntitlements.aiCredits));
      assert.equal(aiEntitlements.aiCredits.balance, 1_000);
      assert.equal(aiEntitlements.aiCredits.nextExpiryAt, "2027-04-30T12:30:00.000Z");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("isolates project trees and safely resolves foreign capture destinations", async () => {
    // Mutation captured: resolving a collection by id without owner scope lets installation B write into A's tree.
    await register(identityA);
    await register(identityB);

    const treeA = await jsonBody(await api("/api/project-tree", { headers: identityHeaders(identityA) }));
    assert.ok(isRecord(treeA.tree));
    assert.ok(Array.isArray(treeA.tree.projects));
    const personalA = treeA.tree.projects[0];
    assert.ok(isRecord(personalA));
    assert.ok(Array.isArray(personalA.collections));
    const inboxA = personalA.collections[0];
    assert.ok(isRecord(inboxA));

    const projectResponse = await api("/api/projects", {
      body: JSON.stringify({ name: "Website" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    assert.equal(projectResponse.status, 201);
    const projectBody = await jsonBody(projectResponse);
    assert.ok(isRecord(projectBody.project));
    const projectId = String(projectBody.project.id);

    const collectionResponse = await api(`/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Review" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    assert.equal(collectionResponse.status, 201);
    const collectionBody = await jsonBody(collectionResponse);
    assert.ok(isRecord(collectionBody.collection));
    const collectionId = String(collectionBody.collection.id);

    assert.equal((await api(`/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Foreign" }),
      headers: identityHeaders(identityB, { "content-type": "application/json" }),
      method: "POST",
    })).status, 404);

    const uploadA = await api("/api/shots", {
      body: JSON.stringify({ collectionId, id: "session_A_tree", image: VALID_PNG, page: {}, pins: [] }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    const uploadABody = await jsonBody(uploadA);
    assert.ok(isRecord(uploadABody.destination));
    assert.equal(uploadABody.destination.collectionId, collectionId);
    const projectMarkdown = await handleCloudPublicRequest(
      new Request(`https://pinar.test/p/${projectId}.md`),
      {},
    );
    assert.equal(projectMarkdown.status, 200);
    assert.match(await projectMarkdown.text(), /session_A_tree/);

    const uploadB = await api("/api/shots", {
      body: JSON.stringify({ collectionId, id: "session_B_tree", image: VALID_PNG, page: {}, pins: [] }),
      headers: identityHeaders(identityB, { "content-type": "application/json" }),
      method: "POST",
    });
    const uploadBBody = await jsonBody(uploadB);
    assert.ok(isRecord(uploadBBody.destination));
    assert.notEqual(uploadBBody.destination.collectionId, collectionId);

    assert.equal((await api("/api/sessions/session_B_tree/move", {
      body: JSON.stringify({ collectionId }),
      headers: identityHeaders(identityB, { "content-type": "application/json" }),
      method: "POST",
    })).status, 404);

    const privateTreeB = await jsonBody(await api("/api/project-tree", { headers: identityHeaders(identityB) }));
    assert.ok(isRecord(privateTreeB.tree));
    assert.ok(Array.isArray(privateTreeB.tree.projects));
    assert.equal(privateTreeB.tree.projects.some((project) => isRecord(project) && project.id === projectId), false);

    assert.equal((await api(`/api/projects/${projectId}`, {
      headers: identityHeaders(identityA),
      method: "DELETE",
    })).status, 200);
    const preserved = await jsonBody(await api("/api/sessions/session_A_tree"));
    assert.ok(isRecord(preserved.session));
    assert.equal(preserved.session.collectionId, inboxA.id);
  });

  test("expiration removes sessions from live aggregates but keeps empty containers", async () => {
    await register(identityA);
    const projectBody = await jsonBody(await api("/api/projects", {
      body: JSON.stringify({ name: "Archive" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }));
    assert.ok(isRecord(projectBody.project));
    const projectId = String(projectBody.project.id);
    const collectionBody = await jsonBody(await api(`/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Expired" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }));
    assert.ok(isRecord(collectionBody.collection));
    const collectionId = String(collectionBody.collection.id);

    const response = await api("/api/shots", {
      body: JSON.stringify({
        collectionId,
        createdAt: "2020-01-01T00:00:00.000Z",
        id: "expired_session",
        image: VALID_PNG,
        page: { title: "Expired session" },
        pins: [],
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    assert.equal(response.status, 201);
    assert.equal((await cleanupOldRecords({}, 7)).deletedCount, 1);

    const treeBody = await jsonBody(await api("/api/project-tree", { headers: identityHeaders(identityA) }));
    assert.ok(isRecord(treeBody.tree));
    assert.ok(Array.isArray(treeBody.tree.projects));
    const project = treeBody.tree.projects.find((item) => isRecord(item) && item.id === projectId);
    assert.ok(isRecord(project));
    assert.ok(Array.isArray(project.collections));
    const collection = project.collections.find((item) => isRecord(item) && item.id === collectionId);
    assert.ok(isRecord(collection));
    assert.deepEqual(collection.sessions, []);

    const markdown = await handleCloudPublicRequest(
      new Request(`https://pinar.test/c/${collectionId}.md`),
      {},
    );
    assert.equal(markdown.status, 200);
    assert.doesNotMatch(await markdown.text(), /expired_session/);
  });

  test("matches the shared projects and collections API contract", async () => {
    await register(identityA);
    await exerciseProjectApiContract((path, init = {}) => api(path, {
      ...init,
      headers: identityHeaders(identityA, init.headers),
    }));
  });
});
