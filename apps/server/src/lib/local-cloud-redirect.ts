import { redirect } from "@tanstack/react-router";
import { pinarRuntime, type PinarRuntime } from "./server-header";

export const PINAR_CLOUD_ORIGIN = "https://pinar.dev";

const CLOUD_ONLY_PATHS = new Set(["/pricing", "/sign-in", "/success"]);

export function cloudRedirectLocation(
  runtime: PinarRuntime,
  pathname: string,
  search = "",
): string | null {
  if (runtime !== "local") return null;
  if (!CLOUD_ONLY_PATHS.has(pathname)) return null;
  return `${PINAR_CLOUD_ORIGIN}${pathname}${search}`;
}

export function localCloudRedirectResponse(request: Request): Response | null {
  const url = new URL(request.url);
  const location = cloudRedirectLocation(pinarRuntime(), url.pathname, url.search);
  if (!location) return null;
  return new Response(null, {
    headers: { Location: location },
    status: 302,
  });
}

export function throwIfLocalCloudRedirect(pathname: string, search = "") {
  const href = cloudRedirectLocation(pinarRuntime(), pathname, search);
  if (href) throw redirect({ href });
}

export function throwIfLocalCloudLocation(href: string, pathname: string) {
  const url = new URL(href, PINAR_CLOUD_ORIGIN);
  throwIfLocalCloudRedirect(pathname, url.search);
}

export function localCloudRedirectOrNext<TNext>(
  request: Request,
  next: () => TNext,
): Response | TNext {
  return localCloudRedirectResponse(request) ?? next();
}
