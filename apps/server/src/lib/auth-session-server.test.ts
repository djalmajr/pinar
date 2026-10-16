/**
 * Unit tests for the SSR session resolver: it must apply exactly the same
 * rules as the running surface's `/api/auth/session` endpoint (the real
 * Cloud and local API handlers) and turn resolution errors into
 * "unknown", never into "signed out".
 */
import { expect, mock, test } from "bun:test";

// The resolver reads the SSR request context from this module; the unit
// tests never call `resolveRequestAuthSession`, so a minimal double is
// enough.
mock.module("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  getRequestUrl: () => new URL("https://pinar.test/?lang=en"),
  getResponseHeader: () => undefined,
  setResponseHeader: () => {},
}));

const { handleCloudApiRequest, resetCloudMemoryStateForTests, seedCloudWebSessionForTests } =
  await import("../server/cloud-api");
const { handleApiRequest: handleLocalApiRequest } = await import("../server/api.local");
const { resolveAuthSessionForRequest } = await import("./auth-session-server");

const CLOUD_ENV = {
  AUTH_PEPPER: "auth-session-server-test-pepper",
  EXTENSION_ORIGIN: "chrome-extension://pinar-ssr-test",
};

function pageRequest(cookie?: string): Request {
  return new Request("https://pinar.test/pricing?lang=en", {
    headers: cookie ? { cookie } : {},
  });
}

test("cloud: a request without a session cookie resolves to signed-out", async () => {
  resetCloudMemoryStateForTests();
  const resolution = await resolveAuthSessionForRequest(
    pageRequest(),
    (request) => handleCloudApiRequest(request, CLOUD_ENV),
  );
  expect(resolution.status).toBe("resolved");
  expect(resolution.session).toBeNull();
});

test("cloud: a valid Free session resolves with the account session", async () => {
  resetCloudMemoryStateForTests();
  const seeded = await seedCloudWebSessionForTests({
    email: "resolver-free@pinar.test",
    plan: "free",
  });
  const resolution = await resolveAuthSessionForRequest(
    pageRequest(seeded.cookie),
    (request) => handleCloudApiRequest(request, CLOUD_ENV),
  );
  expect(resolution.status).toBe("resolved");
  expect(resolution.session).toEqual({
    billingAvailable: expect.any(Boolean),
    email: "resolver-free@pinar.test",
    kind: "account",
    plan: "free",
    userId: seeded.accountId,
  });
});

test("cloud: a valid Pro session resolves with the account session", async () => {
  resetCloudMemoryStateForTests();
  const seeded = await seedCloudWebSessionForTests({
    email: "resolver-pro@pinar.test",
    plan: "pro",
  });
  const resolution = await resolveAuthSessionForRequest(
    pageRequest(seeded.cookie),
    (request) => handleCloudApiRequest(request, CLOUD_ENV),
  );
  expect(resolution.status).toBe("resolved");
  expect(resolution.session).toMatchObject({
    email: "resolver-pro@pinar.test",
    kind: "account",
    plan: "pro",
  });
});

test("cloud: a resolution error is unknown, not signed-out", async () => {
  const handler = () => Promise.reject(new Error("db down"));
  expect(await resolveAuthSessionForRequest(pageRequest(), handler)).toEqual({
    status: "unknown",
  });
});

test("cloud: a non-session error status is unknown", async () => {
  const handler = async () =>
    new Response(JSON.stringify({ error: "boom" }), { status: 500 });
  expect(await resolveAuthSessionForRequest(pageRequest(), handler)).toEqual({
    status: "unknown",
  });
});

test("cloud: a 401 without the session body is unknown", async () => {
  const handler = async () => new Response(null, { status: 401 });
  expect(await resolveAuthSessionForRequest(pageRequest(), handler)).toEqual({
    status: "unknown",
  });
});

test("cloud: a 200 with a malformed session body is unknown", async () => {
  const handler = async () =>
    new Response(JSON.stringify({ session: { kind: "account", plan: "pro" } }), {
      status: 200,
    });
  expect(await resolveAuthSessionForRequest(pageRequest(), handler)).toEqual({
    status: "unknown",
  });
});

test("cloud: the request handed to the handler is a /api/auth/session GET with the page cookie", async () => {
  resetCloudMemoryStateForTests();
  const seeded = await seedCloudWebSessionForTests({
    email: "resolver-headers@pinar.test",
    plan: "free",
  });
  let seen: Request | null = null;
  const handler = async (request: Request) => {
    seen = request;
    return handleCloudApiRequest(request, CLOUD_ENV);
  };
  const resolution = await resolveAuthSessionForRequest(pageRequest(seeded.cookie), handler);
  expect(resolution.status).toBe("resolved");
  expect(seen).toBeInstanceOf(Request);
  if (seen) {
    expect(seen.method).toBe("GET");
    expect(new URL(seen.url).pathname).toBe("/api/auth/session");
    expect(seen.headers.get("cookie")).toBe(seeded.cookie);
  }
});

test("local: the session is the static local/free session", async () => {
  const resolution = await resolveAuthSessionForRequest(
    pageRequest(),
    (request) => handleLocalApiRequest(request),
  );
  expect(resolution).toEqual({
    session: { kind: "local", plan: "free" },
    status: "resolved",
  });
});
