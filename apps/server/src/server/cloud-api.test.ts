import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  authorizeCloudAppRequest,
  type CloudEnv,
  cleanupOldRecords,
  handleCloudApiRequest,
  handleCloudPublicRequest,
  resetCloudMemoryStateForTests,
  seedCloudAccountForTests,
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
  PRICING_BR_DISCOUNT_PERCENT: "35",
  PRICING_BR_EXCHANGE_RATE: "5.2014",
  PRICING_LIFETIME_USD_CENTS: "4900",
  PRICING_MONTHLY_USD_CENTS: "290",
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
    assert.equal(params.has("payment_method_types[0]"), false);
    assert.match(params.get("integration_identifier") || "", /^pinar_web_[a-z]{8}$/);
    assert.equal(new Headers(stripeInit?.headers).get("stripe-version"), "2026-07-29.dahlia");
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
    assert.deepEqual(pricing.prices.year, { amount: 6_490, originalAmount: 9_883 });

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
