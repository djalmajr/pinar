// Retrieval capabilities of an OpenAI-compatible endpoint (F3 contract §3.1,
// decisions A19 and A23), read from its GET {baseUrl}/models list:
// - embeddingModel: the first data[].id whose type is "embedding";
// - vision: whether the data[] item whose id is the endpoint's chat model
//   lists "image" in modalities.input;
// - decisions: whether that same item declares the appliance's decisions
//   extra with `decisions.available === true` (F3.5 contract §3.1, A28).
//
// The probe has the protections of the F1 chat model (models.ts): the base
// URL goes through assertAssistantBaseUrl, the fetch refuses any redirect
// (guardRedirects), the key travels only in the Authorization header, and
// the request and body read share a 5 s deadline. Every failure (invalid
// base URL, network, redirect, status, JSON, a body without a data array,
// deadline) reports { decisions: false, embeddingModel: null, vision: false }.
// Nothing is logged.
//
// Results are cached per baseUrl and model: a successful read for 10
// minutes, a failure for 1 minute, so an endpoint that was down is probed
// again soon.

import { assertAssistantBaseUrl, guardRedirects, type AssistantEndpoint } from "../models";

export const RETRIEVAL_DETECT_TIMEOUT_MS = 5_000;
export const RETRIEVAL_DETECT_TTL_MS = 10 * 60 * 1000;
export const RETRIEVAL_DETECT_FAILURE_TTL_MS = 60 * 1000;

export interface RetrievalCapabilities {
  decisions: boolean;
  embeddingModel: string | null;
  vision: boolean;
}

const NONE: RetrievalCapabilities = { decisions: false, embeddingModel: null, vision: false };

// Keyed by baseUrl + "\n" + model.
const capabilitiesCache = new Map<string, { expiresAt: number; value: RetrievalCapabilities }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capabilitiesFrom(list: unknown[], model: string): RetrievalCapabilities {
  let decisions = false;
  let embeddingModel: string | null = null;
  let vision = false;
  let chatSeen = false;
  for (const item of list) {
    if (!isRecord(item) || typeof item["id"] !== "string") continue;
    const id = item["id"];
    if (embeddingModel === null && item["type"] === "embedding" && id !== "") embeddingModel = id;
    if (!chatSeen && id === model) {
      chatSeen = true;
      const modalities = item["modalities"];
      const input = isRecord(modalities) ? modalities["input"] : undefined;
      vision = Array.isArray(input) && input.includes("image");
      const extra = item["decisions"];
      decisions = isRecord(extra) && extra["available"] === true;
    }
  }
  return { decisions, embeddingModel, vision };
}

// The capabilities, or null when the probe failed.
async function probe(endpoint: AssistantEndpoint, baseFetch: typeof fetch): Promise<RetrievalCapabilities | null> {
  try {
    assertAssistantBaseUrl(endpoint.baseUrl);
    const response = await guardRedirects(baseFetch)(`${endpoint.baseUrl.replace(/\/+$/, "")}/models`, {
      headers: endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {},
      signal: AbortSignal.timeout(RETRIEVAL_DETECT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const data = isRecord(body) ? body["data"] : undefined;
    if (!Array.isArray(data)) return null;
    return capabilitiesFrom(data, endpoint.model);
  } catch {
    return null;
  }
}

export async function detectRetrievalCapabilities(input: {
  endpoint: AssistantEndpoint;
  fetch?: typeof fetch;
}): Promise<RetrievalCapabilities> {
  const key = `${input.endpoint.baseUrl}\n${input.endpoint.model}`;
  const cached = capabilitiesCache.get(key);
  if (cached !== undefined) {
    if (cached.expiresAt > Date.now()) return { ...cached.value };
    capabilitiesCache.delete(key);
  }
  const detected = await probe(input.endpoint, input.fetch ?? fetch);
  const value = detected ?? NONE;
  const ttl = detected ? RETRIEVAL_DETECT_TTL_MS : RETRIEVAL_DETECT_FAILURE_TTL_MS;
  capabilitiesCache.set(key, { expiresAt: Date.now() + ttl, value });
  return { ...value };
}

// Test hook: drops every cached detection result.
export function resetRetrievalCapabilitiesCacheForTests(): void {
  capabilitiesCache.clear();
}
