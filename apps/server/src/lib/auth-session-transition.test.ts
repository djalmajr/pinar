/**
 * The client-side transition of the auth state. The repo has no DOM test
 * environment (no jsdom/happy-dom/@testing-library; `bun test` is the
 * runner and `renderToString` does not run effects), so the transition the
 * mounted effect performs is exercised through the pure functions it uses
 * (`reduceAuthSessionState`, `nextAuthSessionRetryDelay`) plus the real
 * fetch layer; the two ends of the sequence in the UI (the SSR paints) are
 * asserted in `auth-session-ssr.test.tsx` (unknown -> placeholder without
 * "Sign in" and no card; Pro -> "Open app").
 */
import { expect, mock, test } from "bun:test";

const ENV = import.meta.env as Record<string, unknown>;

const {
  authSessionCacheForTests,
  nextAuthSessionRetryDelay,
  reduceAuthSessionState,
  refreshAuthSession,
  resetAuthSessionForTests,
  subscribeAuthSession,
} = await import("./auth-session");

const PRO_SESSION = {
  billingAvailable: true,
  email: "transition-pro@pinar.test",
  kind: "account",
  plan: "pro",
  userId: "usr_transition_pro",
} as const;

// `bun test`'s `import.meta.env` is string-based: delete `SSR` for the
// client-side fetch layer.
const savedSsr = ENV.SSR;
delete ENV.SSR;

const originalFetch = globalThis.fetch;
function restoreEnv() {
  globalThis.fetch = originalFetch;
  if (savedSsr === undefined) delete ENV.SSR;
  else ENV.SSR = savedSsr;
}

test("a failed fetch (unknown) never replaces the state the UI already shows", () => {
  // The review's discriminating case: SSR resolved unknown, the revalidation
  // fails, and the state must stay unknown — not flip to signed-out.
  expect(reduceAuthSessionState("unknown", "unknown")).toBe("unknown");
  expect(reduceAuthSessionState("unknown", null)).toBe(null);
  expect(reduceAuthSessionState("unknown", PRO_SESSION)).toBe(PRO_SESSION);
  // Once the state is known, a failure keeps it.
  expect(reduceAuthSessionState(null, "unknown")).toBe(null);
  expect(reduceAuthSessionState(PRO_SESSION, "unknown")).toBe(PRO_SESSION);
  // Valid results always win.
  expect(reduceAuthSessionState(null, PRO_SESSION)).toBe(PRO_SESSION);
  expect(reduceAuthSessionState(PRO_SESSION, null)).toBe(null);
});

test("exactly one automatic retry, only while unknown, and never a loop", () => {
  expect(nextAuthSessionRetryDelay("unknown", false, 3_000)).toBe(3_000);
  // Once scheduled, no further retry even if the retry also fails.
  expect(nextAuthSessionRetryDelay("unknown", true, 3_000)).toBe(null);
  // Known states (session or confirmed signed-out) never schedule a retry.
  expect(nextAuthSessionRetryDelay(null, false, 3_000)).toBe(null);
  expect(nextAuthSessionRetryDelay(PRO_SESSION, false, 3_000)).toBe(null);
});

