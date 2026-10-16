import {
  getRequestHeader,
  getRequestUrl,
  getResponseHeader,
  setResponseHeader,
} from "@tanstack/react-start/server";
import type { AuthSession } from "@pinar/shared";
import { isRecord } from "./api-data";
import { isAuthSession } from "./auth-session";

export type AuthSessionResolution =
  | { session: AuthSession | null; status: "resolved" }
  | { status: "unknown" };

const SESSION_PATH = "/api/auth/session";

// The cookie the Cloud `authSession` endpoint reads (`WEB_SESSION_COOKIE`,
// cloud-api.ts).
const WEB_SESSION_COOKIE = "pinar_session";

export function hasWebSessionCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  const prefix = `${WEB_SESSION_COOKIE}=`;
  return cookieHeader.split(";").some((pair) => {
    const trimmed = pair.trim();
    return trimmed.startsWith(prefix) && trimmed.length > prefix.length;
  });
}

// HTML served with a Cloud session cookie must not sit in a shared cache:
// the same URL renders a different page per user. `private, no-cache` (not
// `no-store`, which would also kill the browser back/forward cache) is
// added with the same `setResponseHeader` mechanism as `Vary`
// (language-server.ts), and only on the root SSR path; a Cache-Control set
// earlier elsewhere wins.
function forbidSharedCacheForSessionHtml() {
  if (!hasWebSessionCookie(getRequestHeader("cookie"))) return;
  if (getResponseHeader("cache-control")) return;
  setResponseHeader("cache-control", "private, no-cache");
}

/**
 * Resolves the session exactly the way the running surface's `/api/auth/session`
 * endpoint would: the request's headers are handed to that surface's API
 * handler (`@/server/api`), so no session rule is duplicated here.
 *
 * - `resolved` with a session: the request is signed in.
 * - `resolved` with `null`: the request has no valid session (the endpoint's
 *   401 signed-out shape).
 * - `unknown`: anything that is not one of the two shapes above (errors,
 *   non-JSON bodies, unexpected statuses) must not be presented as signed
 *   out, or a paid user would briefly see the signed-out UI.
 */
export function resolveAuthSessionForRequest(
  request: Request,
  handleApiRequest: (request: Request) => Promise<Response>,
): Promise<AuthSessionResolution> {
  const url = new URL(request.url);
  const sessionRequest = new Request(new URL(SESSION_PATH, url.origin).href, {
    headers: { cookie: request.headers.get("cookie") ?? "" },
    method: "GET",
  });
  return handleApiRequest(sessionRequest)
    .then(async (response) => {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { status: "unknown" } as const;
      }
      const session = isRecord(body) && "session" in body
        ? (body as { session?: unknown }).session
        : undefined;
      if (response.status === 200 && isAuthSession(session)) {
        return { session, status: "resolved" } as const;
      }
      if (response.status === 401 && session === null) {
        return { session: null, status: "resolved" } as const;
      }
      return { status: "unknown" } as const;
    })
    .catch(() => ({ status: "unknown" }) as AuthSessionResolution);
}

/**
 * Server-only: resolves the session of the current SSR request. Import this
 * module only under an `import.meta.env.SSR` guard (as `__root.tsx` does) so
 * the client bundle never pulls in `@tanstack/react-start/server` or the
 * runtime API bindings.
 */
export function resolveRequestAuthSession(): Promise<AuthSessionResolution> {
  forbidSharedCacheForSessionHtml();
  const url = getRequestUrl();
  const request = new Request(new URL(SESSION_PATH, url.origin).href, {
    headers: { cookie: getRequestHeader("cookie") ?? "" },
    method: "GET",
  });
  // Dynamic import: `@/server/api` pulls in the runtime bindings
  // (cloudflare:workers / Deno env) and must stay out of this module's
  // static graph.
  return import("@/server/api").then(
    ({ handleApiRequest }) => resolveAuthSessionForRequest(request, handleApiRequest),
  );
}
