// F5/S3: the BYOK capability routing (F5 contract §1 and §2): when a Pro
// account has a BYOK endpoint with a tested-ok capability, the call for that
// capability runs on the user's endpoint, without credits.
//
// cloudByokRoute answers null in any of: no Pro (planIncludesAi), no valid
// master key, no BYOK row, the capability without ok: true in
// capabilities_json, or the capability's model not configured. Otherwise it
// returns { baseUrl, apiKey, model, egress }: the key is decrypted only
// here, on the server, and never goes to a log or an error (a ciphertext
// the master key cannot read answers null, silently — a driver or a tag
// may echo the key). The egress is byokFetch bound to the env (the refusal
// until S6) or the fake the tests inject (setByokEgressForTests, shared
// with S2's test route).
//
// Concurrency: at most BYOK_MAX_CONCURRENT_CALLS BYOK calls in flight per
// owner; beyond that the cause is rate_limited, without a queue. The mark
// is the route's release() — the caller runs it in the finally of the call.
//
// The assistant turn (cloud-api.ts) asks for chat and tools through
// byokAssistantRoute: one concurrency slot (the turn is one BYOK call), and
// the vision flag — with vision not ok, the turn's model never sends an
// image to the user's endpoint (byokAssistantModel strips the image parts;
// S3b routes the other capabilities to the same rule). The assistant's
// failure ends the turn with the byok_error code, the cause of the common
// table (cause.ts), the retryAfter when there is one and
// canUseCredits: true; the turn never falls to the gateway and never
// charges.

import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import { planIncludesAi } from "../../lib/entitlements";
import { assistantLanguageModel, guardRedirects } from "../assistant/models";
import type { CloudEnv, Principal } from "../cloud-api";
import { capabilitiesOf } from "./api";
import {
  ByokAssistantTurnError,
  byokEgressErrorCause,
  byokReadBody,
  byokResponseCause,
  byokStreamCutCause,
} from "./cause";
import { byokCrypto } from "./crypto";
import type { ByokEgress } from "./fetch";
import { byokEgressFor } from "./fetch";
import { byokRow, type ByokStoredRow } from "./store";

export type ByokCapabilityName = "chat" | "tools" | "vision" | "embeddings" | "transcription";

/** A resolved BYOK route: the decrypted key, only on the server. */
export interface ByokRoute {
  apiKey: string;
  baseUrl: string;
  egress: ByokEgress;
  model: string;
  /** Frees the per-user concurrency slot (idempotent; a no-op when the route took none). */
  release(): void;
}

/** null: no route; rate_limited: the per-user concurrency cap (no queue). */
export type ByokRouteResult = ByokRoute | null | { cause: "rate_limited" };

// The per-user concurrency of the BYOK calls (F5 contract §1, "concorrência
// por usuário limitada no Pinar"): at most two in flight per owner, per
// process, like the other in-memory Cloud limits.
export const BYOK_MAX_CONCURRENT_CALLS = 2;

const byokCallsInFlight = new Map<string, number>();

export function resetByokConcurrencyForTests(): void {
  byokCallsInFlight.clear();
}

const NOOP_RELEASE = () => {};

function byokTryAcquire(ownerId: string): boolean {
  const current = byokCallsInFlight.get(ownerId) ?? 0;
  if (current >= BYOK_MAX_CONCURRENT_CALLS) return false;
  byokCallsInFlight.set(ownerId, current + 1);
  return true;
}

function byokMakeRelease(ownerId: string): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = byokCallsInFlight.get(ownerId) ?? 0;
    if (current <= 1) byokCallsInFlight.delete(ownerId);
    else byokCallsInFlight.set(ownerId, current - 1);
  };
}

// chat, tools and vision run on the chat model; embeddings and transcription
// have their own.
function capabilityModel(capability: ByokCapabilityName, row: ByokStoredRow): string {
  if (capability === "embeddings") return row.embeddingModel;
  if (capability === "transcription") return row.transcriptionModel;
  return row.chatModel;
}

// The route without the concurrency: the five null cases and the decrypt.
async function byokRouteOf(env: CloudEnv, principal: Principal, capability: ByokCapabilityName): Promise<ByokRoute | null> {
  if (!planIncludesAi(principal.plan)) return null;
  const crypto = await byokCrypto(env.BYOK_MASTER_KEY);
  if (crypto === null) return null;
  const row = await byokRow(env, principal.id);
  if (row === null) return null;
  if (capabilitiesOf(row.capabilitiesJson)[capability].ok !== true) return null;
  const model = capabilityModel(capability, row);
  if (model === "") return null;
  let apiKey: string;
  try {
    apiKey = await crypto.decrypt(row.keyCiphertext);
  } catch {
    // A ciphertext the master key cannot read: no route, and the error is
    // not logged (a driver or a tag may echo the key).
    return null;
  }
  return { apiKey, baseUrl: row.baseUrl, egress: byokEgressFor(env), model, release: NOOP_RELEASE };
}

/**
 * The BYOK route of one capability: null on any of the five no-route cases,
 * rate_limited above the per-user concurrency (no queue), or the route with
 * the decrypted key and the egress. With acquire: false the concurrency is
 * not consulted (a status read) and rate_limited never answers.
 */