test("SSR unknown -> failed fetch keeps unknown, schedules the single retry, and does not cache the failure", async () => {
  resetAuthSessionForTests();
  globalThis.fetch = mock(() => Promise.reject(new TypeError("network down"))) as typeof fetch;
  try {
    const first = await refreshAuthSession();
    // The failure classifies as unknown, never signed-out.
    expect(first).toBe("unknown");
    // The mounted state transition keeps the placeholder.
    let state: "unknown" | null | typeof PRO_SESSION = "unknown";
    state = reduceAuthSessionState(state, first);
    expect(state).toBe("unknown");
    // Exactly one retry is scheduled; nothing after it (no loop).
    expect(nextAuthSessionRetryDelay(state, false, 3_000)).toBe(3_000);
    expect(nextAuthSessionRetryDelay(state, true, 3_000)).toBe(null);
    // The failure must not sit in the module cache.
    expect(authSessionCacheForTests()).toBe("empty");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the next call retries, and a successful fetch resolves to the session", async () => {
  resetAuthSessionForTests();
  const fetchMock = mock((..._args: unknown[]) =>
    Promise.resolve(
      new Response(JSON.stringify({ session: PRO_SESSION }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    ),
  ) as unknown as typeof fetch;
  globalThis.fetch = fetchMock;
  try {
    const state = reduceAuthSessionState("unknown", "unknown");
    expect(state).toBe("unknown");
    const resolved = await refreshAuthSession();
    expect(resolved).toEqual(PRO_SESSION);
    // The transition lands on the session: "Open app" paint (see the SSR
    // paint tests for the HTML assertion).
    expect(reduceAuthSessionState(state, resolved)).toEqual(PRO_SESSION);
    expect(authSessionCacheForTests()).toBe("populated");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Fake timers for the subscription lifecycle: the retry timer is observed
// and fired by hand, never waited on.
function installFakeTimers() {
  const savedSet = globalThis.setTimeout;
  const savedClear = globalThis.clearTimeout;
  const timers = new Map<number, () => void>();
  let nextId = 1;
  globalThis.setTimeout = ((fn: () => void) => {
    const id = nextId++;
    timers.set(id, fn);
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    timers.delete(id);
  }) as unknown as typeof clearTimeout;
  return {
    fireAll() {
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) fn();
    },
    pending: () => timers.size,
    restore() {
      globalThis.setTimeout = savedSet;
      globalThis.clearTimeout = savedClear;
    },
  };
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

test("a subscriber that unmounts before the failed fetch settles gets no write and leaves no retry", async () => {
  resetAuthSessionForTests();
  let reject!: (error: Error) => void;
  const fetchMock = mock(() => new Promise<Response>((_resolve, fail) => { reject = fail; }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const timers = installFakeTimers();
  try {
    const applied: unknown[] = [];
    const cleanup = subscribeAuthSession("unknown", (result) => applied.push(result));
    cleanup();
    reject(new TypeError("network down"));
    await settle();
    expect(applied).toEqual([]);
    expect(timers.pending()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    timers.restore();
    globalThis.fetch = originalFetch;
  }
});

test("simultaneous subscribers share one request and one retry, and the retry never loops", async () => {
  resetAuthSessionForTests();
  const fetchMock = mock(() => Promise.reject(new TypeError("network down")));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const timers = installFakeTimers();
  try {
    const applied: unknown[][] = [[], [], [], []];
    const cleanups = applied.map((log) => subscribeAuthSession("unknown", (result) => log.push(result)));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(timers.pending()).toBe(1);
    timers.fireAll();
    await settle();
    // The single retry failed too: no new timer, no loop.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(timers.pending()).toBe(0);
    // Every write was a failure, which the reducer ignores.
    for (const log of applied) expect(log.every((result) => result === "unknown")).toBe(true);
    for (const cleanup of cleanups) cleanup();
  } finally {
    timers.restore();
    globalThis.fetch = originalFetch;
  }
});

test("the last subscriber leaving cancels the pending retry", async () => {
  resetAuthSessionForTests();
  const fetchMock = mock(() => Promise.reject(new TypeError("network down")));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const timers = installFakeTimers();
  try {
    const first = subscribeAuthSession("unknown", () => {});
    const second = subscribeAuthSession("unknown", () => {});
    await settle();
    expect(timers.pending()).toBe(1);
    first();
    // Someone still listens: the retry stays.
    expect(timers.pending()).toBe(1);
    second();
    expect(timers.pending()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    timers.restore();
    globalThis.fetch = originalFetch;
  }
});

test("a successful retry reaches every subscriber still mounted", async () => {
  resetAuthSessionForTests();
  let calls = 0;
  const fetchMock = mock(() => {
    calls += 1;
    if (calls === 1) return Promise.reject(new TypeError("network down"));
    return Promise.resolve(
      new Response(JSON.stringify({ session: PRO_SESSION }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const timers = installFakeTimers();
  try {
    const mounted: unknown[] = [];
    const gone: unknown[] = [];
    const cleanupMounted = subscribeAuthSession("unknown", (result) => mounted.push(result));
    const cleanupGone = subscribeAuthSession("unknown", (result) => gone.push(result));
    await settle();
    cleanupGone();
    timers.fireAll();
    await settle();
    expect(mounted.at(-1)).toEqual(PRO_SESSION);
    // Before its cleanup the subscriber only saw failures (the listener and
    // the revalidation both deliver it); after it, nothing reaches it.
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.every((result) => result === "unknown")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    cleanupMounted();
  } finally {
    timers.restore();
    globalThis.fetch = originalFetch;
  }
});
