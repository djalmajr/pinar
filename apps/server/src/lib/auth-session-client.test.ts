/**
 * Client-side behaviour of the auth session module:
 * - the fetch contract is the tri-state: a valid session (200 + body
 *   accepted by `isAuthSession`), a confirmed signed-out state (401 with
 *   `session: null`), and "unknown" for everything else (5xx, malformed or
 *   200-with-`session: null` bodies, network errors) — a failure never
 *   looks like signed-out;
 * - a failure is never kept in the module cache: the next call retries;
 * - the per-request SSR value seeds the module cache on the client only.
 */
import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const ENV = import.meta.env as Record<string, unknown>;

const {
  AuthSessionProvider,
  authSessionCacheForTests,
  isAuthSession,
  refreshAuthSession,
  resetAuthSessionForTests,
  useAuthSession,
  useAuthSessionState,
} = await import("./auth-session");

const PRO_SESSION = {
  billingAvailable: true,
  email: "client-test@pinar.test",
  kind: "account",
  plan: "pro",
  userId: "usr_client_test",
} as const;
const FREE_SESSION = {
  billingAvailable: false,
  email: "client-free@pinar.test",
  kind: "account",
  plan: "free",
  userId: "usr_client_free",
} as const;

// `bun test`'s `import.meta.env` is string-based: a truthy `SSR` value
// simulates the server, and its absence (delete) simulates the client.
function withEnvSsr(ssr: boolean, run: () => void | Promise<void>) {
  const saved = ENV.SSR;
  if (ssr) ENV.SSR = "true";
  else delete ENV.SSR;
  return (async () => {
    try {
      await run();
    } finally {
      if (saved === undefined) delete ENV.SSR;
      else ENV.SSR = saved;
    }
  })();
}

function jsonFetch(status: number, body: unknown): typeof fetch {
  return mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
        status,
      }),
    ),
  ) as unknown as typeof fetch;
}

function rawFetch(status: number, text: string): typeof fetch {
  return mock(() =>
    Promise.resolve(new Response(text, { status })),
  ) as unknown as typeof fetch;
}

