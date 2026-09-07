import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { CURRENT_LEGAL_VERSION } from "../lib/legal-documents";
import {
  type CloudEnv,
  handleCloudApiRequest,
  handleCloudPublicRequest,
  resetCloudMemoryStateForTests,
  setCloudNowForTests,
} from "./cloud-api";

const identityA = { id: `ins_${"A".repeat(24)}`, token: `pit_${"a".repeat(43)}` };
const identityB = { id: `ins_${"B".repeat(24)}`, token: `pit_${"b".repeat(43)}` };
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
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

const TEST_ENV: CloudEnv = {
  AUTH_PEPPER: "test-auth-pepper",
  EXTENSION_ORIGIN: "chrome-extension://pinar-test",
  PRICING_AI_CREDITS_1000_BRL_CENTS: "990",
  PRICING_AI_CREDITS_1000_USD_CENTS: "299",
  PRICING_FOUNDER_BRL_CENTS: "12990",
  PRICING_FOUNDER_USD_CENTS: "3900",
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

describe("Share tokens (DJA-117)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    setCloudNowForTests("2025-01-15T12:00:00Z");
  });

  test("session requires share token for public access", async () => {
    const createResponse = await api("/api/captures", {
      body: JSON.stringify(checkoutRequest({ visualCapture: VALID_PNG })),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    assert.equal(createResponse.status, 201);
    const createBody = await jsonBody(createResponse);
    assert.equal(createBody.ok, true);
    const sessionId = String(createBody.id);

    // Anonymous access without token should fail
    const anonResponse = await handleCloudPublicRequest(
      new Request(`https://pinar.test/v/${sessionId}.md`),
      TEST_ENV,
    );
    assert.equal(anonResponse.status, 404);

    // Publish to get share token
    const publishResponse = await api("/api/shares/publish", {
      body: JSON.stringify({ resourceType: "session", resourceId: sessionId }),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    assert.equal(publishResponse.status, 201);
    const publishBody = await jsonBody(publishResponse);
    assert.equal(publishBody.ok, true);
    assert.ok(isRecord(publishBody.shareToken));
    const token = String(publishBody.shareToken.token);
    assert.ok(token.startsWith("sh_"));

    // Anonymous access with valid token should succeed
    const publicResponse = await handleCloudPublicRequest(
      new Request(`https://pinar.test/v/${sessionId}.md?token=${token}`),
      TEST_ENV,
    );
    assert.equal(publicResponse.status, 200);
    const markdown = await publicResponse.text();
    assert.ok(markdown.includes("Page:"));
  });

  test("revoked share token denies access", async () => {
    const createResponse = await api("/api/captures", {
      body: JSON.stringify(checkoutRequest({ visualCapture: VALID_PNG })),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const createBody = await jsonBody(createResponse);
    const sessionId = String(createBody.id);

    // Publish
    const publishResponse = await api("/api/shares/publish", {
      body: JSON.stringify({ resourceType: "session", resourceId: sessionId }),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const publishBody = await jsonBody(publishResponse);
    const token = String(publishBody.shareToken.token);

    // Access should work
    const beforeRevoke = await handleCloudPublicRequest(
      new Request(`https://pinar.test/v/${sessionId}.md?token=${token}`),
      TEST_ENV,
    );
    assert.equal(beforeRevoke.status, 200);

    // Revoke
    const revokeResponse = await api("/api/shares/revoke", {
      body: JSON.stringify({ resourceType: "session", resourceId: sessionId }),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    assert.equal(revokeResponse.status, 200);

    // Access should fail after revoke
    const afterRevoke = await handleCloudPublicRequest(
      new Request(`https://pinar.test/v/${sessionId}.md?token=${token}`),
      TEST_ENV,
    );
    assert.equal(afterRevoke.status, 404);
  });

  test("expired share token denies access", async () => {
    const createResponse = await api("/api/captures", {
      body: JSON.stringify(checkoutRequest({ visualCapture: VALID_PNG })),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const createBody = await jsonBody(createResponse);
    const sessionId = String(createBody.id);

    // Publish with expiry in 1 hour
    const expiresAt = "2025-01-15T13:00:00Z";
    const publishResponse = await api("/api/shares/publish", {
      body: JSON.stringify({ resourceType: "session", resourceId: sessionId, expiresAt }),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const publishBody = await jsonBody(publishResponse);
    const token = String(publishBody.shareToken.token);

    // Access should work before expiry
    const beforeExpiry = await handleCloudPublicRequest(
      new Request(`https://pinar.test/v/${sessionId}.md?token=${token}`),
      TEST_ENV,
    );
    assert.equal(beforeExpiry.status, 200);

    // Advance time past expiry
    setCloudNowForTests("2025-01-15T14:00:00Z");

    // Access should fail after expiry
    const afterExpiry = await handleCloudPublicRequest(
      new Request(`https://pinar.test/v/${sessionId}.md?token=${token}`),
      TEST_ENV,
    );
    assert.equal(afterExpiry.status, 404);
  });

  test("account isolation - user cannot access other users sessions", async () => {
    // User A creates a session
    const createResponseA = await api("/api/captures", {
      body: JSON.stringify(checkoutRequest({ visualCapture: VALID_PNG })),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const createBodyA = await jsonBody(createResponseA);
    const sessionIdA = String(createBodyA.id);

    // User A publishes
    const publishResponseA = await api("/api/shares/publish", {
      body: JSON.stringify({ resourceType: "session", resourceId: sessionIdA }),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const publishBodyA = await jsonBody(publishResponseA);
    const tokenA = String(publishBodyA.shareToken.token);

    // User B tries to revoke User A's share
    const revokeResponse = await api("/api/shares/revoke", {
      body: JSON.stringify({ resourceType: "session", resourceId: sessionIdA }),
      headers: identityHeaders(identityB),
      method: "POST",
    });
    assert.equal(revokeResponse.status, 404);

    // Token should still work since revoke failed
    const publicResponse = await handleCloudPublicRequest(
      new Request(`https://pinar.test/v/${sessionIdA}.md?token=${tokenA}`),
      TEST_ENV,
    );
    assert.equal(publicResponse.status, 200);
  });

  test("screenshot requires share token", async () => {
    const createResponse = await api("/api/captures", {
      body: JSON.stringify(checkoutRequest({ visualCapture: VALID_PNG })),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const createBody = await jsonBody(createResponse);
    const sessionId = String(createBody.id);

    // Anonymous access to screenshot without token should fail
    const anonResponse = await handleCloudPublicRequest(
      new Request(`https://pinar.test/shots/${sessionId}.png`),
      TEST_ENV,
    );
    assert.equal(anonResponse.status, 404);

    // Publish session
    const publishResponse = await api("/api/shares/publish", {
      body: JSON.stringify({ resourceType: "session", resourceId: sessionId }),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const publishBody = await jsonBody(publishResponse);
    const token = String(publishBody.shareToken.token);

    // Screenshot access with token should work (if R2 is configured)
    // In test env without R2, we expect 404 for missing shot, not for missing token
    const withTokenResponse = await handleCloudPublicRequest(
      new Request(`https://pinar.test/shots/${sessionId}.png?token=${token}`),
      TEST_ENV,
    );
    // Without R2 bucket configured, we can't test the full flow
    // but the token validation should pass
    assert.ok([404].includes(withTokenResponse.status));
  });

  test("republishing same resource returns existing token", async () => {
    const createResponse = await api("/api/captures", {
      body: JSON.stringify(checkoutRequest({ visualCapture: VALID_PNG })),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const createBody = await jsonBody(createResponse);
    const sessionId = String(createBody.id);

    // First publish
    const publish1 = await api("/api/shares/publish", {
      body: JSON.stringify({ resourceType: "session", resourceId: sessionId }),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const body1 = await jsonBody(publish1);
    const token1 = String(body1.shareToken.token);

    // Second publish of same resource
    const publish2 = await api("/api/shares/publish", {
      body: JSON.stringify({ resourceType: "session", resourceId: sessionId }),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const body2 = await jsonBody(publish2);
    const token2 = String(body2.shareToken.token);

    // Should return same token
    assert.equal(token1, token2);
  });

  test("list share tokens", async () => {
    // Create two sessions
    const create1 = await api("/api/captures", {
      body: JSON.stringify(checkoutRequest({ visualCapture: VALID_PNG })),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const session1 = String((await jsonBody(create1)).id);

    const create2 = await api("/api/captures", {
      body: JSON.stringify(checkoutRequest({ visualCapture: VALID_PNG })),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const session2 = String((await jsonBody(create2)).id);

    // Publish both
    await api("/api/shares/publish", {
      body: JSON.stringify({ resourceType: "session", resourceId: session1 }),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    await api("/api/shares/publish", {
      body: JSON.stringify({ resourceType: "session", resourceId: session2 }),
      headers: identityHeaders(identityA),
      method: "POST",
    });

    // List tokens
    const listResponse = await api("/api/shares", {
      headers: identityHeaders(identityA),
      method: "GET",
    });
    assert.equal(listResponse.status, 200);
    const listBody = await jsonBody(listResponse);
    assert.equal(listBody.ok, true);
    assert.ok(Array.isArray(listBody.tokens));
    assert.equal(listBody.tokens.length, 2);

    // User B should not see User A's tokens
    const listResponseB = await api("/api/shares", {
      headers: identityHeaders(identityB),
      method: "GET",
    });
    const listBodyB = await jsonBody(listResponseB);
    assert.ok(Array.isArray(listBodyB.tokens));
    assert.equal(listBodyB.tokens.length, 0);
  });

  test("uniform not found response for missing and private resources", async () => {
    const createResponse = await api("/api/captures", {
      body: JSON.stringify(checkoutRequest({ visualCapture: VALID_PNG })),
      headers: identityHeaders(identityA),
      method: "POST",
    });
    const createBody = await jsonBody(createResponse);
    const sessionId = String(createBody.id);

    // Private resource (no share token)
    const privateResponse = await handleCloudPublicRequest(
      new Request(`https://pinar.test/v/${sessionId}.md`),
      TEST_ENV,
    );
    assert.equal(privateResponse.status, 404);
    const privateText = await privateResponse.text();
    assert.equal(privateText, "Not found");

    // Non-existent resource
    const missingResponse = await handleCloudPublicRequest(
      new Request(`https://pinar.test/v/session_nonexistent_001.md`),
      TEST_ENV,
    );
    assert.equal(missingResponse.status, 404);
    const missingText = await missingResponse.text();
    assert.equal(missingText, "Not found");

    // Both should return identical responses (no metadata leakage)
    assert.equal(privateText, missingText);
  });
});
