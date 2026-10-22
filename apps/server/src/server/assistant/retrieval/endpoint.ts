// JSON POST to an OpenAI-compatible endpoint, with the protections of the
// F1 chat model (models.ts):
// - assertAssistantBaseUrl: https anywhere, http only on loopback, no
//   userinfo, query or fragment;
// - guardRedirects: the fetch runs with redirect:"manual" and any 3xx is
//   refused without following Location;
// - the key travels only in the Authorization header;
// - every request has a deadline (AbortSignal.timeout).
//
// Errors carry a fixed message and the HTTP status at most: never the
// URL, the key, the request or the response body. Nothing is logged.

import { assertAssistantBaseUrl, guardRedirects } from "../models";

// POSTs `body` as JSON to `{baseUrl}{path}` and returns the parsed JSON.
// `label` names the request in errors ("embedding request failed").
export async function postEndpointJson(input: {
  apiKey?: string;
  baseUrl: string;
  body: unknown;
  fetch?: typeof fetch;
  label: string;
  path: string;
  timeoutMs: number;
}): Promise<unknown> {
  assertAssistantBaseUrl(input.baseUrl);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.apiKey) headers["Authorization"] = `Bearer ${input.apiKey}`;
  const url = `${input.baseUrl.replace(/\/+$/, "")}${input.path}`;
  const signal = AbortSignal.timeout(input.timeoutMs);
  const baseFetch = input.fetch ?? fetch;
  const sanitizedFetch = (async (target: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await baseFetch(target, init);
    } catch {
      throw new Error(signal.aborted ? `${input.label} timed out` : `${input.label} failed`);
    }
  }) as typeof fetch;
  const response = await guardRedirects(sanitizedFetch)(url, {
    body: JSON.stringify(input.body),
    headers,
    method: "POST",
    signal,
  });
  if (!response.ok) throw new Error(`${input.label} failed (status ${response.status})`);
  try {
    return await response.json();
  } catch {
    throw new Error(signal.aborted ? `${input.label} timed out` : `${input.label} returned invalid JSON`);
  }
}
