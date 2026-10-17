// EdgeR stand-in for @vercel/oidc. The real module builds a user agent with
// os.hostname() at import time, which Deno denies on EdgeR (no sys access),
// so importing the AI SDK would throw. EdgeR is not a Vercel deployment and
// has no OIDC token; the AI SDK gateway reads only these two exports, and
// with an API key (AI_GATEWAY_API_KEY or the apiKey option) it never asks
// for a token.
export function getContext(): { headers?: Record<string, string> } {
  return {};
}

export async function getVercelOidcToken(): Promise<string> {
  throw new Error("Vercel OIDC is not available on EdgeR");
}
