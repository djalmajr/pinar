// F5/S2: capability detection of the BYOK endpoint (F5 contract §1 and §2).
//
// detectByokCapabilities probes the endpoint the Pro account saved and
// records, per capability, ok/error and the test date; embeddings also the
// tested dims (the index requires 256, PIN_EMBEDDING_DIMENSIONS). Two paths:
//
// - the appliance shortcut (GET {baseUrl}/models): when every item of the
//   catalog carries `scope` and `available`, they decide the capabilities
//   without test calls — the chat needs scope llm with available, its
//   modalities.input to list image for vision, and supported_parameters to
//   list tools and tool_choice; embeddings need the embeddings item with
//   available and embedding.dimensions.supported including 256;
//   transcription the audio item with available. A missing item is a
//   missing capability (service_disabled, the appliance's 404 cause).
// - the general path: minimal calls, one per capability, never retried and
//   never in parallel — a trivial tool with tool_choice forced (pass: a
//   tool_call), a 1×1 PNG in image_url (pass: 200 with content), one
//   embedding with dimensions 256 (pass: a 256-position vector), and a
//   1 s silent WAV on POST /audio/transcriptions (pass: 200 with `text`,
//   even empty).
//
// The egress is the ByokEgress interface (fetch.ts): in production it is
// byokFetch, which refuses until the EdgeR guard exists (A55, S6) — then the
// configured capabilities record egress_unavailable and nothing leaves. The
// tests inject a fake egress through the same signature.
//
// Every answer is a short cause code: the provider's body and the key never
// appear in an error, in a result or in a log. 401/403 → key_rejected (a
// 403 whose body type is scope_denied → scope_denied); 404 → model_not_found
// when the body names a model, else service_disabled; 429 → rate_limited;
// 503 → unavailable; a deadline → timeout; a 200 outside the expected
// shape → invalid_response; the egress refusal → egress_unavailable; the
// guard's x-edger-egress-error codes (EDG-38 §4) → endpoint_blocked,
// endpoint_unreachable, timeout or rate_limited. Retry-After is honored only
// to inform (the rate_limited cause), never waited. The catalog's own
// 401/403/429/503 stops the detection: repeating the calls would only
// repeat the 429/503, so every configured capability takes that cause.

import { silentWav } from "../ai/inference";
import type { ByokCapability, ByokCapabilities } from "./api";
import { ByokEgressUnavailableError, type ByokEgress } from "./fetch";

/** A short cause for a capability that did not pass (F5 contract §2). */
export type ByokCauseCode =
  | "key_rejected"
  | "scope_denied"
  | "model_not_found"
  | "service_disabled"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "invalid_response"
  | "egress_unavailable"
  | "endpoint_blocked"
  | "endpoint_unreachable"
  | "model_not_configured";

/** The endpoint to probe: the saved base URL, the decrypted key (server-side only) and the three models. */
export interface ByokDetectEndpoint {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  key: string;
  transcriptionModel: string;
}

export interface ByokDetectInput {
  endpoint: ByokDetectEndpoint;
  egress: ByokEgress;
  /** The test date recorded on every capability (already an ISO string). */
  now: string;
  /** The per-call deadline (default 15 s). */
  timeoutMs?: number;
  /** The total budget of the whole detection (default 60 s). */
  budgetMs?: number;
}

export const BYOK_DETECT_TIMEOUT_MS = 15_000;
export const BYOK_DETECT_BUDGET_MS = 60_000;

// A 200 that does not carry the field the capability needs is outside the
// expected shape: invalid_response.
const BODY_LIMIT_BYTES = 256 * 1024;
// The 1×1 transparent PNG of the vision probe, as a data URL.
const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