export async function cloudByokRoute(
  env: CloudEnv,
  principal: Principal,
  capability: ByokCapabilityName,
  options: { acquire?: boolean } = {},
): Promise<ByokRouteResult> {
  const route = await byokRouteOf(env, principal, capability);
  if (route === null) return null;
  if (options.acquire === false) return { ...route, release: NOOP_RELEASE };
  // The check and the mark are one synchronous step, so a concurrent call
  // always sees the first one's mark.
  if (!byokTryAcquire(principal.id)) return { cause: "rate_limited" };
  return { ...route, release: byokMakeRelease(principal.id) };
}

export interface ByokAssistantRoute extends ByokRoute {
  // The vision capability ok: only with it an image may reach the user's
  // endpoint (byokAssistantModel keeps the image parts; without it they are
  // stripped, so the turn sends no image when vision is not ok).
  vision: boolean;
}

export type ByokAssistantRouteResult = ByokAssistantRoute | null | { cause: "rate_limited" };

// The base of the assistant's BYOK route: one row read and one key
// decryption — the three capabilities (tools, chat and vision) all run on
// the chat model, so the same row and the same decryption answer all of
// them (a round-1 review noted the three separate byokRouteOf reads).
interface ByokAssistantBase {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  chatOk: boolean;
  egress: ByokEgress;
  toolsOk: boolean;
  visionOk: boolean;
}

async function byokAssistantBaseOf(env: CloudEnv, principal: Principal): Promise<ByokAssistantBase | null> {
  if (!planIncludesAi(principal.plan)) return null;
  const crypto = await byokCrypto(env.BYOK_MASTER_KEY);
  if (crypto === null) return null;
  const row = await byokRow(env, principal.id);
  if (row === null) return null;
  const capabilities = capabilitiesOf(row.capabilitiesJson);
  // tools, chat and vision all run on the chat model.
  if (row.chatModel === "") return null;
  let apiKey: string;
  try {
    apiKey = await crypto.decrypt(row.keyCiphertext);
  } catch {
    // A ciphertext the master key cannot read: no route, and the error is
    // not logged (a driver or a tag may echo the key).
    return null;
  }
  return {
    apiKey,
    baseUrl: row.baseUrl,
    chatModel: row.chatModel,
    chatOk: capabilities.chat.ok === true,
    egress: byokEgressFor(env),
    toolsOk: capabilities.tools.ok === true,
    visionOk: capabilities.vision.ok === true,
  };
}

/**
 * The assistant's BYOK route: chat and tools, one concurrency slot (the
 * turn is one BYOK call), the key read and decrypted once for the three
 * capabilities. Tools is checked before the slot is taken: without tools
 * there is no BYOK turn, and a capped account still goes to the gateway
 * path instead of a false rate_limited.
 */
export async function byokAssistantRoute(env: CloudEnv, principal: Principal): Promise<ByokAssistantRouteResult> {
  const base = await byokAssistantBaseOf(env, principal);
  if (base === null || !base.toolsOk || !base.chatOk) return null;
  // The check and the mark are one synchronous step, so a concurrent call
  // always sees the first one's mark.
  if (!byokTryAcquire(principal.id)) return { cause: "rate_limited" };
  return {
    apiKey: base.apiKey,
    baseUrl: base.baseUrl,
    egress: base.egress,
    model: base.chatModel,
    release: byokMakeRelease(principal.id),
    vision: base.visionOk,
  };
}

/** The assistant's BYOK route without taking a concurrency slot (the status). */
export async function byokAssistantRouteExists(env: CloudEnv, principal: Principal): Promise<boolean> {
  const base = await byokAssistantBaseOf(env, principal);
  return base !== null && base.toolsOk && base.chatOk;
}

// ---------- the turn's model ----------

// The body of a non-2xx answer, capped like S2's detection: enough for the
// 403/404 markers of the common table, never more.
const BYOK_TURN_ERROR_BODY_LIMIT = 256 * 1024;

function byokEgressAsFetch(egress: ByokEgress): typeof fetch {
  // The SDK calls fetch with the URL string; the Request/URL forms are kept
  // for the typeof fetch contract.
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return egress(url, init);
  }) as typeof fetch;
}

/**
 * The turn's model fetch: the egress under the redirect guard (the key must
 * never migrate to another origin), with every failure classified into a
 * ByokAssistantTurnError through the common cause table — the provider's
 * body, the URL and the key never appear in the error (a fixed message). A
 * non-2xx is read (capped) for the 403/404 markers and refused before the
 * SDK sees it; a 2xx is streamed untouched, and a failure mid-stream is
 * classified by the error it throws (timeout, endpoint_unreachable).
 */
