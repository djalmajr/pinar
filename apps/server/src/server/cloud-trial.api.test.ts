import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, test } from "node:test";
import { CURRENT_LEGAL_VERSION } from "../lib/legal-documents";
import {
  type CloudEnv,
  handleCloudApiRequest,
  handleCloudPublicRequest,
  resetCloudMemoryStateForTests,
  seedCloudAccountForTests,
  seedCloudStorageGrantForTests,
  setCloudNowForTests,
} from "./cloud-api";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const LEGAL = {
  acceptableUseVersion: CURRENT_LEGAL_VERSION,
  accepted: true,
  locale: "en",
  privacyVersion: CURRENT_LEGAL_VERSION,
  termsVersion: CURRENT_LEGAL_VERSION,
};
const PRICING = {
  PRICING_AI_CREDITS_500_BRL_CENTS: "990",
  PRICING_AI_CREDITS_500_USD_CENTS: "299",
  PRICING_STORAGE_1GB_12M_BRL_CENTS: "990",
  PRICING_STORAGE_1GB_12M_USD_CENTS: "299",
  PRICING_STORAGE_5GB_12M_BRL_CENTS: "2990",
  PRICING_STORAGE_5GB_12M_USD_CENTS: "799",
  PRICING_YEARLY_BRL_CENTS: "9900",
  PRICING_YEARLY_USD_CENTS: "2900",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonBody(response: Response) {
  const body: unknown = await response.json();
  assert.ok(isRecord(body));
  return body;
}

function api(path: string, init: RequestInit = {}, env: CloudEnv = {}) {
  return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), env);
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

function trialEnv(extra: CloudEnv = {}): CloudEnv {
  return {
    AUTH_PEPPER: "test-auth-pepper",
    CLOUD_TRIAL_ENABLED: "true",
    ...PRICING,
    ...extra,
  };
}

