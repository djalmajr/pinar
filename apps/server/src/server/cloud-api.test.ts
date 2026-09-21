import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { FREE_STORAGE_BYTES, STORAGE_5GB_BYTES } from "../lib/entitlements";
import { CURRENT_LEGAL_VERSION } from "../lib/legal-documents";
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
import { exerciseVisualContextContract } from "./visual-context.contract";
import { exerciseAgentResultsContract, exerciseAgentResultsIsolation } from "./agent-results.contract";
import { exercisePinReviewContract, exercisePinReviewIsolation } from "./pin-review.contract";
import { exerciseClosedLoopContract, exerciseClosedLoopIsolation } from "./closed-loop.contract";

const identityA = { id: `ins_${"A".repeat(24)}`, token: `pit_${"a".repeat(43)}` };
const identityB = { id: `ins_${"B".repeat(24)}`, token: `pit_${"b".repeat(43)}` };
const identityC = { id: `ins_${"C".repeat(24)}`, token: `pit_${"c".repeat(43)}` };
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const ACCEPTED_CHECKOUT_CONSENT = { terms_of_service: "accepted" };
const CHECKOUT_LEGAL_VERSION = CURRENT_LEGAL_VERSION;
const REMOTE_FREE_LEGAL_ACCEPTANCE = {
  acceptableUseVersion: CURRENT_LEGAL_VERSION,
  accepted: true,
  locale: "en",
  privacyVersion: CURRENT_LEGAL_VERSION,
  termsVersion: CURRENT_LEGAL_VERSION,
};

function checkoutRequest(fields: Record<string, unknown>) {
  const locale = fields.locale === "pt" ? "pt" : "en";
  return {
    ...fields,
    legalAcceptance: { ...REMOTE_FREE_LEGAL_ACCEPTANCE, locale },
    locale,
  };
}

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
    body: JSON.stringify({
      installationId: identity.id,
      installationToken: identity.token,
      legalAcceptance: REMOTE_FREE_LEGAL_ACCEPTANCE,
    }),
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

function uploadWithCookie(cookie: string, id: string, title: string, env: CloudEnv) {
  return api("/api/shots", {
    body: JSON.stringify({
      id,
      image: VALID_PNG,
      page: { title, url: `https://example.test/${id}` },
      pins: [{ comment: `Pin for ${title}`, number: 1 }],
    }),
    headers: { cookie, "content-type": "application/json" },
    method: "POST",
  }, env);
}

