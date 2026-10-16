import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthSession } from "@pinar/shared";
import { isRecord } from "@/lib/api-data";

// The session as seen by the UI: a resolved session, a confirmed signed-out
// state (null), or "unknown" when no valid response has been seen yet and
// the UI must stay neutral (no "sign in" swap, no support-card flash).
export type AuthSessionState = AuthSession | null | "unknown";

const AuthSessionContext = createContext<AuthSessionState>("unknown");

export function AuthSessionProvider({
  children,
  initialSession,
}: {
  children: ReactNode;
  initialSession: AuthSessionState;
}) {
  return createElement(AuthSessionContext.Provider, { value: initialSession }, children);
}

// A failed fetch ("unknown") is no information about the session and must
// never replace the state a surface is already showing: while unknown the
// placeholder stays; once known, only a valid result may change it.
export function reduceAuthSessionState(
  current: AuthSessionState,
  result: AuthSessionState,
): AuthSessionState {
  return result === "unknown" ? current : result;
}

// While the state is still unknown, allow exactly one automatic retry
// after `delayMs`; once it has been scheduled (or the state is known) there
// is no further retry — the placeholder stays, no loop.
export function nextAuthSessionRetryDelay(
  state: AuthSessionState,
  retryScheduled: boolean,
  delayMs: number,
): number | null {
  if (state !== "unknown" || retryScheduled) return null;
  return delayMs;
}

const AUTH_SESSION_RETRY_DELAY_MS = 3_000;

let sessionRequest: Promise<AuthSessionState> | null = null;
const sessionListeners = new Set<(session: AuthSessionState) => void>();
// The automatic retry is shared by every subscriber of the page: one timer
// at most, scheduled only while someone listens, cancelled when the last
// subscriber leaves.
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryScheduled = false;

export function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "local") return value.plan === "free";
  if (value.kind === "installation") {
    return value.plan === "free" && typeof value.installationId === "string";
  }
  if (value.kind !== "account" || typeof value.email !== "string" || typeof value.userId !== "string") {
    return false;
  }
  return value.plan === "free" || value.plan === "pro";
}

function notifyAuthSession(session: AuthSessionState) {
  for (const listener of sessionListeners) listener(session);
}

// The `/api/auth/session` contract (cloud-api.ts `authSession`,
// api.local.ts): 200 with a body `isAuthSession` accepts is a valid session,
// 401 with `session: null` is the signed-out shape. Everything else (5xx,
// network failure, an invalid body, a 200 with `session: null` or a
// malformed session, a 401 without that body) is unknown — a failure must
// never look like signed-out.
function classifySessionResponse(status: number, data: unknown): AuthSessionState {
  if (status === 200) {
    const session = isRecord(data) && "session" in data
      ? (data as { session: unknown }).session
      : undefined;
    if (isAuthSession(session)) return session;
    return "unknown";
  }
  if (status === 401 && isRecord(data) && data.session === null) return null;
  return "unknown";
}

function requestAuthSession(): Promise<AuthSessionState> {
  sessionRequest ??= fetch("/api/auth/session", { cache: "no-store" })
    .then((response) =>
      response
        .json()
        .then((data) => classifySessionResponse(response.status, data))
        .catch((): AuthSessionState => "unknown"),
    )
    .catch((): AuthSessionState => "unknown")
    .then((state) => {
      if (state === "unknown") {
        // A failure is not a result: it must not sit in the module cache,
        // so the next caller retries instead of reading the failure.
        sessionRequest = null;
      }
      notifyAuthSession(state);
      return state;
    });
  return sessionRequest;
}

export function refreshAuthSession(): Promise<AuthSessionState> {
  sessionRequest = null;
  return requestAuthSession();
}

// Seeds the client module cache with the value the server resolved for this
// page load, so the client does not refetch /api/auth/session just to
// confirm what the SSR already established. The guard keeps the server's
// module state free of per-request sessions: the same process renders many
// users, and a cached session would leak across requests.
function seedAuthSessionCache(session: AuthSession | null) {
  if (import.meta.env.SSR) return;
  sessionRequest ??= Promise.resolve(session);
}

// At most one automatic retry after a few seconds, only while the state is
// still unknown and someone still listens; after it the placeholder stays
// (no loop).
function scheduleAuthSessionRetry(result: AuthSessionState) {
  const delay = nextAuthSessionRetryDelay(result, retryScheduled, AUTH_SESSION_RETRY_DELAY_MS);
  if (delay === null || sessionListeners.size === 0) return;
  retryScheduled = true;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (sessionListeners.size > 0) void requestAuthSession();
  }, delay);
}

// The body of the hook's effect, kept outside React so its lifecycle is
// testable: it subscribes `apply` to session results, revalidates when the
// SSR could not resolve the session, and returns the cleanup. Nothing runs
// for a subscriber after its cleanup: no state write, no retry scheduled.
export function subscribeAuthSession(
  initial: AuthSessionState,
  apply: (result: AuthSessionState) => void,
): () => void {
  let active = true;
  const listener = (result: AuthSessionState) => {
    if (active) apply(result);
  };
  sessionListeners.add(listener);
  if (initial === "unknown") {
    // The server could not resolve the session: revalidate. If another
    // subscriber already fetched, the module cache answers without a new
    // request (a cached promise does not notify again, hence the apply).
    void requestAuthSession().then((result) => {
      if (!active) return;
      apply(result);
      scheduleAuthSessionRetry(result);
    });
  } else {
    // The module cache may already hold a newer value than the page-load
    // initial (for example after a checkout called refreshAuthSession):
    // sync from it without a new request.
    void sessionRequest?.then(listener);
  }
  return () => {
    active = false;
    sessionListeners.delete(listener);
    if (sessionListeners.size === 0 && retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
}

function useLiveAuthSession(): AuthSessionState {
  const initial = useContext(AuthSessionContext);
  const [session, setSession] = useState<AuthSessionState>(() => {
    // The initializer runs during SSR too; seeding there is a no-op thanks
    // to the SSR guard above.
    if (initial !== "unknown") seedAuthSessionCache(initial);
    return initial;
  });

  // Every write goes through the reducer: a failed fetch (unknown) never
  // turns "unknown" into "signed out" nor overwrites a known state.
  useEffect(
    () => subscribeAuthSession(initial, (result) => setSession((current) => reduceAuthSessionState(current, result))),
    [initial],
  );

  return session;
}

// Full tri-state for the surfaces that must distinguish "signed out" from
// "still unknown" (the header CTA and the Fair Source support card).
export function useAuthSessionState(): AuthSessionState {
  return useLiveAuthSession();
}

export function useAuthSession(): AuthSession | null {
  const session = useLiveAuthSession();
  return session === "unknown" ? null : session;
}

export function isPaidAuthSession(session: AuthSession | null) {
  return session?.kind === "account"
    && session.plan === "pro";
}

// Test-only: inspect/reset the module-level session cache.
export function authSessionCacheForTests(): "empty" | "populated" {
  return sessionRequest === null ? "empty" : "populated";
}

export function resetAuthSessionForTests() {
  sessionRequest = null;
  sessionListeners.clear();
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  retryScheduled = false;
}