async function signUp(email: string, env: CloudEnv) {
  const mail = emailBinding();
  const signed = { ...env, EMAIL: mail.binding };
  assert.equal((await api("/api/auth/email-codes", {
    body: JSON.stringify({ email }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }, signed)).status, 202);
  const verified = await api("/api/auth/email-codes/verify", {
    body: JSON.stringify({ code: mail.codes[0], email, legalAcceptance: LEGAL, returnTo: "/app" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }, signed);
  assert.equal(verified.status, 200);
  const cookie = verified.headers.get("set-cookie")?.split(";", 1)[0] || "";
  assert.match(cookie, /^pinar_session=/);
  return { cookie, env: signed };
}

function shot(cookie: string, id: string, env: CloudEnv) {
  return api("/api/shots", {
    body: JSON.stringify({
      id,
      image: VALID_PNG,
      page: { title: id, url: `https://example.test/${id}` },
      pins: [{ comment: "note", number: 1 }],
    }),
    headers: { cookie, "content-type": "application/json" },
    method: "POST",
  }, env);
}

function history(cookie: string, id: string, env: CloudEnv) {
  return api("/api/history", {
    body: JSON.stringify({
      id,
      page: { title: id, url: `https://example.test/${id}` },
      pins: [{ comment: "note", number: 1 }],
    }),
    headers: { cookie, "content-type": "application/json" },
    method: "POST",
  }, env);
}

function sqliteD1(db: Database): NonNullable<CloudEnv["DB"]> {
  const statement = (query: string) => {
    let params: unknown[] = [];
    const bound = {
      async all() {
        return { results: db.query(query).all(...params) as Record<string, unknown>[] };
      },
      bind(...values: unknown[]) {
        params = values.map((value) => value === undefined ? null : value);
        return bound;
      },
      async first() {
        return (db.query(query).get(...params) as Record<string, unknown> | null) ?? null;
      },
      async run() {
        db.query(query).run(...params);
        const changes = db.query("SELECT changes() AS changes").get() as { changes: number };
        return { meta: { changes: changes.changes } };
      },
    };
    return bound;
  };
  return {
    async batch(statements) {
      const results = [];
      for (const item of statements) results.push(await item.run());
      return results;
    },
    prepare(query: string) {
      return statement(query);
    },
  };
}

function migratedDatabase() {
  const db = new Database(":memory:");
  const directory = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

describe("cloud trial writes", () => {
  beforeEach(() => resetCloudMemoryStateForTests());

  test("persists a 14-day window for a new account and leaves a legacy account untouched", async () => {
    setCloudNowForTests("2026-09-25T10:00:00.000Z");
    const env = trialEnv();
    const created = await signUp("new@example.test", env);
    const entitlements = await jsonBody(await api("/api/account/entitlements", {
      headers: { cookie: created.cookie },
    }, created.env));
    assert.deepEqual(entitlements.trial, {
      endsAt: "2026-10-09T10:00:00.000Z",
      startedAt: "2026-09-25T10:00:00.000Z",
      state: "active",
      uploadAllowed: true,
    });
    assert.equal((entitlements.storage as { uploadAllowed: boolean }).uploadAllowed, true);

    const again = await signUp("new@example.test", env);
    const reread = await jsonBody(await api("/api/account/entitlements", {
      headers: { cookie: again.cookie },
    }, again.env));
    assert.equal((reread.trial as { startedAt: string }).startedAt, "2026-09-25T10:00:00.000Z");

    seedCloudAccountForTests({
      email: "legacy@example.test",
      everPaid: false,
      id: "usr_legacy_account",
      plan: "free",
    });
    const legacyMail = emailBinding();
    const legacyEnv = { ...env, EMAIL: legacyMail.binding };
    assert.equal((await api("/api/auth/email-codes", {
      body: JSON.stringify({ email: "legacy@example.test" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, legacyEnv)).status, 202);
    const legacyLogin = await api("/api/auth/email-codes/verify", {
      body: JSON.stringify({
        code: legacyMail.codes[0],
        email: "legacy@example.test",
        legalAcceptance: LEGAL,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, legacyEnv);
    const legacyCookie = legacyLogin.headers.get("set-cookie")?.split(";", 1)[0] || "";
    const legacy = await jsonBody(await api("/api/account/entitlements", {
      headers: { cookie: legacyCookie },
    }, legacyEnv));
    assert.equal((legacy.trial as { state: string }).state, "legacy");
    assert.equal((legacy.trial as { startedAt: string | null }).startedAt, null);
    assert.equal((await shot(legacyCookie, "legacy_shot_0001", legacyEnv)).status, 201);
  });

  test("allows writes until the end instant and then returns a stable 402 without deleting data", async () => {
    setCloudNowForTests("2026-09-25T10:00:00.000Z");
    const env = trialEnv();
    const { cookie } = await signUp("trial@example.test", env);
    assert.equal((await shot(cookie, "trial_shot_00001", env)).status, 201);
    assert.equal((await history(cookie, "trial_hist_00001", env)).status, 201);

    setCloudNowForTests("2026-10-09T09:59:59.999Z");
    assert.equal((await shot(cookie, "trial_shot_00002", env)).status, 201);
    assert.equal((await history(cookie, "trial_hist_00002", env)).status, 201);

    setCloudNowForTests("2026-10-09T10:00:00.000Z");
    const deniedShot = await shot(cookie, "trial_shot_00003", env);
    const deniedHistory = await history(cookie, "trial_hist_00003", env);
    assert.equal(deniedShot.status, 402);
    assert.equal(deniedHistory.status, 402);
    const shotBody = await jsonBody(deniedShot);
    const historyBody = await jsonBody(deniedHistory);
    const trial = {
      endsAt: "2026-10-09T10:00:00.000Z",
      startedAt: "2026-09-25T10:00:00.000Z",
      state: "expired",
      uploadAllowed: false,
    };
    assert.deepEqual(shotBody, {
      code: "cloud_subscription_required",
      error: "Cloud subscription required",
      trial,
    });
    assert.deepEqual(historyBody, shotBody);

    const listed = await jsonBody(await api("/api/history", { headers: { cookie } }, env));
    assert.ok(Array.isArray(listed.sessions));
    assert.deepEqual(listed.sessions.map((session) => (session as { id: string }).id).sort(), [
      "trial_hist_00001",
      "trial_hist_00002",
      "trial_shot_00001",
      "trial_shot_00002",
    ]);
    const markdown = await handleCloudPublicRequest(
      new Request("https://pinar.test/v/trial_shot_00001.md", { headers: { cookie } }),
      env,
    );
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /trial_shot_00001/);
    assert.equal(markdown.headers.get("cache-control"), "private, no-store");
    const entitlements = await jsonBody(await api("/api/account/entitlements", {
      headers: { cookie },
    }, env));
    assert.equal((entitlements.storage as { uploadAllowed: boolean }).uploadAllowed, false);
    assert.equal((await api("/api/auth/session", { headers: { cookie } }, env)).status, 200);
    assert.equal((await api("/api/history/trial_hist_00002", {
      headers: { cookie },
      method: "DELETE",
    }, env)).status, 200);
    const afterDelete = await jsonBody(await api("/api/history", { headers: { cookie } }, env));
    assert.equal((afterDelete.sessions as unknown[]).length, 3);
  });

  test("lets Pro and flag-off accounts write, and does not let a storage add-on bypass expiry", async () => {
    setCloudNowForTests("2026-10-09T10:00:00.000Z");
    const env = trialEnv();
    seedCloudAccountForTests({
      cloudTrialEndsAt: "2026-10-09T10:00:00.000Z",
      cloudTrialStartedAt: "2026-09-25T10:00:00.000Z",
      email: "pro@example.test",
      id: "usr_trial_pro",
      plan: "pro",
    });
    const proMail = emailBinding();
    const proEnv = { ...env, EMAIL: proMail.binding };
    assert.equal((await api("/api/auth/email-codes", {
      body: JSON.stringify({ email: "pro@example.test" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, proEnv)).status, 202);
    const proLogin = await api("/api/auth/email-codes/verify", {
      body: JSON.stringify({ code: proMail.codes[0], email: "pro@example.test", legalAcceptance: LEGAL }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, proEnv);
    const proCookie = proLogin.headers.get("set-cookie")?.split(";", 1)[0] || "";
    const proEntitlements = await jsonBody(await api("/api/account/entitlements", {
      headers: { cookie: proCookie },
    }, proEnv));
    assert.equal((proEntitlements.trial as { state: string }).state, "paid");
    assert.equal((await shot(proCookie, "pro_shot_000001", proEnv)).status, 201);

    seedCloudAccountForTests({
      cloudTrialEndsAt: "2026-10-09T10:00:00.000Z",
      cloudTrialStartedAt: "2026-09-25T10:00:00.000Z",
      email: "addon@example.test",
      everPaid: true,
      id: "usr_trial_addon",
      plan: "free",
    });
    seedCloudStorageGrantForTests({
      expiresAt: "2027-10-09T10:00:00.000Z",
      userId: "usr_trial_addon",
    });
    const addonMail = emailBinding();
    const addonEnv = { ...env, EMAIL: addonMail.binding };
    assert.equal((await api("/api/auth/email-codes", {
      body: JSON.stringify({ email: "addon@example.test" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, addonEnv)).status, 202);
    const addonLogin = await api("/api/auth/email-codes/verify", {
      body: JSON.stringify({
        code: addonMail.codes[0],
        email: "addon@example.test",
        legalAcceptance: LEGAL,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, addonEnv);
    const addonCookie = addonLogin.headers.get("set-cookie")?.split(";", 1)[0] || "";
    assert.equal((await shot(addonCookie, "addon_shot_0001", addonEnv)).status, 402);

    setCloudNowForTests("2026-09-25T10:00:00.000Z");
    const off = await signUp("off@example.test", { ...trialEnv(), CLOUD_TRIAL_ENABLED: "TRUE" });
    const offEntitlements = await jsonBody(await api("/api/account/entitlements", {
      headers: { cookie: off.cookie },
    }, off.env));
    assert.equal((offEntitlements.trial as { state: string }).state, "disabled");
    assert.equal((offEntitlements.trial as { startedAt: string | null }).startedAt, null);
    setCloudNowForTests("2026-10-24T10:00:00.000Z");
    assert.equal((await shot(off.cookie, "off_shot_000001", off.env)).status, 201);
    const pricing = await jsonBody(await api("/api/pricing", {}, off.env));
    assert.equal(pricing.trialEnabled, false);
    assert.equal(pricing.currency, "USD");
    const enabledPricing = await jsonBody(await api("/api/pricing", {}, trialEnv()));
    assert.equal(enabledPricing.trialEnabled, true);
    assert.deepEqual(enabledPricing.prices, pricing.prices);
  });

  test("stores the trial window in D1 and does not infer it for a legacy row", async () => {
    const sqlite = migratedDatabase();
    try {
      sqlite.exec(
        "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) "
        + "VALUES ('usr_d1_legacy', 'legacy-d1@example.test', 'free', 0, 'active', "
        + "'2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')",
      );
      setCloudNowForTests("2026-09-25T10:00:00.000Z");
      const env = trialEnv({ DB: sqliteD1(sqlite) });
      const created = await signUp("new-d1@example.test", env);
      const row = sqlite.query(
        "SELECT cloud_trial_started_at, cloud_trial_ends_at FROM users WHERE email = ?",
      ).get("new-d1@example.test") as { cloud_trial_ends_at: string; cloud_trial_started_at: string };
      assert.equal(row.cloud_trial_started_at, "2026-09-25T10:00:00.000Z");
      assert.equal(row.cloud_trial_ends_at, "2026-10-09T10:00:00.000Z");

      resetCloudMemoryStateForTests();
      setCloudNowForTests("2026-09-26T10:00:00.000Z");
      const restarted = trialEnv({ DB: sqliteD1(sqlite) });
      const afterRestart = await jsonBody(await api("/api/account/entitlements", {
        headers: { cookie: created.cookie },
      }, restarted));
      assert.equal((afterRestart.trial as { startedAt: string }).startedAt, "2026-09-25T10:00:00.000Z");
      assert.equal((afterRestart.trial as { state: string }).state, "active");

      const legacy = sqlite.query(
        "SELECT cloud_trial_started_at, cloud_trial_ends_at FROM users WHERE id = 'usr_d1_legacy'",
      ).get() as { cloud_trial_ends_at: string | null; cloud_trial_started_at: string | null };
      assert.equal(legacy.cloud_trial_started_at, null);
      assert.equal(legacy.cloud_trial_ends_at, null);
      const legacyMail = emailBinding();
      const legacyEnv = { ...restarted, EMAIL: legacyMail.binding };
      assert.equal((await api("/api/auth/email-codes", {
        body: JSON.stringify({ email: "legacy-d1@example.test" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }, legacyEnv)).status, 202);
      const legacyLogin = await api("/api/auth/email-codes/verify", {
        body: JSON.stringify({
          code: legacyMail.codes[0],
          email: "legacy-d1@example.test",
          legalAcceptance: LEGAL,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }, legacyEnv);
      const legacyCookie = legacyLogin.headers.get("set-cookie")?.split(";", 1)[0] || "";
      const legacyEntitlements = await jsonBody(await api("/api/account/entitlements", {
        headers: { cookie: legacyCookie },
      }, legacyEnv));
      assert.equal((legacyEntitlements.trial as { state: string }).state, "legacy");
      assert.equal((await history(legacyCookie, "legacy_d1_hist1", legacyEnv)).status, 201);
      const stillLegacy = sqlite.query(
        "SELECT cloud_trial_started_at FROM users WHERE id = 'usr_d1_legacy'",
      ).get() as { cloud_trial_started_at: string | null };
      assert.equal(stillLegacy.cloud_trial_started_at, null);
    } finally {
      sqlite.close();
    }
  });

  test("assigns the window on a new Stripe account and keeps an existing account unchanged", async () => {
    setCloudNowForTests("2026-09-25T10:00:00.000Z");
    const env = trialEnv({ STRIPE_SECRET_KEY: "sk_test_example" });
    const checkoutClaim = "checkout_claim_trial_0001";
    const claimHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(checkoutClaim))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const session = {
      consent: { terms_of_service: "accepted" },
      customer: "cus_trial_new",
      customer_details: { email: "stripe-new@example.test" },
      id: "cs_trial_new",
      metadata: {
        pinar_acceptable_use_version: CURRENT_LEGAL_VERSION,
        pinar_checkout_claim_hash: claimHash,
        pinar_locale: "en",
        pinar_offer: "storage_1gb_12m",
        pinar_privacy_version: CURRENT_LEGAL_VERSION,
        pinar_terms_version: CURRENT_LEGAL_VERSION,
      },
      mode: "payment",
      payment_status: "paid",
      status: "complete",
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json(session);
    try {
      const created = await api(`/api/stripe/success?session_id=cs_trial_new&claim=${checkoutClaim}`, {}, env);
      assert.equal(created.status, 200);
      const cookie = created.headers.get("set-cookie")?.split(";", 1)[0] || "";
      const entitlements = await jsonBody(await api("/api/account/entitlements", {
        headers: { cookie },
      }, env));
      assert.equal(entitlements.plan, "free");
      assert.deepEqual(entitlements.trial, {
        endsAt: "2026-10-09T10:00:00.000Z",
        startedAt: "2026-09-25T10:00:00.000Z",
        state: "active",
        uploadAllowed: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    seedCloudAccountForTests({
      email: "stripe-legacy@example.test",
      everPaid: false,
      id: "usr_stripe_legacy",
      plan: "free",
    });
    const existingClaim = "checkout_claim_trial_0002";
    const existingHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(existingClaim))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    globalThis.fetch = async () => Response.json({
      ...session,
      customer: "cus_trial_legacy",
      customer_details: { email: "stripe-legacy@example.test" },
      id: "cs_trial_legacy",
      metadata: { ...session.metadata, pinar_checkout_claim_hash: existingHash },
    });
    try {
      const updated = await api(
        `/api/stripe/success?session_id=cs_trial_legacy&claim=${existingClaim}`,
        {},
        env,
      );
      assert.equal(updated.status, 200);
      const cookie = updated.headers.get("set-cookie")?.split(";", 1)[0] || "";
      const entitlements = await jsonBody(await api("/api/account/entitlements", {
        headers: { cookie },
      }, env));
      assert.equal((entitlements.trial as { state: string }).state, "legacy");
      assert.equal((entitlements.trial as { startedAt: string | null }).startedAt, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects isolated add-on checkout for a trial Free account before calling Stripe", async () => {
    const prices = {
      STRIPE_PRICE_AI_CREDITS_500: "price_ai",
      STRIPE_PRICE_STORAGE_1GB_12M: "price_storage_1",
      STRIPE_PRICE_STORAGE_5GB_12M: "price_storage_5",
      STRIPE_PRICE_YEARLY: "price_year",
      STRIPE_SECRET_KEY: "sk_test_example",
    };
    const env = trialEnv(prices);
    let stripeCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      stripeCalls += 1;
      return Response.json({ url: "https://checkout.stripe.test/session" });
    };
    async function login(email: string, signedEnv: CloudEnv) {
      const mail = emailBinding();
      const withMail = { ...signedEnv, EMAIL: mail.binding };
      assert.equal((await api("/api/auth/email-codes", {
        body: JSON.stringify({ email }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }, withMail)).status, 202);
      const verified = await api("/api/auth/email-codes/verify", {
        body: JSON.stringify({ code: mail.codes[0], email, legalAcceptance: LEGAL }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }, withMail);
      assert.equal(verified.status, 200);
      return verified.headers.get("set-cookie")?.split(";", 1)[0] || "";
    }
    function checkout(offer: string, cookie = "", signedEnv: CloudEnv = env) {
      return api("/api/stripe/checkout", {
        body: JSON.stringify({
          checkoutClaim: `checkout_addon_${offer}_0001`.slice(0, 64),
          legalAcceptance: LEGAL,
          locale: "en",
          offer,
        }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      }, signedEnv);
    }
    try {
      seedCloudAccountForTests({
        cloudTrialEndsAt: "2026-10-09T10:00:00.000Z",
        cloudTrialStartedAt: "2026-09-25T10:00:00.000Z",
        email: "trial-addon@example.test",
        everPaid: false,
        id: "usr_trial_addon_checkout",
        plan: "free",
      });
      setCloudNowForTests("2026-09-26T10:00:00.000Z");
      const activeCookie = await login("trial-addon@example.test", env);
      for (const offer of ["storage_1gb_12m", "storage_5gb_12m", "ai_credits_500"]) {
        const denied = await checkout(offer, activeCookie);
        assert.equal(denied.status, 402);
        assert.deepEqual(await jsonBody(denied), {
          code: "cloud_pro_required_for_addon",
          error: "Pro subscription required for add-ons",
        });
      }
      assert.equal(stripeCalls, 0);

      seedCloudAccountForTests({
        cloudTrialEndsAt: "2026-10-09T10:00:00.000Z",
        cloudTrialStartedAt: "2026-09-25T10:00:00.000Z",
        email: "expired-addon@example.test",
        everPaid: false,
        id: "usr_expired_addon_checkout",
        plan: "free",
      });
      setCloudNowForTests("2026-10-09T10:00:00.000Z");
      const expiredCookie = await login("expired-addon@example.test", env);
      const expired = await checkout("storage_1gb_12m", expiredCookie);
      assert.equal(expired.status, 402);
      assert.equal(stripeCalls, 0);

      const anonymous = await checkout("ai_credits_500");
      assert.equal(anonymous.status, 402);
      assert.equal(stripeCalls, 0);

      const proCheckout = await checkout("pro_year", activeCookie);
      assert.equal(proCheckout.status, 200);
      assert.equal(stripeCalls, 1);

      const anonymousPro = await checkout("pro_year");
      assert.equal(anonymousPro.status, 200);
      assert.equal(stripeCalls, 2);

      seedCloudAccountForTests({
        email: "legacy-addon@example.test",
        everPaid: false,
        id: "usr_legacy_addon_checkout",
        plan: "free",
      });
      const legacyCookie = await login("legacy-addon@example.test", env);
      assert.equal((await checkout("storage_5gb_12m", legacyCookie)).status, 200);
      assert.equal(stripeCalls, 3);

      seedCloudAccountForTests({
        cloudTrialEndsAt: "2026-10-09T10:00:00.000Z",
        cloudTrialStartedAt: "2026-09-25T10:00:00.000Z",
        email: "pro-addon@example.test",
        id: "usr_pro_addon_checkout",
        plan: "pro",
      });
      const proCookie = await login("pro-addon@example.test", env);
      assert.equal((await checkout("ai_credits_500", proCookie)).status, 200);
      assert.equal(stripeCalls, 4);

      const offEnv = trialEnv({ ...prices, CLOUD_TRIAL_ENABLED: undefined });
      const offCookie = await login("trial-addon@example.test", offEnv);
      assert.equal((await checkout("storage_1gb_12m", offCookie, offEnv)).status, 200);
      assert.equal(stripeCalls, 5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
