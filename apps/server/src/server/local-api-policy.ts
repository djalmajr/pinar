import { classifyLocalApiRequest } from "./local-api-trust";
import {
  LOCAL_CAPABILITY_HEADER,
  capabilitySecretFromRequest,
  localCapabilityMatches,
} from "./local-capability";

export const LOCAL_UNAUTHORIZED_BODY = { error: "unauthorized" } as const;

const LOCAL_CORS_ALLOW_HEADERS = `authorization, content-type, x-pinar-installation-id, ${LOCAL_CAPABILITY_HEADER}`;
const LOCAL_CORS_ALLOW_METHODS = "DELETE, GET, OPTIONS, PATCH, POST";

export function requestOrigin(request: Request) {
  return request.headers.get("origin")?.trim() || "";
}

export function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return false;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export function isChromeExtensionOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "chrome-extension:" && /^[a-z0-9-]+$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function isAllowedCorsOrigin(origin: string) {
  return isLoopbackOrigin(origin) || isChromeExtensionOrigin(origin);
}

function isHostileOrigin(origin: string) {
  return origin.length > 0 && !isAllowedCorsOrigin(origin);
}

function applyLocalCorsHeaders(request: Request, headers: Headers) {
  headers.set("Vary", "Origin");
  const origin = requestOrigin(request);
  if (!origin || !isAllowedCorsOrigin(origin)) return;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", LOCAL_CORS_ALLOW_HEADERS);
  headers.set("Access-Control-Allow-Methods", LOCAL_CORS_ALLOW_METHODS);
}

function localSecurityHeaders() {
  return new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
}

export function localApiPreflightResponse(request: Request) {
  const headers = localSecurityHeaders();
  applyLocalCorsHeaders(request, headers);
  return new Response(null, { headers, status: 204 });
}

export function unauthorizedLocalApiResponse(request: Request) {
  const headers = localSecurityHeaders();
  applyLocalCorsHeaders(request, headers);
  return Response.json(LOCAL_UNAUTHORIZED_BODY, { headers, status: 401 });
}

export function withLocalApiHeaders(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  applyLocalCorsHeaders(request, headers);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function pairingKind(method: string, path: string) {
  if (method === "GET" && path === "/api/local/capability") return "bootstrap" as const;
  if (method === "POST" && path === "/api/local/capability/rotate") return "rotate" as const;
  if (method === "POST" && path === "/api/local/capability/revoke") return "revoke" as const;
  return null;
}

export async function denyUnauthorizedLocalApi(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const pairing = pairingKind(request.method, url.pathname);
  if (pairing === "bootstrap") {
    return isHostileOrigin(origin) ? unauthorizedLocalApiResponse(request) : null;
  }
  if (pairing === "rotate" || pairing === "revoke") {
    if (isHostileOrigin(origin)) return unauthorizedLocalApiResponse(request);
    return (await localCapabilityMatches(capabilitySecretFromRequest(request)))
      ? null
      : unauthorizedLocalApiResponse(request);
  }

  const entry = classifyLocalApiRequest(request.method, url.pathname);
  const trustClass = entry?.class ?? "sensitive-read";
  if (trustClass === "public-min" || trustClass === "local-public-projection") return null;
  if (isHostileOrigin(origin)) return unauthorizedLocalApiResponse(request);
  if (isLoopbackOrigin(origin) || !origin) return null;
  if (isChromeExtensionOrigin(origin) && await localCapabilityMatches(capabilitySecretFromRequest(request))) {
    return null;
  }
  return unauthorizedLocalApiResponse(request);
}

export async function localApiRequestAllowed(request: Request) {
  return (await denyUnauthorizedLocalApi(request)) === null;
}