export function byokTurnFetch(egress: ByokEgress): typeof fetch {
  const guarded = guardRedirects(byokEgressAsFetch(egress));
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const response = await guarded(input, init);
      if (response.ok) {
        // The 2xx body guarded mid-stream (contract §4 "Streaming"): a cut
        // by the guard (size or time) or a dropped network surfaces as an
        // exception on reader.read(); it becomes the caused
        // ByokAssistantTurnError, so the turn ends with the byok_error
        // cause — a truncated response never settles as the final answer.
        return response.body === null ? response : new Response(byokGuardedStream(response.body), response);
      }
      let bodyText: string | undefined;
      try {
        bodyText = await byokReadBody(response, BYOK_TURN_ERROR_BODY_LIMIT);
      } catch {
        // A body that fails to be read (EDG-38 names it): the status and
        // the guard's header still decide the cause.
      }
      throw new ByokAssistantTurnError(byokResponseCause(response, bodyText));
    } catch (error) {
      if (error instanceof ByokAssistantTurnError) throw error;
      throw new ByokAssistantTurnError(byokEgressErrorCause(error));
    }
  }) as typeof fetch;
}

// The 2xx body with the mid-stream cut turned into a caused error (the
// read's exception becomes the ByokAssistantTurnError of the cut; the
// chunks pass through untouched). The reader is taken up front: the
// wrapped stream is the only consumer of the body.
function byokGuardedStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(new ByokAssistantTurnError(byokStreamCutCause(error)));
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

// The params of the v4 model call: ai's public types do not re-export the
// v4 call options, so the shape is read from the middleware signature.
type ByokCallOptions = Parameters<NonNullable<LanguageModelMiddleware["transformParams"]>>[0]["params"];

// The image guard (vision not ok): the image parts of the outgoing prompt
// (the v4 call options carry `prompt`, the { role, content } messages) are
// stripped, so nothing with an image reaches the user's endpoint. The
// turn's messages are text today; the guard keeps the rule when the turn
// carries images (S3b routes the other capabilities to the same rule).
function byokWithoutImages(params: ByokCallOptions): ByokCallOptions {
  const prompt = params.prompt.map((message) => {
    if (typeof message.content === "string") return message;
    const content = message.content.filter((part) => part.type !== "file" || !part.mediaType.startsWith("image/"));
    return { ...message, content: content.length > 0 ? content : [{ text: "", type: "text" as const }] };
  });
  // The prompt only loses the image file parts (an all-image user message
  // would otherwise become empty): the per-role content constraints are
  // preserved, so the cast keeps the union exact.
  return { ...params, prompt } as ByokCallOptions;
}

/**
 * The assistant's BYOK model: the user's OpenAI-compatible endpoint, one
 * link, no fallback to the gateway (F5 contract §1). The fetch is the
 * egress (the guard, the classified failures), like the local app builds
 * its endpoint (assistant/models.ts). Without vision ok, the image guard
 * strips the image parts from every outgoing call.
 */
export function byokAssistantModel(
  route: ByokAssistantRoute,
  context: { conversationId: string; requestId: string },
): LanguageModel {
  const model = assistantLanguageModel(
    {
      apiKey: route.apiKey,
      baseUrl: route.baseUrl,
      kind: "openai-compatible",
      model: route.model,
      thinkingControl: false,
    },
    { conversationId: context.conversationId, fetch: byokTurnFetch(route.egress), requestId: context.requestId },
  );
  if (route.vision) return model;
  // The egress and the image guard are v4 call options; the assistant's
  // models are v4 (assistant/models.ts), so this is a contract, not a
  // runtime path (the union carries string ids without the version field).
  const spec = typeof model === "string" ? null : (model as { specificationVersion?: string }).specificationVersion;
  if (spec !== "v4") throw new Error("the byok assistant model is not a v4 language model");
  const guard: LanguageModelMiddleware = {
    specificationVersion: "v4",
    // transformParams, not wrapStream: in this SDK the wrap's doStream
    // closure ignores the params handed to it, so the prompt can only be
    // changed by transforming it before the call.
    transformParams: async ({ params }) => byokWithoutImages(params),
  };
  return wrapLanguageModel({
    middleware: guard,
    // The v4 model the wrapper checks at runtime (wrapLanguageModel's
    // public parameter names the v4 interface, which ai does not re-export).
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
  });
}

// The ByokAssistantTurnError behind the error, unwrapping the cause chain:
// the provider utils return it unchanged, but a wrapped error (an
// APICallError carrying it as the cause) is still ours.
function byokTurnErrorOf(error: unknown): ByokAssistantTurnError | null {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof ByokAssistantTurnError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * The BYOK stream error for the turn's onStreamError (assistant/turn.ts):
 * the byok_error code and one data part with the cause, the retryAfter in
 * seconds when there is one and canUseCredits. The provider's body, the URL
 * and the key never cross it (the part is built only from the cause).
 */
export function byokStreamErrorPart(
  error: unknown,
): { code: string; part?: { data: Record<string, unknown>; type: `data-${string}` } } | undefined {
  const byokError = byokTurnErrorOf(error);
  if (byokError === null) return undefined;
  return {
    code: "byok_error",
    part: {
      data: {
        canUseCredits: true,
        cause: byokError.cause,
        ...(byokError.retryAfterSeconds !== null ? { retryAfter: byokError.retryAfterSeconds } : {}),
      },
      type: "data-byok-error",
    },
  };
}