async function paidProCookie(env: CloudEnv, email = "ai-pro@example.test") {
  const mail = emailBinding();
  const signed = { ...env, EMAIL: mail.binding };
  seedCloudAccountForTests({ billingStatus: "active", email, plan: "pro" });
  await requestEmailCode(email, signed);
  const response = await verifyEmailCode(email, mail.codes[0], signed);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
  assert.match(cookie, /^pinar_session=/);
  return { cookie, env: signed };
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

function bucketBinding() {
  const deletedKeys: string[] = [];
  const getKeys: string[] = [];
  const objects = new Map<string, Uint8Array>();
  const putKeys: string[] = [];
  const binding = {
    async delete(key: string) {
      deletedKeys.push(key);
      objects.delete(key);
    },
    async get(key: string) {
      getKeys.push(key);
      const value = objects.get(key);
      if (!value) return null;
      return {
        body: new Response(new Uint8Array(value)).body,
        httpEtag: `etag-${key}`,
        writeHttpMetadata() {},
      };
    },
    async put(key: string, value: Uint8Array) {
      putKeys.push(key);
      objects.set(key, value);
    },
  } as unknown as NonNullable<CloudEnv["PINAR_BUCKET"]>;
  return { binding, deletedKeys, getKeys, putKeys };
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
  includeLegalAcceptance = true,
) {
  return api("/api/auth/email-codes/verify", {
    body: JSON.stringify({
      code,
      email,
      installationId: identity?.id,
      installationToken: identity?.token,
      legalAcceptance: includeLegalAcceptance ? REMOTE_FREE_LEGAL_ACCEPTANCE : undefined,
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function acceptedCheckoutMetadata(
  checkoutClaim: string,
  extra: Record<string, string> = {},
) {
  return {
    pinar_acceptable_use_version: CHECKOUT_LEGAL_VERSION,
    pinar_checkout_claim_hash: await sha256(checkoutClaim),
    pinar_locale: "en",
    pinar_privacy_version: CHECKOUT_LEGAL_VERSION,
    pinar_terms_version: CHECKOUT_LEGAL_VERSION,
    ...extra,
  };
}

async function postStripeWebhook(event: Record<string, unknown>, env: CloudEnv) {
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is required for the test");
  assert.equal(typeof event.created, "number");
  const body = JSON.stringify(event);
  const timestamp = String(event.created);
  const signature = await hmacSha256(webhookSecret, `${timestamp}.${body}`);
  return api("/api/stripe/webhook", {
    body,
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    method: "POST",
  }, env);
}

describe("remote installation isolation", () => {
  beforeEach(() => resetCloudMemoryStateForTests());

  test("requires and records the current legal bundle before remote Free registration", async () => {
    setCloudNowForTests("2026-08-18T02:53:00.000Z");
    const current = await api("/api/legal/current");
    assert.equal(current.status, 200);
    assert.deepEqual(await jsonBody(current), {
      acceptableUseUrl: "/legal/acceptable-use",
      privacyUrl: "/legal/privacy",
      termsUrl: "/legal/terms",
      version: CURRENT_LEGAL_VERSION,
    });

    const rejected = await api("/api/installations", {
      body: JSON.stringify({ installationId: identityA.id, installationToken: identityA.token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(rejected.status, 428);
    assert.equal((await jsonBody(rejected)).code, "legal_acceptance_required");

    assert.equal((await register(identityA)).status, 201);
    const entitlements = await jsonBody(await api("/api/account/entitlements", {
      headers: identityHeaders(identityA),
    }));
    assert.deepEqual(entitlements.legalAcceptance, {
      acceptableUseVersion: CURRENT_LEGAL_VERSION,
      acceptedAt: "2026-08-18T02:53:00.000Z",
      evidenceId: `remote-free:${identityA.id}:${CURRENT_LEGAL_VERSION}`,
      locale: "en",
      ownerId: identityA.id,
      ownerType: "installation",
      privacyVersion: CURRENT_LEGAL_VERSION,
      source: "remote_free",
      termsVersion: CURRENT_LEGAL_VERSION,
    });
  });

  test("staging registers and authorizes test installations without legal acceptance", async () => {
    const env: CloudEnv = { ...TEST_ENV, DEPLOYMENT_ENV: "staging" };
    const registered = await api("/api/installations", {
      body: JSON.stringify({ installationId: identityA.id, installationToken: identityA.token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }, env);
    assert.equal(registered.status, 201);

    const entitlements = await api("/api/account/entitlements", {
      headers: identityHeaders(identityA),
    }, env);
    assert.equal(entitlements.status, 200);
    assert.equal((await jsonBody(entitlements)).legalAcceptance, null);
  });

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

    const anonymousSession = await api("/api/sessions/session_A_001");
    assert.equal(anonymousSession.status, 404);
    const ownerSession = await api("/api/sessions/session_A_001", { headers: identityHeaders(identityA) });
    assert.equal(ownerSession.status, 200);
    assert.equal(ownerSession.headers.get("cache-control"), "private, no-store");
    const markdown = await handleCloudPublicRequest(new Request("https://pinar.test/v/session_A_001.md"), {});
    assert.equal(markdown.status, 404);

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

  test("lets authenticated owners load GET /api/sessions/:id without a share token", async () => {
    await register(identityA);
    await register(identityB);
    assert.equal((await upload(identityA, "session_owner_get_001", "Owner GET")).status, 201);

    const anonymous = await api("/api/sessions/session_owner_get_001");
    assert.equal(anonymous.status, 404);
    assert.deepEqual(await jsonBody(anonymous), { error: "Session not found" });

    const other = await api("/api/sessions/session_owner_get_001", { headers: identityHeaders(identityB) });
    assert.equal(other.status, 404);
    assert.deepEqual(await jsonBody(other), { error: "Session not found" });

    const bogusToken = await api("/api/sessions/session_owner_get_001?token=sh_notarealtoken");
    assert.equal(bogusToken.status, 404);

    const owner = await api("/api/sessions/session_owner_get_001", { headers: identityHeaders(identityA) });
    assert.equal(owner.status, 200);
    assert.equal(owner.headers.get("cache-control"), "private, no-store");
    const body = await jsonBody(owner);
    assert.ok(isRecord(body.session));
    assert.equal(body.session.id, "session_owner_get_001");
  });

  test("stores shots under the shots prefix inside the environment bucket", async () => {
    const bucket = bucketBinding();
    const env = { ...TEST_ENV, PINAR_BUCKET: bucket.binding };
    assert.equal((await register(identityA)).status, 201);

    const uploaded = await api("/api/shots", {
      body: JSON.stringify({
        id: "prefixed_shot_001",
        image: VALID_PNG,
        page: { title: "Prefixed shot", url: "https://example.test/prefixed" },
        pins: [],
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }, env);
    assert.equal(uploaded.status, 201);
    assert.deepEqual(bucket.putKeys, ["shots/prefixed_shot_001.png"]);

    const served = await handleCloudPublicRequest(
      new Request("https://pinar.test/shots/prefixed_shot_001.png"),
      env,
    );
    assert.equal(served.status, 404);

    const ownerShot = await handleCloudPublicRequest(
      new Request("https://pinar.test/shots/prefixed_shot_001.png", { headers: identityHeaders(identityA) }),
      env,
    );
    assert.equal(ownerShot.status, 200);
    assert.equal(ownerShot.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(bucket.getKeys, ["shots/prefixed_shot_001.png"]);

    assert.equal((await api("/api/history/prefixed_shot_001", {
      headers: identityHeaders(identityA),
      method: "DELETE",
    }, env)).status, 200);
    assert.deepEqual(bucket.deletedKeys, ["shots/prefixed_shot_001.png"]);
  });

  test("omits session markdown screenshots from the live owner preference", async () => {
    assert.equal((await register(identityA)).status, 201);
    assert.equal((await register(identityB)).status, 201);
    assert.equal((await api("/api/preferences")).status, 401);
    const defaults = await jsonBody(await api("/api/preferences", { headers: identityHeaders(identityA) }));
    assert.equal(defaults.ok, true);
    assert.equal(defaults.handoffMode, "compact");
    assert.equal(defaults.includeScreenshot, true);

    const uploaded = await api("/api/shots", {
      body: JSON.stringify({
        id: "session_live_pref_001",
        image: VALID_PNG,
        page: { title: "Login", url: "https://example.test/login" },
        pins: [{ comment: "Fix the form", number: 1 }],
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    });
    assert.equal(uploaded.status, 201);
    const ownerSession = await jsonBody(await api("/api/sessions/session_live_pref_001", {
      headers: identityHeaders(identityA),
    }));
    assert.ok(isRecord(ownerSession.session));
    assert.equal(ownerSession.session.includeScreenshot, true);
    assert.match(String(ownerSession.session.shotUrl), /\/shots\/session_live_pref_001\.png/);
    const anonymousMarkdown = await handleCloudPublicRequest(
      new Request("https://pinar.test/v/session_live_pref_001.md"),
      {},
    );
    assert.equal(anonymousMarkdown.status, 404);

    const patched = await jsonBody(await api("/api/preferences", {
      body: JSON.stringify({ includeScreenshot: false }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "PATCH",
    }));
    assert.equal(patched.includeScreenshot, false);
    assert.equal(patched.handoffMode, "compact");
    const detailed = await jsonBody(await api("/api/preferences", {
      body: JSON.stringify({ handoffMode: "full" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "PATCH",
    }));
    assert.equal(detailed.handoffMode, "full");
    assert.equal(detailed.includeScreenshot, false);
    const emptyPatch = await jsonBody(await api("/api/preferences", {
      body: JSON.stringify({}),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "PATCH",
    }));
    assert.equal(emptyPatch.handoffMode, "full");
    assert.equal(emptyPatch.includeScreenshot, false);
    const otherOwner = await jsonBody(await api("/api/preferences", { headers: identityHeaders(identityB) }));
    assert.equal(otherOwner.handoffMode, "compact");
    assert.equal(otherOwner.includeScreenshot, true);

    const stillOwner = await api("/api/sessions/session_live_pref_001", {
      headers: identityHeaders(identityA),
    });
    assert.equal(stillOwner.status, 200);
    const markdown = await handleCloudPublicRequest(
      new Request("https://pinar.test/v/session_live_pref_001.md"),
      {},
    );
    assert.equal(markdown.status, 404);
  });

  test("falls back to captureDestination when a shot omits a collection", async () => {
    assert.equal((await register(identityA)).status, 201);
    const defaults = await jsonBody(await api("/api/preferences", { headers: identityHeaders(identityA) }));
    assert.deepEqual(defaults, {
      ok: true,
      captureDestination: null,
      componentTarget: null,
      copyOnFinishBatch: "prompt",
      copyViewerContent: false,
      handoffMode: "compact",
      includeScreenshot: true,
      includeViewer: true,
      language: null,
      sensitiveQueryKeys: "",
      voicePostProcessing: false,
    });

    const tree = await jsonBody(await api("/api/project-tree", { headers: identityHeaders(identityA) }));
    assert.ok(isRecord(tree.tree));
    assert.ok(Array.isArray(tree.tree.projects));
    const personal = tree.tree.projects[0];
    assert.ok(isRecord(personal));
    assert.ok(Array.isArray(personal.collections));
    const inbox = personal.collections[0];
    assert.ok(isRecord(inbox));

    const projectBody = await jsonBody(await api("/api/projects", {
      body: JSON.stringify({ name: "Preferred" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }));
    assert.ok(isRecord(projectBody.project));
    const projectId = String(projectBody.project.id);
    const collectionBody = await jsonBody(await api(`/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Review" }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }));
    assert.ok(isRecord(collectionBody.collection));
    const collectionId = String(collectionBody.collection.id);

    const patched = await jsonBody(await api("/api/preferences", {
      body: JSON.stringify({
        captureDestination: { collectionId, projectId },
        copyOnFinishBatch: "link",
        voicePostProcessing: true,
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "PATCH",
    }));
    assert.deepEqual(patched.captureDestination, { collectionId, projectId });
    assert.equal(patched.copyOnFinishBatch, "link");
    assert.equal(patched.includeScreenshot, true);
    assert.equal(patched.voicePostProcessing, true);

    const preferred = await jsonBody(await api("/api/shots", {
      body: JSON.stringify({
        id: "pref_dest_session",
        image: VALID_PNG,
        page: { title: "Preferred dest", url: "https://example.test/pref" },
        pins: [],
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }));
    assert.ok(isRecord(preferred.destination));
    assert.deepEqual(preferred.destination, { collectionId, projectId });

    const explicit = await jsonBody(await api("/api/shots", {
      body: JSON.stringify({
        collectionId: String(inbox.id),
        id: "explicit_dest_session",
        image: VALID_PNG,
        page: { title: "Explicit dest", url: "https://example.test/explicit" },
        pins: [],
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }));
    assert.ok(isRecord(explicit.destination));
    assert.equal(explicit.destination.collectionId, inbox.id);

    await api("/api/preferences", {
      body: JSON.stringify({
        captureDestination: { collectionId: "missing-collection", projectId },
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "PATCH",
    });
    const missing = await jsonBody(await api("/api/shots", {
      body: JSON.stringify({
        id: "missing_dest_session",
        image: VALID_PNG,
        page: { title: "Missing dest", url: "https://example.test/missing" },
        pins: [],
      }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "POST",
    }));
    assert.ok(isRecord(missing.destination));
    assert.equal(missing.destination.collectionId, inbox.id);

    const unknown = await jsonBody(await api("/api/preferences", {
      body: JSON.stringify({ unknownKey: true }),
      headers: identityHeaders(identityA, { "content-type": "application/json" }),
      method: "PATCH",
    }));
    assert.equal("unknownKey" in unknown, false);
    assert.deepEqual(unknown.captureDestination, { collectionId: "missing-collection", projectId });
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

  test("invalidates earlier unused extension codes when another code is created", async () => {
    await register(identityA);
    const first = await jsonBody(await api("/api/auth/extension-codes", {
      headers: identityHeaders(identityA),
      method: "POST",
    }));
    const second = await jsonBody(await api("/api/auth/extension-codes", {
      headers: identityHeaders(identityA),
      method: "POST",
    }));

    assert.notEqual(first.code, second.code);
    // Mutation captured: retaining the previous unused code makes this exchange succeed.
    assert.equal((await api("/api/auth/extension-codes/exchange", {
      body: JSON.stringify({ code: first.code }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status, 400);
    assert.equal((await api("/api/auth/extension-codes/exchange", {
      body: JSON.stringify({ code: second.code }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status, 200);
  });

  test("removes consumed extension codes and expired web sessions during cleanup", async () => {
    setCloudNowForTests("2026-08-16T12:00:00.000Z");
    await register(identityA);
    const created = await jsonBody(await api("/api/auth/extension-codes", {
      headers: identityHeaders(identityA),
      method: "POST",
    }));
    assert.equal((await api("/api/auth/extension-codes/exchange", {
      body: JSON.stringify({ code: created.code }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status, 200);

    setCloudNowForTests("2026-09-16T12:00:01.000Z");
    const result = await cleanupOldRecords({});

    // Mutation captured: omitting either auth-table cleanup leaves its count at zero.
    assert.equal(result.deletedExtensionCodeCount, 1);
    assert.equal(result.deletedWebSessionCount, 1);
  });

  test("cleans D1 auth records without touching capture objects in R2", async () => {
    type FakeStatement = {
      all(): Promise<{ results: Record<string, unknown>[] }>;
      bind(...values: unknown[]): FakeStatement;
      first(): Promise<Record<string, unknown> | null>;
      query: string;
      run(): Promise<unknown>;
      values: unknown[];
    };
    const batchedStatements: FakeStatement[] = [];
    const db = {
      async batch(statements: FakeStatement[]) {
        batchedStatements.push(...statements);
        return [{ meta: { changes: 2 } }, { meta: { changes: 3 } }];
      },
      prepare(query: string) {
        const statement: FakeStatement = {
          async all() { return { results: [] }; },
          bind(...values: unknown[]) { statement.values = values; return statement; },
          async first() { return null; },
          query,
          async run() { return { meta: { changes: 0 } }; },
          values: [],
        };
        return statement;
      },
    };
    const bucket = bucketBinding();
    setCloudNowForTests("2026-09-16T12:00:01.000Z");

    const result = await cleanupOldRecords({
      DB: db,
      PINAR_BUCKET: bucket.binding,
    } as unknown as CloudEnv);

    assert.equal(result.deletedExtensionCodeCount, 2);
    assert.equal(result.deletedWebSessionCount, 3);
    assert.deepEqual(bucket.deletedKeys, []);
    assert.deepEqual(batchedStatements.map((statement) => statement.query), [
      "DELETE FROM extension_codes WHERE expires_at <= ? OR used_at IS NOT NULL",
      "DELETE FROM web_sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)",
    ]);
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

  test("requires current policies on first activation and reuses acceptance on later logins", async () => {
    const mail = emailBinding();
    const env: CloudEnv = { ...TEST_ENV, EMAIL: mail.binding };
    seedCloudAccountForTests({ email: "owner@example.test", plan: "pro" });
    await requestEmailCode("OWNER@example.test", env);
    const required = await verifyEmailCode("owner@example.test", mail.codes[0], env, undefined, false);
    assert.equal(required.status, 428);
    assert.deepEqual(await jsonBody(required), {
      acceptableUseUrl: "/legal/acceptable-use",
      code: "legal_acceptance_required",
      error: "Current legal acceptance is required",
      privacyUrl: "/legal/privacy",
      termsUrl: "/legal/terms",
      version: CURRENT_LEGAL_VERSION,
    });
    assert.equal(required.headers.get("set-cookie"), null);

    const response = await verifyEmailCode("owner@example.test", mail.codes[0], env);
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
    assert.match(cookie, /^pinar_session=pws_/);
    const session = await jsonBody(await api("/api/auth/session", { headers: { cookie } }, env));
    assert.ok(isRecord(session.session));
    assert.equal(session.session.kind, "account");
    assert.equal(session.session.plan, "pro");
    assert.equal((await verifyEmailCode("owner@example.test", mail.codes[0], env)).status, 400);

    await requestEmailCode("owner@example.test", env);
    const laterLogin = await verifyEmailCode("owner@example.test", mail.codes.at(-1) || "", env, undefined, false);
    assert.equal(laterLogin.status, 200);
    const entitlements = await jsonBody(await api("/api/account/entitlements", {
      headers: { cookie: laterLogin.headers.get("set-cookie")?.split(";", 1)[0] || "" },
    }, env));
    assert.ok(isRecord(entitlements.legalAcceptance));
    assert.equal(entitlements.legalAcceptance.source, "account");
    assert.equal(entitlements.legalAcceptance.termsVersion, CURRENT_LEGAL_VERSION);
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
    assert.equal((await api("/api/shots", {
      body: JSON.stringify({
        id: "cancel_retention_session",
        image: VALID_PNG,
        page: { title: "Cancellation retention", url: "https://example.test/cancel-retention" },
        pins: [],
      }),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    }, env)).status, 201);
    const eventCreated = Math.floor(new Date(now).getTime() / 1000);
    const event = JSON.stringify({
      created: eventCreated,
      data: { object: { customer: "cus_cancel", id: "sub_cancel", status: "canceled" } },
      id: "evt_cancel",
      type: "customer.subscription.deleted",
    });
    const timestamp = String(eventCreated);
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
    setCloudNowForTests("2026-11-14T11:59:59.000Z");
    assert.equal((await cleanupOldRecords(env)).deletedCount, 0);
    assert.equal((await api("/api/sessions/cancel_retention_session", { headers }, env)).status, 200);
    setCloudNowForTests("2026-11-14T12:00:01.000Z");
    assert.equal((await cleanupOldRecords(env)).deletedCount, 1);
    assert.equal((await api("/api/sessions/cancel_retention_session", { headers }, env)).status, 404);
  });

  test("keeps a cancellation terminal when an older active event arrives later", async () => {
    const mail = emailBinding();
    const env: CloudEnv = {
      ...TEST_ENV,
      EMAIL: mail.binding,
      STRIPE_WEBHOOK_SECRET: "whsec_ordering_test",
    };
    const canceledAt = 1_787_000_200;
    setCloudNowForTests(new Date(canceledAt * 1000).toISOString());
    seedCloudAccountForTests({
      email: "ordering@example.test",
      plan: "pro",
      stripeCustomerId: "cus_ordering",
      stripeSubscriptionId: "sub_ordering",
    });
    await register(identityA);
    await requestEmailCode("ordering@example.test", env);
    const login = await jsonBody(await verifyEmailCode("ordering@example.test", mail.codes[0], env, identityA));
    assert.ok(isRecord(login.device));
    const headers = { authorization: `Bearer ${String(login.device.token)}` };
    assert.equal((await api("/api/shots", {
      body: JSON.stringify({
        id: "ordering_reactivated_session",
        image: VALID_PNG,
        page: { title: "Reactivated retention", url: "https://example.test/reactivated-retention" },
        pins: [],
      }),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    }, env)).status, 201);

    assert.equal((await postStripeWebhook({
      created: canceledAt,
      data: { object: { customer: "cus_ordering", id: "sub_ordering", status: "canceled" } },
      id: "evt_ordering_canceled",
      type: "customer.subscription.deleted",
    }, env)).status, 200);
    assert.equal((await postStripeWebhook({
      created: canceledAt - 60,
      data: { object: { customer: "cus_ordering", id: "sub_ordering", status: "active" } },
      id: "evt_ordering_stale_active",
      type: "customer.subscription.updated",
    }, env)).status, 200);
    assert.equal((await postStripeWebhook({
      created: canceledAt,
      data: { object: { customer: "cus_ordering", id: "sub_ordering", status: "active" } },
      id: "evt_ordering_same_second_active",
      type: "customer.subscription.updated",
    }, env)).status, 200);

    const session = await jsonBody(await api("/api/auth/session", { headers }, env));
    assert.ok(isRecord(session.session));
    assert.equal(session.session.plan, "free");

    assert.equal((await postStripeWebhook({
      created: canceledAt + 60,
      data: { object: { customer: "cus_ordering", id: "sub_ordering", status: "active" } },
      id: "evt_ordering_newer_active",
      type: "customer.subscription.updated",
    }, env)).status, 200);
    const reactivated = await jsonBody(await api("/api/auth/session", { headers }, env));
    assert.ok(isRecord(reactivated.session));
    assert.equal(reactivated.session.plan, "pro");

    setCloudNowForTests(new Date((canceledAt + 60) * 1000 + 91 * 24 * 60 * 60 * 1000).toISOString());
    assert.equal((await cleanupOldRecords(env)).deletedCount, 0);
    assert.equal((await api("/api/sessions/ordering_reactivated_session", { headers }, env)).status, 200);
  });

  test("keeps Pro and does not regrant initial credits through cancellation changes", async () => {
    const checkoutClaim = "checkout_claim_flexible_cancel_reactivate";
    const email = "flexible-cycle@example.test";
    const env: CloudEnv = {
      ...TEST_ENV,
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_flexible_cycle_test",
    };
    const originalFetch = globalThis.fetch;
    setCloudNowForTests("2026-08-18T02:53:00.000Z");
    globalThis.fetch = async () => Response.json({
      consent: ACCEPTED_CHECKOUT_CONSENT,
      customer: "cus_flexible_cycle",
      customer_details: { email },
      id: "cs_flexible_cycle",
      metadata: await acceptedCheckoutMetadata(checkoutClaim, {
        pinar_offer: "pro_year",
      }),
      mode: "subscription",
      payment_status: "paid",
      status: "complete",
      subscription: "sub_flexible_cycle",
    });

    let cookie = "";
    try {
      const success = await api(
        `/api/stripe/success?session_id=cs_flexible_cycle&claim=${checkoutClaim}`,
        {},
        env,
      );
      assert.equal(success.status, 200);
      cookie = success.headers.get("set-cookie")?.split(";", 1)[0] || "";
    } finally {
      globalThis.fetch = originalFetch;
    }

    const initial = await jsonBody(await api("/api/account/entitlements", {
      headers: { cookie },
    }, env));
    assert.equal(initial.plan, "pro");
    assert.ok(isRecord(initial.aiCredits));
    assert.equal(initial.aiCredits.balance, 500);

    const canceledAt = 1_787_023_324;
    const cancelAt = 1_818_557_602;
    setCloudNowForTests(new Date(canceledAt * 1000).toISOString());
    assert.equal((await postStripeWebhook({
      created: canceledAt,
      data: {
        object: {
          cancel_at: cancelAt,
          cancel_at_period_end: false,
          canceled_at: canceledAt,
          cancellation_details: { feedback: null, reason: "cancellation_requested" },
          customer: "cus_flexible_cycle",
          id: "sub_flexible_cycle",
          status: "active",
        },
        previous_attributes: {
          cancel_at: null,
          canceled_at: null,
          cancellation_details: { reason: null },
        },
      },
      id: "evt_flexible_cancel_schedule",
      type: "customer.subscription.updated",
    }, env)).status, 200);

    setCloudNowForTests(new Date((canceledAt + 1) * 1000).toISOString());
    assert.equal((await postStripeWebhook({
      created: canceledAt + 1,
      data: {
        object: {
          cancel_at: cancelAt,
          cancel_at_period_end: false,
          canceled_at: canceledAt,
          cancellation_details: { feedback: "other", reason: "cancellation_requested" },
          customer: "cus_flexible_cycle",
          id: "sub_flexible_cycle",
          status: "active",
        },
        previous_attributes: { cancellation_details: { feedback: null } },
      },
      id: "evt_flexible_cancel_feedback",
      type: "customer.subscription.updated",
    }, env)).status, 200);

    const scheduled = await jsonBody(await api("/api/account/entitlements", {
      headers: { cookie },
    }, env));
    assert.equal(scheduled.plan, "pro");
    assert.ok(isRecord(scheduled.aiCredits));
    assert.equal(scheduled.aiCredits.balance, 500);

    const reactivatedAt = 1_787_023_745;
    setCloudNowForTests(new Date(reactivatedAt * 1000).toISOString());
    assert.equal((await postStripeWebhook({
      created: reactivatedAt,
      data: {
        object: {
          cancel_at: null,
          cancel_at_period_end: false,
          canceled_at: null,
          cancellation_details: { feedback: null, reason: null },
          customer: "cus_flexible_cycle",
          id: "sub_flexible_cycle",
          status: "active",
        },
        previous_attributes: {
          cancel_at: cancelAt,
          canceled_at: canceledAt,
          cancellation_details: { feedback: "other", reason: "cancellation_requested" },
        },
      },
      id: "evt_flexible_reactivated",
      type: "customer.subscription.updated",
    }, env)).status, 200);

    const reactivated = await jsonBody(await api("/api/account/entitlements", {
      headers: { cookie },
    }, env));
    assert.equal(reactivated.plan, "pro");
    assert.ok(isRecord(reactivated.aiCredits));
    assert.equal(reactivated.aiCredits.balance, 500);
  });

  test("does not let an old subscription cancellation demote the current subscription", async () => {
    const mail = emailBinding();
    const env: CloudEnv = {
      ...TEST_ENV,
      EMAIL: mail.binding,
      STRIPE_WEBHOOK_SECRET: "whsec_subscription_switch_test",
    };
    const eventCreated = 1_787_100_000;
    setCloudNowForTests(new Date(eventCreated * 1000).toISOString());
    seedCloudAccountForTests({
      email: "switch@example.test",
      plan: "pro",
      stripeCustomerId: "cus_switch",
      stripeSubscriptionId: "sub_current",
    });
    await register(identityA);
    await requestEmailCode("switch@example.test", env);
    const login = await jsonBody(await verifyEmailCode("switch@example.test", mail.codes[0], env, identityA));
    assert.ok(isRecord(login.device));
    const headers = { authorization: `Bearer ${String(login.device.token)}` };

    assert.equal((await postStripeWebhook({
      created: eventCreated,
      data: { object: { customer: "cus_switch", id: "sub_previous", status: "canceled" } },
      id: "evt_previous_subscription_canceled",
      type: "customer.subscription.deleted",
    }, env)).status, 200);

    const session = await jsonBody(await api("/api/auth/session", { headers }, env));
    assert.ok(isRecord(session.session));
    assert.equal(session.session.plan, "pro");
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
          body: JSON.stringify(checkoutRequest({ checkoutClaim: "checkout_claim_year_0001", interval: "year" })),
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
    assert.equal(
      params.get("metadata[pinar_checkout_claim_hash]"),
      await sha256("checkout_claim_year_0001"),
    );
    assert.equal(
      params.get("success_url"),
      "https://pinar.test/success?session_id={CHECKOUT_SESSION_ID}&claim=checkout_claim_year_0001",
    );
    assert.equal(params.has("payment_method_types[0]"), false);
    assert.match(params.get("integration_identifier") || "", /^pinar_web_[a-z]{8}$/);
    const stripeHeaders = new Headers(stripeInit?.headers);
    assert.match(stripeHeaders.get("idempotency-key") || "", /^pinar:checkout:pro_year:[A-Za-z0-9_-]{24}$/);
    assert.equal(stripeHeaders.get("stripe-version"), "2026-07-29.dahlia");
  });

  test("rejects checkout before Stripe without the current app consent bundle", async () => {
    let stripeCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      stripeCalls += 1;
      return Response.json({ url: "https://checkout.stripe.test/unexpected" });
    };
    try {
      const response = await api("/api/stripe/checkout", {
        body: JSON.stringify({ checkoutClaim: "checkout_without_legal_0001", interval: "year" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }, {
        STRIPE_PRICE_YEARLY: "price_yearly_test",
        STRIPE_SECRET_KEY: "sk_test_example",
      });
      const body = await jsonBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.code, "legal_acceptance_required");
      assert.equal(body.version, CURRENT_LEGAL_VERSION);
      assert.equal(body.termsUrl, "/legal/terms");
      assert.equal(body.privacyUrl, "/legal/privacy");
      assert.equal(body.acceptableUseUrl, "/legal/acceptable-use");
      assert.equal(stripeCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("opens checkout directly for an account with the current policy acceptance", async () => {
    const mail = emailBinding();
    const env: CloudEnv = {
      ...TEST_ENV,
      EMAIL: mail.binding,
      STRIPE_PRICE_YEARLY: "price_yearly_test",
      STRIPE_SECRET_KEY: "sk_test_example",
    };
    seedCloudAccountForTests({ email: "accepted@example.test", plan: "pro" });
    await requestEmailCode("accepted@example.test", env);
    const login = await verifyEmailCode("accepted@example.test", mail.codes[0], env);
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] || "";

    const originalFetch = globalThis.fetch;
    let stripeInit: RequestInit | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      stripeInit = init;
      return Response.json({ url: "https://checkout.stripe.test/current-acceptance" });
    };
    try {
      const response = await api("/api/stripe/checkout", {
        body: JSON.stringify({ checkoutClaim: "checkout_existing_acceptance_0001", interval: "year" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }, env);
      assert.equal(response.status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const params = new URLSearchParams(String(stripeInit?.body));
    assert.equal(params.get("metadata[pinar_legal_acceptance_source]"), "account");
    assert.equal(params.get("metadata[pinar_terms_version]"), CURRENT_LEGAL_VERSION);
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
    assert.equal("founderState" in pricing, false);
    assert.ok(isRecord(pricing.prices));
    assert.equal("founder" in pricing.prices, false);
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
          body: JSON.stringify(checkoutRequest({
            checkoutClaim: "checkout_claim_brazil_0001",
            country: "US",
            interval: "year",
          })),
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
        body: JSON.stringify(checkoutRequest({ checkoutClaim: "checkout_claim_missing_price", offer: "pro_year" })),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      {
        ...TEST_ENV,
        STRIPE_PRICE_YEARLY: "price_us_yearly_test",
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
        body: JSON.stringify(checkoutRequest({
          offer: "storage_20gb_12m",
          checkoutClaim: "checkout_claim_storage_0001",
          requestId: "checkout_request_123456",
        })),
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

  test("rejects retired offers and intervals before contacting Stripe", async () => {
    const originalFetch = globalThis.fetch;
    let stripeCalls = 0;
    globalThis.fetch = async () => { stripeCalls++; throw new Error("Unexpected Stripe request"); };
    try {
      for (const value of ["founder", "lifetime_founder", "lifetime", "unknown"]) {
        for (const field of ["offer", "interval"]) {
          const response = await api("/api/stripe/checkout", {
            method: "POST",
            body: JSON.stringify(checkoutRequest({ [field]: value, checkoutClaim: "retired_offer_claim_0001" })),
          }, { ...TEST_ENV, STRIPE_SECRET_KEY: "sk_test_example" });
          assert.equal(response.status, 400);
          assert.equal((await jsonBody(response)).error, "Invalid checkout offer");
        }
      }
      assert.equal(stripeCalls, 0);
    } finally { globalThis.fetch = originalFetch; }
  });

  test("paid retired or unidentified one-time sessions cannot grant access", async () => {
    const originalFetch = globalThis.fetch;
    const claim = "retired_session_claim_0001";
    try {
      for (const offer of ["founder", "lifetime_founder", "lifetime", "unknown", undefined]) {
        for (const mode of offer ? ["payment", "subscription"] : ["payment"]) {
          globalThis.fetch = async () => Response.json({
            customer: "cus_retired", customer_details: { email: "retired@example.test" },
            id: "cs_retired", mode, payment_status: "paid", status: "complete",
            consent: ACCEPTED_CHECKOUT_CONSENT,
            metadata: {
              pinar_offer: offer,
              pinar_checkout_claim_hash: await sha256(claim),
              pinar_terms_version: CURRENT_LEGAL_VERSION,
              pinar_privacy_version: CURRENT_LEGAL_VERSION,
              pinar_acceptable_use_version: CURRENT_LEGAL_VERSION,
              pinar_locale: "en",
            },
          });
          const response = await api(`/api/stripe/success?session_id=cs_retired&claim=${claim}`, {}, {
            ...TEST_ENV, STRIPE_SECRET_KEY: "sk_test_example",
          });
          assert.equal(response.status, 503);
          assert.equal(response.headers.get("set-cookie"), null);
        }
      }
    } finally { globalThis.fetch = originalFetch; }
  });

  test("does not activate a paid Checkout without versioned Terms acceptance", async () => {
    const checkoutClaim = "checkout_claim_without_terms_0001";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({
      customer: "cus_without_terms",
      customer_details: { email: "without-terms@example.test" },
      id: "cs_without_terms",
      metadata: {
        pinar_checkout_claim_hash: await sha256(checkoutClaim),
        pinar_offer: "pro_year",
      },
      mode: "subscription",
      payment_status: "paid",
      status: "complete",
      subscription: "sub_without_terms",
    });
    try {
      const response = await api(
        `/api/stripe/success?session_id=cs_without_terms&claim=${checkoutClaim}`,
        {},
        { ...TEST_ENV, STRIPE_SECRET_KEY: "sk_test_example" },
      );

      assert.equal(response.status, 503);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("routes Pro and add-on offers to their BRL and USD Stripe prices", async () => {
    const offers: Array<{
      brlPrice: string;
      mode: "payment" | "subscription";
      offer: string;
      usdPrice: string;
    }> = [
      { brlPrice: "price_br_year", mode: "subscription", offer: "pro_year", usdPrice: "price_us_year" },
      { brlPrice: "price_br_ai", mode: "payment", offer: "ai_credits_1000", usdPrice: "price_us_ai" },
      { brlPrice: "price_br_storage_5", mode: "payment", offer: "storage_5gb_12m", usdPrice: "price_us_storage_5" },
      { brlPrice: "price_br_storage_20", mode: "payment", offer: "storage_20gb_12m", usdPrice: "price_us_storage_20" },
    ];
    const env: CloudEnv = {
      ...TEST_ENV,
      STRIPE_PRICE_AI_CREDITS_1000: "price_us_ai",
      STRIPE_PRICE_BR_AI_CREDITS_1000: "price_br_ai",
      STRIPE_PRICE_BR_STORAGE_20GB_12M: "price_br_storage_20",
      STRIPE_PRICE_BR_STORAGE_5GB_12M: "price_br_storage_5",
      STRIPE_PRICE_BR_YEARLY: "price_br_year",
      STRIPE_PRICE_STORAGE_20GB_12M: "price_us_storage_20",
      STRIPE_PRICE_STORAGE_5GB_12M: "price_us_storage_5",
      STRIPE_PRICE_YEARLY: "price_us_year",
      STRIPE_SECRET_KEY: "sk_test_example",
    };
    const stripeRequests: RequestInit[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      stripeRequests.push(init || {});
      return Response.json({ url: "https://checkout.stripe.test/catalog" });
    };
    try {
      for (const country of ["US", "BR"]) {
        for (const offer of offers) {
          const requestId = `checkout_${country}_${offer.offer}_0001`;
          const checkoutClaim = `${requestId}_claim`;
          const response = await handleCloudApiRequest(requestForCountry("/api/stripe/checkout", country, {
            body: JSON.stringify(checkoutRequest({ checkoutClaim, offer: offer.offer, requestId })),
            headers: { "content-type": "application/json" },
            method: "POST",
          }), env);
          assert.equal(response.status, 200);
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(stripeRequests.length, 8);
    let requestIndex = 0;
    for (const country of ["US", "BR"]) {
      for (const offer of offers) {
        const request = stripeRequests[requestIndex];
        const params = new URLSearchParams(String(request.body));
        const headers = new Headers(request.headers);
        const expectedPrice = country === "BR" ? offer.brlPrice : offer.usdPrice;
        assert.equal(params.get("line_items[0][price]"), expectedPrice);
        assert.equal(params.get("metadata[pinar_offer]"), offer.offer);
        assert.equal(
          params.get("metadata[pinar_checkout_claim_hash]"),
          await sha256(`checkout_${country}_${offer.offer}_0001_claim`),
        );
        assert.equal(params.get("mode"), offer.mode);
        assert.equal(
          headers.get("idempotency-key"),
          `pinar:checkout:${offer.offer}:checkout_${country}_${offer.offer}_0001`,
        );
        if (offer.mode === "subscription") {
          assert.equal(params.get("subscription_data[metadata][pinar_offer]"), offer.offer);
          assert.equal(params.has("customer_creation"), false);
        } else {
          assert.equal(params.get("customer_creation"), "always");
          assert.equal(params.has("subscription_data[metadata][pinar_offer]"), false);
        }
        requestIndex += 1;
      }
    }
  });

  test("turns a confirmed checkout into an account and a 30-day web session", async () => {
    const checkoutClaim = "checkout_claim_success_0001";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({
      consent: ACCEPTED_CHECKOUT_CONSENT,
      customer: "cus_checkout",
      customer_details: { email: "checkout@example.test" },
      id: "cs_test",
      metadata: await acceptedCheckoutMetadata(checkoutClaim),
      mode: "subscription",
      payment_status: "paid",
      status: "complete",
      subscription: "sub_checkout",
    });
    try {
      assert.equal((await api("/api/stripe/success?session_id=cs_test", {}, {
        ...TEST_ENV,
        STRIPE_SECRET_KEY: "sk_test_example",
      })).status, 400);
      assert.equal((await api("/api/stripe/success?session_id=cs_test&claim=checkout_claim_wrong_0001", {}, {
        ...TEST_ENV,
        STRIPE_SECRET_KEY: "sk_test_example",
      })).status, 400);
      const response = await api(`/api/stripe/success?session_id=cs_test&claim=${checkoutClaim}`, {}, {
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

  test("honors a cancellation that arrives before its checkout session", async () => {
    const checkoutClaim = "checkout_claim_canceled_first";
    const eventCreated = 1_788_000_000;
    const env: CloudEnv = {
      ...TEST_ENV,
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_checkout_order_test",
    };
    setCloudNowForTests(new Date(eventCreated * 1000).toISOString());
    assert.equal((await postStripeWebhook({
      created: eventCreated,
      data: { object: { customer: "cus_canceled_first", id: "sub_canceled_first", status: "canceled" } },
      id: "evt_canceled_before_checkout",
      type: "customer.subscription.deleted",
    }, env)).status, 200);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({
      consent: ACCEPTED_CHECKOUT_CONSENT,
      customer: "cus_canceled_first",
      customer_details: { email: "canceled-first@example.test" },
      id: "cs_canceled_first",
      metadata: await acceptedCheckoutMetadata(checkoutClaim, {
        pinar_offer: "pro_month",
      }),
      mode: "subscription",
      payment_status: "paid",
      status: "complete",
      subscription: "sub_canceled_first",
    });
    try {
      const response = await api(
        `/api/stripe/success?session_id=cs_canceled_first&claim=${checkoutClaim}`,
        {},
        env,
      );
      assert.equal(response.status, 200);
      const body = await jsonBody(response);
      assert.ok(isRecord(body.account));
      assert.equal(body.account.plan, "free");
      const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
      const entitlements = await jsonBody(await api("/api/account/entitlements", {
        headers: { cookie },
      }, env));
      assert.equal(entitlements.plan, "free");
      assert.ok(isRecord(entitlements.aiCredits));
      assert.equal(entitlements.aiCredits.balance, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not grant AI credits on Free and blocks new Free storage above 250 MB", async () => {
    await register(identityA);
    const initial = await jsonBody(await api("/api/account/entitlements", {
      headers: identityHeaders(identityA),
    }));
    assert.ok(isRecord(initial.aiCredits));
    assert.equal(initial.aiCredits.balance, 0);
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

  test("does not expose retired AI generation endpoints", async () => {
    const requests = [
      ["/api/ai/session-summary", "POST"],
      ["/api/ai/pin-diagnosis", "POST"],
      ["/api/ai/component-export", "POST"],
      ["/api/ai/design-system", "POST"],
      ["/api/collections/retired_collection/design-system", "GET"],
    ] as const;

    for (const [path, method] of requests) {
      const response = await api(path, { method });
      assert.equal(response.status, 404, `${method} ${path}`);
    }
  });

  test("grants 500 Pro credits once without renewal or reactivation grants", async () => {
    const checkoutClaim = "checkout_claim_annual_0001";
    const originalFetch = globalThis.fetch;
    setCloudNowForTests("2026-01-31T12:30:00.000Z");
    globalThis.fetch = async () => Response.json({
      consent: ACCEPTED_CHECKOUT_CONSENT,
      customer: "cus_annual",
      customer_details: { email: "annual@example.test" },
      id: "cs_annual",
      metadata: await acceptedCheckoutMetadata(checkoutClaim, {
        pinar_offer: "pro_year",
      }),
      mode: "subscription",
      payment_status: "paid",
      status: "complete",
      subscription: "sub_annual",
    });
    let cookie = "";
    try {
      const response = await api(`/api/stripe/success?session_id=cs_annual&claim=${checkoutClaim}`, {}, {
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
    assert.equal(first.aiCredits.balance, 500);
    assert.equal(first.aiCredits.nextExpiryAt, "2027-01-31T12:30:00.000Z");
    assert.equal(first.aiCredits.nextRefillAt, null);

    setCloudNowForTests("2026-02-28T12:30:00.000Z");
    const renewed = await jsonBody(await api("/api/account/entitlements", { headers: { cookie } }));
    assert.ok(isRecord(renewed.aiCredits));
    assert.equal(renewed.aiCredits.balance, 500);
    assert.equal(renewed.aiCredits.nextExpiryAt, "2027-01-31T12:30:00.000Z");
    assert.equal(renewed.aiCredits.nextRefillAt, null);
    const duplicate = await jsonBody(await api("/api/account/entitlements", { headers: { cookie } }));
    assert.ok(isRecord(duplicate.aiCredits));
    assert.equal(duplicate.aiCredits.balance, 500);
  });

  test("fulfills a storage add-on once across webhook retries and success polling", async () => {
    const checkoutClaim = "checkout_claim_storage_success";
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
      consent: ACCEPTED_CHECKOUT_CONSENT,
      customer: "cus_storage",
      customer_details: { email: "storage@example.test" },
      id: "cs_storage",
      metadata: await acceptedCheckoutMetadata(checkoutClaim, {
        pinar_offer: "storage_5gb_12m",
      }),
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
      const success = await api(`/api/stripe/success?session_id=cs_storage&claim=${checkoutClaim}`, {}, {
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
    const preserved = await jsonBody(await api("/api/sessions/storage_existing_session", {
      headers: { cookie },
    }));
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
    const mail = emailBinding();
    const sent: Array<Record<string, unknown>> = [];
    const env: CloudEnv = {
      ...TEST_ENV,
      EMAIL: {
        async send(message: unknown) {
          assert.ok(isRecord(message));
          sent.push(message);
          return mail.binding.send(message);
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
    await requestEmailCode("storage-notice@example.test", env);
    const login = await verifyEmailCode(
      "storage-notice@example.test",
      mail.codes.at(-1) || "",
      env,
    );
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] || "";
    assert.equal((await api("/api/sessions/storage_notice_session", { headers: { cookie } }, env)).status, 200);
  });

  test("keeps the subscription customer when a signed-out account buys an add-on", async () => {
    const checkoutClaim = "checkout_claim_existing_addon";
    const email = "existing@example.test";
    seedCloudAccountForTests({
      email,
      plan: "pro",
      stripeCustomerId: "cus_subscription",
      stripeSubscriptionId: "sub_existing",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({
      consent: ACCEPTED_CHECKOUT_CONSENT,
      customer: "cus_addon_checkout",
      customer_details: { email },
      id: "cs_existing_addon",
      metadata: await acceptedCheckoutMetadata(checkoutClaim, {
        pinar_offer: "ai_credits_1000",
      }),
      mode: "payment",
      payment_status: "paid",
      status: "complete",
    });
    let cookie = "";
    try {
      const success = await api(`/api/stripe/success?session_id=cs_existing_addon&claim=${checkoutClaim}`, {}, {
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
    const eventCreated = Math.floor(new Date(now).getTime() / 1000);
    const event = JSON.stringify({
      created: eventCreated,
      data: { object: { customer: "cus_subscription", id: "sub_existing", status: "canceled" } },
      id: "evt_existing_cancel",
      type: "customer.subscription.deleted",
    });
    const timestamp = String(eventCreated);
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

  test("grants purchased AI credits without duplicate grants", async () => {
    const aiClaim = "checkout_claim_ai_credits_0001";
    const originalFetch = globalThis.fetch;
    setCloudNowForTests("2026-04-30T12:30:00.000Z");
    globalThis.fetch = async () => Response.json({
      consent: ACCEPTED_CHECKOUT_CONSENT,
      customer: "cus_ai",
      customer_details: { email: "ai@example.test" },
      id: "cs_ai",
      metadata: await acceptedCheckoutMetadata(aiClaim, {
        pinar_offer: "ai_credits_1000",
      }),
      mode: "payment",
      payment_status: "paid",
      status: "complete",
    });
    try {
      const ai = await api(`/api/stripe/success?session_id=cs_ai&claim=${aiClaim}`, {}, {
        ...TEST_ENV,
        STRIPE_SECRET_KEY: "sk_test_example",
      });
      const aiCookie = ai.headers.get("set-cookie")?.split(";", 1)[0] || "";
      assert.equal((await api(`/api/stripe/success?session_id=cs_ai&claim=${aiClaim}`, {}, {
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
    assert.equal(projectMarkdown.status, 404);

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
    const preserved = await jsonBody(await api("/api/sessions/session_A_tree", {
      headers: identityHeaders(identityA),
    }));
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
    assert.equal(markdown.status, 404);
  });

  test("matches the shared projects and collections API contract", async () => {
    await register(identityA);
    await exerciseProjectApiContract((path, init = {}) => api(path, {
      ...init,
      headers: identityHeaders(identityA, init.headers),
    }));
  });

  test("matches the shared visual context contract", async () => {
    await register(identityA);
    await exerciseVisualContextContract(
      (path, init = {}) => api(path, {
        ...init,
        headers: identityHeaders(identityA, init.headers),
      }),
    );
  });

  test("matches the shared agent results contract", async () => {
    await register(identityA);
    assert.equal((await api("/api/agent-executions", {
      body: JSON.stringify({ captureId: "visual_contract_element" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status, 401);
    await exerciseAgentResultsContract(
      (path, init = {}) => api(path, {
        ...init,
        headers: identityHeaders(identityA, init.headers),
      }),
    );
  });

  test("keeps agent results isolated between installations", async () => {
    await register(identityA);
    await register(identityB);
    await exerciseAgentResultsIsolation(
      (path, init = {}) => api(path, {
        ...init,
        headers: identityHeaders(identityA, init.headers),
      }),
      (path, init = {}) => api(path, {
        ...init,
        headers: identityHeaders(identityB, init.headers),
      }),
    );
  });

  test("matches the shared pin review contract", async () => {
    await register(identityA);
    assert.equal((await api("/api/sessions/pin_review_element/pins/pin_cta/review", {
      body: JSON.stringify({ action: "accept" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status, 401);
    await exercisePinReviewContract(
      (path, init = {}) => api(path, {
        ...init,
        headers: identityHeaders(identityA, init.headers),
      }),
    );
  });

  test("keeps pin review actions isolated between installations", async () => {
    await register(identityA);
    await register(identityB);
    await exercisePinReviewIsolation(
      (path, init = {}) => api(path, {
        ...init,
        headers: identityHeaders(identityA, init.headers),
      }),
      (path, init = {}) => api(path, {
        ...init,
        headers: identityHeaders(identityB, init.headers),
      }),
    );
  });

  test("matches the closed-loop pin, handoff, review and opt-in metrics contract", async () => {
    await register(identityA);
    assert.equal((await api("/api/loop-metrics", {
      body: JSON.stringify({ events: [{ event: "handoff" }], optIn: true }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status, 401);
    await exerciseClosedLoopContract(
      (path, init = {}) => api(path, {
        ...init,
        headers: identityHeaders(identityA, init.headers),
      }),
    );
  });

  test("patches viewer-owned pin fields on an owned session only", async () => {
    await register(identityA);
    await register(identityB);
    assert.equal((await upload(identityA, "patch_session_001", "Patchable")).status, 201);
    const listed = await jsonBody(await api("/api/sessions/patch_session_001", {
      headers: identityHeaders(identityA),
    }));
    assert.ok(isRecord(listed.session) && Array.isArray(listed.session.pins) && isRecord(listed.session.pins[0]));
    const pinId = String(listed.session.pins[0].pinId);
    const diagnosis = {
      acceptedAt: "2026-09-08T00:00:00.000Z",
      cause: "Flex container lacks align-items",
      confidence: "high",
      fix: ".row { align-items: center; }",
      properties: ["align-items"],
      version: 1,
    };
    const patch = (identity: typeof identityA, body: unknown) => api("/api/sessions/patch_session_001", {
      body: JSON.stringify(body),
      headers: identityHeaders(identity, { "content-type": "application/json" }),
      method: "PATCH",
    });
    assert.equal((await patch(identityB, { pins: [{ diagnosis, pinId }] })).status, 404);
    assert.equal((await patch(identityA, { pins: [{ diagnosis: { cause: "", version: 1 }, pinId }] })).status, 400);
    assert.equal((await patch(identityA, { pins: [{ diagnosis, pinId: "unknown_pin" }] })).status, 400);

    const patched = await jsonBody(await patch(identityA, {
      pins: [{
        diagnosis,
        evidence: {
          items: [{ at: "2026-09-08T00:00:01.000Z", grade: "same_page", kind: "error", message: "boom", origin: "https://example.test" }],
          version: 1,
        },
        pinId,
      }],
      reproduction: {
        steps: [{ at: "2026-09-08T00:00:00.000Z", kind: "navigate", url: "https://example.test/patch_session_001" }],
        version: 1,
      },
    }));
    assert.equal(patched.ok, true);
    const stored = await jsonBody(await api("/api/sessions/patch_session_001", {
      headers: identityHeaders(identityA),
    }));
    assert.ok(isRecord(stored.session) && Array.isArray(stored.session.pins) && isRecord(stored.session.pins[0]));
    assert.ok(isRecord(stored.session.pins[0].diagnosis));
    assert.equal(stored.session.pins[0].diagnosis.cause, "Flex container lacks align-items");
    assert.ok(isRecord(stored.session.pins[0].evidence) && Array.isArray(stored.session.pins[0].evidence.items));
    assert.equal(stored.session.pins[0].evidence.items.length, 1);
    assert.ok(isRecord(stored.session.reproduction) && Array.isArray(stored.session.reproduction.steps));
    assert.equal(stored.session.reproduction.steps.length, 1);

    const cleared = await jsonBody(await patch(identityA, { pins: [{ evidence: null, pinId }], reproduction: null }));
    assert.ok(isRecord(cleared.session) && Array.isArray(cleared.session.pins) && isRecord(cleared.session.pins[0]));
    assert.equal(cleared.session.pins[0].evidence, undefined);
    assert.equal(cleared.session.reproduction, undefined);
    assert.ok(isRecord(cleared.session.pins[0].diagnosis));
  });

  test("keeps loop metrics isolated between installations", async () => {
    await register(identityA);
    await register(identityB);
    await exerciseClosedLoopIsolation(
      (path, init = {}) => api(path, {
        ...init,
        headers: identityHeaders(identityA, init.headers),
      }),
      (path, init = {}) => api(path, {
        ...init,
        headers: identityHeaders(identityB, init.headers),
      }),
    );
  });
});
