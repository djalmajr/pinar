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
import { ByokCallError } from "../../byok/cause";

// POSTs `body` as JSON to `{baseUrl}{path}` and returns the parsed JSON.
// `label` names the request in errors ("embedding request failed").
export async function postEndpointJson(input: {
  apiKey?: string;
  baseUrl: string;
  body: unknown;
  byok?: boolean; // F5/S3c: the user's BYOK call (the caused 2xx failures)
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
  // Network and deadline failures get a fixed message below the redirect
  // guard, so its own refusal still reaches the caller as is. The BYOK
  // egress's caused error (F5/S3c) passes through untouched: its cause is
  // the caller's (the destination records it in the choice's result), and
  // the fixed message still carries no URL, no key, no body.
  const sanitizedFetch = (async (target: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await baseFetch(target, init);
    } catch (error) {
      if (error instanceof ByokCallError) throw error;
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
    // F5/S3c: the user's BYOK 2xx that cannot be parsed (or the deadline
    // cut its body mid-read) is the caused ByokCallError at the
    // operation's boundary — the caller's cause table, the fixed message
    // — never a generic error that loses the cause at the layer's
    // boundary. The deployment's endpoints keep their fixed message.
    if (input.byok === true) throw new ByokCallError({ cause: signal.aborted ? "timeout" : "invalid_response", retryAfterSeconds: null });
    throw new Error(signal.aborted ? `${input.label} timed out` : `${input.label} returned invalid JSON`);
  }
}
