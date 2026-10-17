// Assistant model providers.
//
// assistantLanguageModel builds a chat-completions language model over an
// OpenAI-compatible endpoint (the local appliance or a BYOK endpoint) and
// assistantProviderOptions carries the thinking-control flag into the
// request body through the providerOptions[name] escape hatch of
// @ai-sdk/openai-compatible (see dist/index.js: providerOptions
// [providerOptionsName] is spread into the args body).

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

// ai@7 declares the SDK's ProviderOptions (@ai-sdk/provider-utils
// SharedV4ProviderOptions = Record<string, JSONObject>, with the provider
// JSONValue/JSONObject from @ai-sdk/provider) but does not re-export it, and
// @ai-sdk/provider-utils is not a direct dependency of this package. Mirror
// the structural type so the contract signatures can use the name without a
// new dependency.
type JSONValue = null | string | number | boolean | Readonly<JSONObject> | readonly JSONValue[];
interface JSONObject {
  [key: string]: JSONValue;
}
export type ProviderOptions = Record<string, JSONObject>;

export interface AssistantEndpoint {
  apiKey?: string;
  baseUrl: string;
  kind: "appliance" | "openai-compatible";
  model: string;
  // true = send chat_template_kwargs.enable_thinking=false with the request
  thinkingControl: boolean;
}

const INVALID_ENDPOINT = "invalid assistant endpoint";
const REDIRECT_REFUSED = "assistant endpoint redirect refused";

// The providerOptions name also selects the header set: only the appliance
// forwards conversation/request tracing headers.
function providerName(endpoint: AssistantEndpoint): "appliance" | "byok" {
  return endpoint.kind === "appliance" ? "appliance" : "byok";
}

// Accepts https anywhere and http only on loopback. Userinfo, query and
// fragment are refused. The error never includes the URL or the key.
function assertAssistantBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(INVALID_ENDPOINT);
  }
  if (url.protocol !== "https:") {
    if (url.protocol !== "http:") throw new Error(INVALID_ENDPOINT);
    const loopback = ["127.0.0.1", "::1", "[::1]", "localhost"];
    if (!loopback.includes(url.hostname)) throw new Error(INVALID_ENDPOINT);
  }
  if (url.username !== "" || url.password !== "") throw new Error(INVALID_ENDPOINT);
  if (url.search !== "") throw new Error(INVALID_ENDPOINT);
  if (url.hash !== "") throw new Error(INVALID_ENDPOINT);
}

// The key must never migrate to another origin: the fetch runs with
// redirect:"manual" and any 3xx is refused (the runtime may reject
// redirect:"error"), without following Location and without reflecting
// the URL or the secret in the error.
function guardRedirects(baseFetch: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await baseFetch(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(REDIRECT_REFUSED);
    }
    return response;
  }) as typeof fetch;
}

export function assistantLanguageModel(
  endpoint: AssistantEndpoint,
  context: {
    conversationId: string;
    fetch?: typeof fetch;
    requestId: string;
  },
): LanguageModel {
  assertAssistantBaseUrl(endpoint.baseUrl);
  const name = providerName(endpoint);
  const headers: Record<string, string> = {};
  if (endpoint.kind === "appliance") {
    headers["X-Conversation-Id"] = context.conversationId;
    headers["X-Request-Id"] = context.requestId;
  }
  const guardedFetch = guardRedirects(context.fetch ?? fetch);
  // Chat completions only, never the Responses API.
  return createOpenAICompatible({
    apiKey: endpoint.apiKey,
    baseURL: endpoint.baseUrl,
    fetch: guardedFetch,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    name,
  }).chatModel(endpoint.model);
}

// { [name]: { chat_template_kwargs: { enable_thinking: false } } } reaches
// the request body verbatim (the provider spreads
// providerOptions[providerOptionsName] into the args, keeping keys that are
// not part of the provider's own options schema).
export function assistantProviderOptions(endpoint: AssistantEndpoint): ProviderOptions {
  if (!endpoint.thinkingControl) return {};
  const name = providerName(endpoint);
  return {
    [name]: {
      chat_template_kwargs: {
        enable_thinking: false,
      },
    },
  };
}

// ---------- thinking-control detection ----------

const THINKING_CONTROL_TTL_MS = 10 * 60 * 1000;
// Deadline for the /models probe, body included. The probe runs before the
// turn's own timeout starts, so a stalled endpoint must not hold the thread.
export const THINKING_CONTROL_TIMEOUT_MS = 5_000;
const THINKING_CONTROL_VIA = "chat_template_kwargs.enable_thinking";

// Module cache keyed by baseUrl + "\n" + model; entries expire after 10
// minutes.
const thinkingControlCache = new Map<string, { expiresAt: number; value: boolean }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// True only when the model entry's reasoning_control.via is exactly
// "chat_template_kwargs.enable_thinking".
function modelsListEnablesThinkingControl(list: unknown, model: string): boolean {
  if (!Array.isArray(list)) return false;
  for (const item of list) {
    if (!isRecord(item) || item["id"] !== model) continue;
    const reasoningControl = item["reasoning_control"];
    return isRecord(reasoningControl) && reasoningControl["via"] === THINKING_CONTROL_VIA;
  }
  return false;
}

// Probes GET {baseUrl}/models (Authorization: Bearer when a key is set) and
// reports whether the endpoint advertises the thinking-control knob. It
// reuses the model's protections: the base URL is validated and the fetch
// refuses redirects, so a 3xx is not followed. The probe is bounded by
// THINKING_CONTROL_TIMEOUT_MS. Every failure (invalid base URL, network,
// redirect, status, JSON, shape, deadline) reports false.
export async function detectThinkingControl(input: {
  apiKey?: string;
  baseUrl: string;
  fetch?: typeof fetch;
  model: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const key = `${input.baseUrl}\n${input.model}`;
  const cached = thinkingControlCache.get(key);
  if (cached !== undefined) {
    if (cached.expiresAt > Date.now()) return cached.value;
    thinkingControlCache.delete(key);
  }
  let value = false;
  try {
    // Same protections as the chat model: the base URL is validated and
    // the fetch refuses redirects; any failure reports false without
    // following a redirect.
    assertAssistantBaseUrl(input.baseUrl);
    const doFetch = guardRedirects(input.fetch ?? fetch);
    const url = `${input.baseUrl.replace(/\/+$/, "")}/models`;
    const response = await doFetch(url, {
      headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {},
      signal: AbortSignal.timeout(input.timeoutMs ?? THINKING_CONTROL_TIMEOUT_MS),
    });
    if (response.ok) {
      const body: unknown = await response.json();
      value = modelsListEnablesThinkingControl(isRecord(body) ? body["data"] : body, input.model);
    }
  } catch {
    value = false;
  }
  thinkingControlCache.set(key, { expiresAt: Date.now() + THINKING_CONTROL_TTL_MS, value });
  return value;
}

// Test hook: drops every cached detection result.
export function resetThinkingControlCacheForTests(): void {
  thinkingControlCache.clear();
}