function networkErrorFetch(): typeof fetch {
  return mock(() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
}

async function runFetchCase(
  install: () => typeof fetch,
  expectCache: "empty" | "populated",
) {
  const originalFetch = globalThis.fetch;
  const fetchMock = install();
  globalThis.fetch = fetchMock;
  try {
    resetAuthSessionForTests();
    const result = await refreshAuthSession();
    return { fetchMock, result, expectCache };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("200 with a valid Pro session resolves the session and caches it", async () =>
  withEnvSsr(false, async () => {
    const { fetchMock, result, expectCache } = await runFetchCase(
      () => jsonFetch(200, { session: PRO_SESSION }),
      "populated",
    );
    expect(result).toEqual(PRO_SESSION);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authSessionCacheForTests()).toBe(expectCache);
  }));

test("200 with a valid Free session resolves the session", async () =>
  withEnvSsr(false, async () => {
    const { result } = await runFetchCase(
      () => jsonFetch(200, { session: FREE_SESSION }),
      "populated",
    );
    expect(result).toEqual(FREE_SESSION);
  }));

test("401 with session:null is the confirmed signed-out state", async () =>
  withEnvSsr(false, async () => {
    const { result, expectCache } = await runFetchCase(
      () => jsonFetch(401, { session: null }),
      "populated",
    );
    expect(result).toBe(null);
    // A valid signed-out response is a result: it is cached.
    expect(authSessionCacheForTests()).toBe(expectCache);
  }));

test("500 is unknown, not signed-out", async () =>
  withEnvSsr(false, async () => {
    const { result } = await runFetchCase(() => jsonFetch(500, { error: "boom" }), "empty");
    expect(result).toBe("unknown");
    expect(authSessionCacheForTests()).toBe("empty");
  }));

test("an invalid JSON body is unknown", async () =>
  withEnvSsr(false, async () => {
    const { result } = await runFetchCase(() => rawFetch(200, "<html>gateway</html>"), "empty");
    expect(result).toBe("unknown");
    expect(authSessionCacheForTests()).toBe("empty");
  }));

test("a network error is unknown", async () =>
  withEnvSsr(false, async () => {
    const { result } = await runFetchCase(networkErrorFetch, "empty");
    expect(result).toBe("unknown");
    expect(authSessionCacheForTests()).toBe("empty");
  }));

test("200 with a malformed session body is unknown", async () =>
  withEnvSsr(false, async () => {
    const { result } = await runFetchCase(
      () => jsonFetch(200, { session: { kind: "account", plan: "pro" } }),
      "empty",
    );
    expect(result).toBe("unknown");
    expect(authSessionCacheForTests()).toBe("empty");
  }));

test("200 with session:null is unknown: it is not the endpoint contract", async () =>
  withEnvSsr(false, async () => {
    const { result } = await runFetchCase(() => jsonFetch(200, { session: null }), "empty");
    expect(result).toBe("unknown");
    expect(authSessionCacheForTests()).toBe("empty");
  }));

test("401 without the signed-out body is unknown", async () =>
  withEnvSsr(false, async () => {
    const { result } = await runFetchCase(
      () => jsonFetch(401, { error: "Unauthorized" }),
      "empty",
    );
    expect(result).toBe("unknown");
    expect(authSessionCacheForTests()).toBe("empty");
  }));

test("a failure is not kept in the module cache: the next call retries", async () =>
  withEnvSsr(false, async () => {
    const originalFetch = globalThis.fetch;
    const failFetch = networkErrorFetch();
    globalThis.fetch = failFetch;
    try {
      resetAuthSessionForTests();
      const first = await refreshAuthSession();
      expect(first).toBe("unknown");
      expect(authSessionCacheForTests()).toBe("empty");
      // The next call starts a new request instead of reading the failure.
      const okFetch = jsonFetch(200, { session: PRO_SESSION });
      globalThis.fetch = okFetch;
      const second = await refreshAuthSession();
      expect(second).toEqual(PRO_SESSION);
      expect(okFetch).toHaveBeenCalledTimes(1);
      expect(failFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }));

test("SSR render: the module cache is not seeded (server keeps no session in module state)", () =>
  withEnvSsr(true, () => {
    resetAuthSessionForTests();
    const html = renderToString(
      createElement(
        AuthSessionProvider,
        { initialSession: PRO_SESSION },
        createElement(() => {
          const session = useAuthSession();
          return createElement("output", null, session === null ? "null" : `plan=${session.plan}`);
        }),
      ),
    );
    expect(html).toContain("plan=pro");
    expect(authSessionCacheForTests()).toBe("empty");
  }));

test("client render: the initial value seeds the module cache without a fetch", () =>
  withEnvSsr(false, () => {
    resetAuthSessionForTests();
    const html = renderToString(
      createElement(
        AuthSessionProvider,
        { initialSession: PRO_SESSION },
        createElement(() => {
          const session = useAuthSession();
          return createElement("output", null, session === null ? "null" : `plan=${session.plan}`);
        }),
      ),
    );
    expect(html).toContain("plan=pro");
    expect(authSessionCacheForTests()).toBe("populated");
  }));

test("unknown initial value renders as signed-out (legacy mapping) without seeding the cache", () =>
  withEnvSsr(false, () => {
    resetAuthSessionForTests();
    const html = renderToString(
      createElement(
        AuthSessionProvider,
        { initialSession: "unknown" },
        createElement(() => {
          const state = useAuthSessionState();
          const session = useAuthSession();
          const stateLabel = state === "unknown" ? "unknown" : state === null ? "null" : "session";
          const sessionLabel = session === null ? "null" : `plan=${session.plan}`;
          return createElement("output", null, `${stateLabel}|${sessionLabel}`);
        }),
      ),
    );
    // The tri-state consumer sees unknown; the legacy consumer sees null.
    expect(html).toContain("unknown|null");
    expect(authSessionCacheForTests()).toBe("empty");
  }));

test("hostile session bodies are rejected by isAuthSession", () => {
  // The full public-shape contract is covered in auth-session.test.ts;
  // these are the hostile variants the client cache additionally guards.
  expect(isAuthSession("pro")).toBe(false);
  expect(isAuthSession({ ...PRO_SESSION, email: 42 })).toBe(false);
  expect(isAuthSession({ ...PRO_SESSION, userId: { toString: () => "usr" } })).toBe(false);
  expect(isAuthSession(JSON.parse(JSON.stringify(PRO_SESSION), (_, value) => value))).toBe(true);
  expect(isAuthSession({ kind: "local", plan: "free", __proto__: null })).toBe(true);
});