interface CallOutcome {
  bodyText?: string;
  cause?: ByokCauseCode;
  status?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The error type/code of a provider error body ({"error":{"type"...}}); never its message. */
function bodyErrorMarker(bodyText: string | undefined): string {
  const body = bodyText === undefined ? undefined : parseJson(bodyText);
  if (!record(body)) return "";
  const error = record(body.error) ? body.error : {};
  const type = typeof error.type === "string" ? error.type : "";
  const code = typeof error.code === "string" ? error.code : "";
  return `${type} ${code}`.toLowerCase();
}

/** The cause of a non-2xx response: the guard's header wins, then the status (EDG-38 §4). */
function responseCause(response: Response, bodyText: string | undefined): ByokCauseCode {
  const guardError = response.headers.get("x-edger-egress-error");
  if (guardError !== null) {
    switch (guardError) {
      case "EGRESS_TIMEOUT":
        return "timeout";
      case "EGRESS_LIMIT":
        return "rate_limited";
      case "EGRESS_BAD_TARGET":
      case "EGRESS_HOST_BLOCKED":
      case "EGRESS_PORT_BLOCKED":
        return "endpoint_blocked";
      default:
        // DNS, upstream, redirects, response size and any code the
        // provisional contract still names differently: the endpoint did
        // not answer as it should.
        return "endpoint_unreachable";
    }
  }
  const marker = bodyErrorMarker(bodyText);
  switch (response.status) {
    case 401:
      return "key_rejected";
    case 403:
      return marker.includes("scope_denied") ? "scope_denied" : "key_rejected";
    case 404:
      return marker.includes("model") ? "model_not_found" : "service_disabled";
    case 429:
      return "rate_limited";
    case 503:
      return "unavailable";
    case 504:
      return "timeout";
    default:
      // A 4xx (400, 422, ...) is the endpoint refusing what the model was
      // asked to do; any other 5xx is the endpoint itself.
      return response.status < 500 ? "model_not_found" : "unavailable";
  }
}

async function boundedText(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const keep = Math.min(value.byteLength, maxBytes - length);
      chunks.push(keep === value.byteLength ? value : value.subarray(0, keep));
      length += keep;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** One egress call with its deadline; the refusal, the abort and the network failure map to causes. */
async function callEgress(
  egress: ByokEgress,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<CallOutcome> {
  let response: Response;
  try {
    response = await egress(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof ByokEgressUnavailableError) return { cause: "egress_unavailable" };
    if (isAbort(error)) return { cause: "timeout" };
    return { cause: "endpoint_unreachable" };
  }
  const bodyText = await boundedText(response.body, BODY_LIMIT_BYTES);
  if (response.ok) return { bodyText, status: response.status };
  return { bodyText, cause: responseCause(response, bodyText), status: response.status };
}

interface CatalogItem {
  available?: boolean;
  embedding?: { dimensions?: { supported?: unknown } };
  modalities?: { input?: unknown };
  scope?: string;
  supported_parameters?: unknown;
}

/** The items of a /models catalog ({ data: [...] } or a bare array), or null when it is not one. */
function catalogItems(bodyText: string | undefined): CatalogItem[] | null {
  const body = bodyText === undefined ? undefined : parseJson(bodyText);
  const data = record(body) && Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : null;
  if (data === null) return null;
  return data.filter((item): item is CatalogItem => record(item));
}

/** The appliance shortcut: every item decides the scopes (the appendix catalog of the Appliance answers). */
function isApplianceCatalog(items: CatalogItem[]): boolean {
  return items.every((item) => typeof item.scope === "string" && typeof item.available === "boolean");
}

function itemOfScope(items: CatalogItem[], scope: string): CatalogItem | undefined {
  return items.find((item) => item.scope === scope);
}

function listsImage(modalities: CatalogItem["modalities"]): boolean {
  const input = modalities?.input;
  return Array.isArray(input) && input.includes("image");
}

function listsParameters(parameters: unknown, names: string[]): boolean {
  return Array.isArray(parameters) && names.every((name) => parameters.includes(name));
}

function supportsDimensions256(item: CatalogItem): boolean {
  const supported = item.embedding?.dimensions?.supported;
  return Array.isArray(supported) && supported.includes(256);
}

function filled(ok: boolean, error: ByokCauseCode | null, testedAt: string) {
  return { error, ok, testedAt };
}

// The probe bodies: the trivial tool and the 1×1 image. The model names come
// from the saved row (validated in S1); the key never leaves the headers.
const PROBE_TOOL = {
  function: {
    description: "Reports that the probe was received.",
    name: "pinar_probe",
    parameters: { properties: {}, type: "object" },
  },
  type: "function",
};

export async function detectByokCapabilities(input: ByokDetectInput): Promise<ByokCapabilities> {
  const { endpoint, egress } = input;
  const now = input.now;
  const timeoutMs = input.timeoutMs ?? BYOK_DETECT_TIMEOUT_MS;
  const startedAt = Date.now();
  const budgetMs = input.budgetMs ?? BYOK_DETECT_BUDGET_MS;
  const withinBudget = () => Date.now() - startedAt < budgetMs;

  const chatConfigured = endpoint.chatModel !== "";
  const embeddingsConfigured = endpoint.embeddingModel !== "";
  const transcriptionConfigured = endpoint.transcriptionModel !== "";

  // Only the capabilities with a configured model are tested; the others
  // record the plain cause and cost no call.
  const result: ByokCapabilities = {
    chat: filled(false, "model_not_configured", now),
    embeddings: { dims: null, ...filled(false, "model_not_configured", now) },
    tools: filled(false, "model_not_configured", now),
    transcription: filled(false, "model_not_configured", now),
    vision: filled(false, "model_not_configured", now),
  };
  if (chatConfigured) {
    result.chat = { error: null, ok: null, testedAt: null };
    result.tools = { error: null, ok: null, testedAt: null };
    result.vision = { error: null, ok: null, testedAt: null };
  }
  if (embeddingsConfigured) result.embeddings = { dims: null, error: null, ok: null, testedAt: null };
  if (transcriptionConfigured) result.transcription = { error: null, ok: null, testedAt: null };

  if (!chatConfigured && !embeddingsConfigured && !transcriptionConfigured) return result;

  const fail = (capability: keyof ByokCapabilities) => (cause: ByokCauseCode) => {
    if (capability === "embeddings") result.embeddings = { dims: null, ...filled(false, cause, now) };
    else result[capability] = filled(false, cause, now);
  };

  const failAllConfigured = (cause: ByokCauseCode) => {
    if (chatConfigured) {
      fail("chat")(cause);
      fail("tools")(cause);
      fail("vision")(cause);
    }
    if (embeddingsConfigured) fail("embeddings")(cause);
    if (transcriptionConfigured) fail("transcription")(cause);
  };

  // The catalog decides the appliance. Its refusal (the S2 production)
  // stops the detection and nothing leaves; a 401/403/429/503 of the shared
  // route already decides the key or the service, and the calls below would
  // only repeat it. A timeout or a network failure of the catalog alone
  // falls through: the general path still tries each capability.
  const catalog = await callEgress(egress, `${endpoint.baseUrl}/models`, {
    headers: new Headers({ Authorization: `Bearer ${endpoint.key}` }),
    method: "GET",
  }, timeoutMs);
  if (catalog.cause === "egress_unavailable") {
    failAllConfigured("egress_unavailable");
    return result;
  }
  if (catalog.status === 200) {
    const items = catalogItems(catalog.bodyText);
    if (items !== null && isApplianceCatalog(items)) {
      if (chatConfigured) {
        const llm = itemOfScope(items, "llm");
        if (llm === undefined) {
          fail("chat")("service_disabled");
          fail("tools")("service_disabled");
          fail("vision")("service_disabled");
        } else if (llm.available === true) {
          result.chat = filled(true, null, now);
          result.vision = listsImage(llm.modalities) ? filled(true, null, now) : filled(false, "model_not_found", now);
          result.tools = listsParameters(llm.supported_parameters, ["tools", "tool_choice"])
            ? filled(true, null, now)
            : filled(false, "model_not_found", now);
        } else {
          fail("chat")("scope_denied");
          fail("tools")("scope_denied");
          fail("vision")("scope_denied");
        }
      }
      if (embeddingsConfigured) {
        const embeddingsItem = itemOfScope(items, "embeddings");
        if (embeddingsItem === undefined) fail("embeddings")("service_disabled");
        else if (embeddingsItem.available === true && supportsDimensions256(embeddingsItem)) {
          result.embeddings = { ...filled(true, null, now), dims: 256 };
        } else {
          fail("embeddings")(embeddingsItem?.available === false ? "scope_denied" : "model_not_found");
        }
      }
      if (transcriptionConfigured) {
        const audio = itemOfScope(items, "audio");
        if (audio === undefined) fail("transcription")("service_disabled");
        else if (audio.available === true) result.transcription = filled(true, null, now);
        else fail("transcription")("scope_denied");
      }
      return result;
    }
  } else if (catalog.status === 401 || catalog.status === 403 || catalog.status === 429 || catalog.status === 503) {
    failAllConfigured(catalog.cause as ByokCauseCode);
    return result;
  }
  // No catalog (404 or another status) or a catalog without scope/available:
  // the minimal calls, one per capability, in sequence and without retries.
  const jsonHeaders = () => new Headers({ Authorization: `Bearer ${endpoint.key}`, "Content-Type": "application/json" });

  if (chatConfigured && withinBudget()) {
    // One call tests the chat with the trivial tool and tool_choice forced:
    // a tool_call proves the tools, any completion proves the chat.
    const outcome = await callEgress(egress, `${endpoint.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: [{ content: "ping", role: "user" }],
        model: endpoint.chatModel,
        tool_choice: { function: { name: PROBE_TOOL.function.name }, type: "function" },
        tools: [PROBE_TOOL],
      }),
      headers: jsonHeaders(),
      method: "POST",
    }, timeoutMs);
    if (outcome.cause === undefined && outcome.status === 200) {
      const body = parseJson(outcome.bodyText ?? "");
      const choices = record(body) && Array.isArray(body.choices) ? body.choices : null;
      const message = choices !== null && record(choices[0]) ? choices[0]!.message : undefined;
      const toolCall = record(message) && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
      result.chat = filled(choices !== null, choices === null ? "invalid_response" : null, now);
      result.tools = filled(toolCall, toolCall ? null : "invalid_response", now);
    } else {
      const cause = outcome.cause ?? "invalid_response";
      fail("chat")(cause);
      fail("tools")(cause);
    }
  }

  if (chatConfigured && withinBudget()) {
    // The vision probe: the 1×1 PNG in image_url; a 200 with content passes.
    const outcome = await callEgress(egress, `${endpoint.baseUrl}/chat/completions`, {
      body: JSON.stringify({
        messages: [{
          content: [
            { text: "1×1", type: "text" },
            { image_url: { url: PNG_1X1 }, type: "image_url" },
          ],
          role: "user",
        }],
        model: endpoint.chatModel,
      }),
      headers: jsonHeaders(),
      method: "POST",
    }, timeoutMs);
    if (outcome.cause === undefined && outcome.status === 200) {
      const body = parseJson(outcome.bodyText ?? "");
      const choices = record(body) && Array.isArray(body.choices) ? body.choices : null;
      const message = choices !== null && record(choices[0]) ? choices[0]!.message : undefined;
      const content = record(message) && typeof message.content === "string" ? message.content : "";
      result.vision = filled(content !== "", content === "" ? "invalid_response" : null, now);
    } else {
      fail("vision")(outcome.cause ?? "invalid_response");
    }
  }

  if (embeddingsConfigured && withinBudget()) {
    // One embedding with dimensions 256; the index requires 256 positions.
    const outcome = await callEgress(egress, `${endpoint.baseUrl}/embeddings`, {
      body: JSON.stringify({ dimensions: 256, input: "pinar", model: endpoint.embeddingModel }),
      headers: jsonHeaders(),
      method: "POST",
    }, timeoutMs);
    if (outcome.cause === undefined && outcome.status === 200) {
      const body = parseJson(outcome.bodyText ?? "");
      const data = record(body) && Array.isArray(body.data) ? body.data : null;
      const embedding = data !== null && record(data[0]) ? data[0]!.embedding : undefined;
      const vector = Array.isArray(embedding) && embedding.every((position) => typeof position === "number" && Number.isFinite(position))
        ? embedding
        : null;
      if (vector !== null && vector.length === 256) result.embeddings = { ...filled(true, null, now), dims: 256 };
      else fail("embeddings")("invalid_response");
    } else {
      fail("embeddings")(outcome.cause ?? "invalid_response");
    }
  }

  if (transcriptionConfigured && withinBudget()) {
    // A 1 s silent WAV, generated in code; a 200 with `text` passes, even
    // empty (the silence transcribes to nothing).
    const form = new FormData();
    form.append("file", new Blob([silentWav(1_000, 16_000)], { type: "audio/wav" }), "probe.wav");
    form.append("model", endpoint.transcriptionModel);
    const outcome = await callEgress(egress, `${endpoint.baseUrl}/audio/transcriptions`, {
      body: form,
      headers: new Headers({ Authorization: `Bearer ${endpoint.key}` }),
      method: "POST",
    }, timeoutMs);
    if (outcome.cause === undefined && outcome.status === 200) {
      const body = parseJson(outcome.bodyText ?? "");
      const hasText = record(body) && typeof body.text === "string";
      result.transcription = filled(hasText, hasText ? null : "invalid_response", now);
    } else {
      fail("transcription")(outcome.cause ?? "invalid_response");
    }
  }

  // The budget ran out before every call: the untested ones record the deadline.
  for (const capability of Object.keys(result) as Array<keyof ByokCapabilities>) {
    const entry = result[capability];
    if (entry.ok !== null) continue;
    const timedOut: ByokCapability = { error: "timeout", ok: false, testedAt: now };
    if (capability === "embeddings") result.embeddings = { ...timedOut, dims: null };
    else result[capability] = timedOut;
  }
  return result;
}
