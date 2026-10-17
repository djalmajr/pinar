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
//
// detectGatewayRetrievalCapabilities reads the public catalog of the Vercel
// AI Gateway (F4 contract §4) with the same protections, deadline and
// cache, without the key. Among its hundreds of models it reads only the
// configured ids and never picks one itself:
// - vision: the chat model's item lists "vision" in tags;
// - embeddingModel: the configured embedding model, when its item has type
//   "embedding", with embeddingInputPrice, its pricing.input (decimal USD
//   per token) or null;
// - decisions: always false (the gateway has no decisions extra).

import { assertAssistantBaseUrl, guardRedirects, type AssistantEndpoint } from "../models";

export const RETRIEVAL_DETECT_TIMEOUT_MS = 5_000;
export const RETRIEVAL_DETECT_TTL_MS = 10 * 60 * 1000;
export const RETRIEVAL_DETECT_FAILURE_TTL_MS = 60 * 1000;

export interface RetrievalCapabilities {
  decisions: boolean;
  // Only in a gateway detection: pricing.input of embeddingModel.
  embeddingInputPrice?: string | null;
  embeddingModel: string | null;
  vision: boolean;
}

const NONE: RetrievalCapabilities = { decisions: false, embeddingModel: null, vision: false };

// Keyed by baseUrl + "\n" + model, and for the gateway by baseUrl + "\n" +
// chat model + "\n" + embedding model.
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

function gatewayCapabilitiesFrom(list: unknown[], chatModel: string, embeddingModel: string | null): RetrievalCapabilities {
  let chatSeen = false;
  let embeddingSeen = false;
  const found: RetrievalCapabilities = { decisions: false, embeddingInputPrice: null, embeddingModel: null, vision: false };
  for (const item of list) {
    if (!isRecord(item) || typeof item["id"] !== "string") continue;
    const id = item["id"];
    if (!chatSeen && id === chatModel) {
      chatSeen = true;
      const tags = item["tags"];
      found.vision = Array.isArray(tags) && tags.includes("vision");
    }
    if (!embeddingSeen && embeddingModel !== null && id === embeddingModel) {
      embeddingSeen = true;
      if (item["type"] === "embedding") {
        const pricing = item["pricing"];
        const input = isRecord(pricing) ? pricing["input"] : undefined;
        found.embeddingModel = id;
        found.embeddingInputPrice = typeof input === "string" ? input : null;
      }
    }
  }
  return found;
}

// The data[] list of GET {baseUrl}/models, or null when the probe failed.
async function readModels(baseUrl: string, apiKey: string | undefined, baseFetch: typeof fetch): Promise<unknown[] | null> {
  try {
    assertAssistantBaseUrl(baseUrl);
    const response = await guardRedirects(baseFetch)(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(RETRIEVAL_DETECT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const data = isRecord(body) ? body["data"] : undefined;
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function cachedDetection(key: string, probe: () => Promise<RetrievalCapabilities | null>): Promise<RetrievalCapabilities> {
  const cached = capabilitiesCache.get(key);
  if (cached !== undefined) {
    if (cached.expiresAt > Date.now()) return { ...cached.value };
    capabilitiesCache.delete(key);
  }
  const detected = await probe();
  const value = detected ?? NONE;
  const ttl = detected ? RETRIEVAL_DETECT_TTL_MS : RETRIEVAL_DETECT_FAILURE_TTL_MS;
  capabilitiesCache.set(key, { expiresAt: Date.now() + ttl, value });
  return { ...value };
}

export async function detectRetrievalCapabilities(input: {
  endpoint: AssistantEndpoint;
  fetch?: typeof fetch;
}): Promise<RetrievalCapabilities> {
  const { endpoint } = input;
  return cachedDetection(`${endpoint.baseUrl}\n${endpoint.model}`, async () => {
    const list = await readModels(endpoint.baseUrl, endpoint.apiKey, input.fetch ?? fetch);
    return list === null ? null : capabilitiesFrom(list, endpoint.model);
  });
}

/** The gateway catalog's answer for the configured chat and embedding models only. */
export async function detectGatewayRetrievalCapabilities(input: {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string | null;
  fetch?: typeof fetch;
}): Promise<RetrievalCapabilities> {
  return cachedDetection(`${input.baseUrl}\n${input.chatModel}\n${input.embeddingModel ?? ""}`, async () => {
    // The catalog is public: the key is not sent.
    const list = await readModels(input.baseUrl, undefined, input.fetch ?? fetch);
    return list === null ? null : gatewayCapabilitiesFrom(list, input.chatModel, input.embeddingModel);
  });
}

// Test hook: drops every cached detection result.
export function resetRetrievalCapabilitiesCacheForTests(): void {
  capabilitiesCache.clear();
}
