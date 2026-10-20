// F5/S3c: the retrieval endpoints of the user's BYOK row (the pin captions
// and the embeddings of the index, the capture's embedding of the
// automatic destination — F5 contract §5).
//
// byokRetrievalEndpoints answers, for the principal's row, the caption
// endpoint on the user's CHAT model (the vision capability) and the
// embedding endpoint on the saved embedding model; each is null without its
// ok capability or without its model. The key is decrypted only here, on
// the server, and never goes to a log or an error (a ciphertext the master
// key cannot read answers null, silently — the same five no-route cases as
// the turn). Both endpoints carry byokSlotEgress: the egress (byokFetch,
// the refusal until S6, or the fake the tests inject) wrapped with the
// per-user concurrency slot held FOR THE CALL — taken right before the
// egress call and released only once the answer is settled: a non-2xx or a
// thrown egress failure release it at once, and a 2xx is read whole INSIDE
// the slot (capped at BYOK_RESPONSE_BODY_LIMIT, bounded by the call's own
// signal — the caller's deadline) and answered with a new Response whose
// bytes are already in memory: the consumer's parse is plain JSON, an
// abandoned body no longer exists, and a 2xx whose source never closes
// cannot hold the slot past its deadline. A multi-call index or a batched
// embedding hold one slot at a time, never the whole pass. And with the
// common cause table, so every failure crosses the retrieval and filing
// layers as a caused ByokCallError: a read failure (a cut, the deadline, an
// abort) is classified there (endpoint_unreachable, or timeout); only the
// JSON and the schema are left to the caller, as invalid_response. The
// provider's body, the URL and the key never appear in an error, a result
// or a log.
//
// Above the cap the call fails with rate_limited (no queue); the caller
// degrades: the turn's index goes text, the automatic destination the
// default with the cause in the choice's result.

import type { EmbeddingEndpoint } from "../assistant/retrieval/embeddings";
import type { VisionEndpoint } from "../assistant/retrieval/vision";
import type { CloudEnv, Principal } from "../cloud-api";
import { capabilitiesOf } from "./api";
import { ByokCallError, byokAbortRace, byokEgressErrorCause, byokReadBody, byokResponseCause } from "./cause";
import type { ByokEgress } from "./fetch";
import { byokEgressFor } from "./fetch";
import { byokAcquireSlot, byokEgressAsFetch, byokRoutableRow, byokSlotRelease } from "./route";

// The body of a non-2xx answer, capped like the turn's and S2's: enough
// for the 403/404 markers of the common table, never more.
const BYOK_CALL_ERROR_BODY_LIMIT = 256 * 1024;

// The 2xx answer's body, read whole inside the slot: a full embedding
// batch and the caption's answer fit, nothing that can hold a slot or grow
// a buffer. Above it the answer is refused as invalid_response.
export const BYOK_RESPONSE_BODY_LIMIT = 8 * 1024 * 1024;

/**
 * The BYOK egress with the per-call concurrency slot and the common cause
 * table (F5 contract §1 and §5). The slot is taken right before the egress
 * call and released only once the answer is settled: above
 * BYOK_MAX_CONCURRENT_CALLS the call is refused with rate_limited (no
 * queue), and a call in flight never holds the slot of the next one. The
 * release is idempotent and runs on every path (the finally below): a
 * thrown egress failure (the refusal, the deadline, the network) and a
 * non-2xx (read capped for the 403/404 markers, refused as the caused
 * ByokCallError) are the common cause table; a 2xx is read whole INSIDE
 * the slot — capped (above it invalid_response) and bounded by the call's
 * own signal (an abort while reading is a timeout) — and answered with a
 * new Response whose bytes are already in memory: a read failure (a cut of
 * the transport, the deadline, an abort) is classified here by the common
 * table (endpoint_unreachable, or timeout), what is left to the caller is
 * the JSON and the schema (invalid_response), and an abandoned body no
 * longer exists, so a consumer that never reads still cannot hold the
 * slot. The name keeps it apart from byok/call.ts's one-shot byokCallEgress
 * (the S3b voice/reproduction call): this one wraps an egress with the slot
 * and the cause, that one performs a single call and returns the body text.
 */
export function byokSlotEgress(egress: ByokEgress, ownerId: string): ByokEgress {
  return async (url, init) => {
    if (!byokAcquireSlot(ownerId)) throw new ByokCallError({ cause: "rate_limited", retryAfterSeconds: null });
    try {
      // Raced with the call's signal: an egress that ignores it cannot hold
      // the slot past the deadline.
      const response = await byokAbortRace(egress(url, init), init?.signal ?? undefined);
      if (!response.ok) {
        let bodyText: string | undefined;
        try {
          bodyText = await byokReadBody(response, BYOK_CALL_ERROR_BODY_LIMIT, init?.signal ?? undefined);
        } catch {
          // A body that fails to be read: the status and the guard's header
          // still decide the cause.
        }
        throw new ByokCallError(byokResponseCause(response, bodyText));
      }
      // The 2xx's body, read whole inside the slot: the caller's parse is
      // left with the JSON and the schema, never with a body it might
      // abandon.
      const body = await byokResponseBodyRead(response, BYOK_RESPONSE_BODY_LIMIT, init?.signal ?? undefined);
      if (body.kind === "limit") throw new ByokCallError({ cause: "invalid_response", retryAfterSeconds: null });
      if (body.kind === "abort") throw new ByokCallError({ cause: "timeout", retryAfterSeconds: null });
      if (body.kind === "error") throw new ByokCallError(byokEgressErrorCause(body.error, init?.signal ?? undefined));
      // A 2xx without a body (204, 205, or a null body) stays bodyless: a
      // runtime may refuse a body on those statuses, and the caller's
      // parse then refuses the empty answer as invalid_response.
      const bodyless = body.bytes === null || response.status === 204 || response.status === 205;
      return new Response(bodyless ? null : body.bytes, { headers: response.headers, status: response.status, statusText: response.statusText });
    } catch (error) {
      if (error instanceof ByokCallError) throw error;
      throw new ByokCallError(byokEgressErrorCause(error, init?.signal ?? undefined));
    } finally {
      // Idempotent: every path settles the call with the slot released.
      byokSlotRelease(ownerId)();
    }
  };
}

// The read of the 2xx's body inside byokSlotEgress: the bytes (done), the
// cap exceeded (limit), the call's signal ending the read (abort — the
// caller's deadline), or the read's failure (error — a cut of the
// transport; the caller classifies it with the common table).
type ByokBodyRead =
  | { kind: "abort"; error: unknown }
  | { kind: "bytes"; bytes: Uint8Array<ArrayBuffer> | null }
  | { kind: "error"; error: unknown }
  | { kind: "limit" };

/**
 * The 2xx's body, read whole inside the slot: to the end (EOF), to the cap
 * (above it limit — the caller refuses the answer as invalid_response),
 * or to the call's signal (an abort while reading is abort — the caller
 * classifies it as timeout). A read failure keeps the error for the
 * caller's cause table. The body is cancelled when the read stops (at the
 * cap, by the abort, or by a failure that did not close it), so nothing
 * outlives the slot.
 */
async function byokResponseBodyRead(response: Response, maxBytes: number, signal: AbortSignal | undefined): Promise<ByokBodyRead> {
  const body = response.body;
  if (body === null) return { kind: "bytes", bytes: null };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (!signal?.aborted) {
      let step;
      try {
        step = await byokAbortRace(reader.read(), signal);
      } catch (error) {
        // The read was cut: the call's signal ending it (the deadline, the
        // caller's abort) is the timeout's case; anything else is a cut of
        // the transport for the common table.
        if (signal?.aborted) return { kind: "abort", error };
        return { kind: "error", error };
      }
      if (step.done || !step.value) break;
      if (length + step.value.byteLength > maxBytes) return { kind: "limit" };
      chunks.push(step.value);
      length += step.value.byteLength;
    }
    if (signal?.aborted) {
      return { kind: "abort", error: signal.reason instanceof Error ? signal.reason : new Error("the call's signal ended the read") };
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { kind: "bytes", bytes };
  } catch (error) {
    return { kind: "error", error };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released.
    }
    // Not awaited: a source whose cancel never settles must not hold the
    // read, and with it the slot, past the deadline or the cap. Its
    // rejection is handled.
    try {
      body.cancel().catch(() => {});
    } catch {
      // A body that already errored or closed: nothing to cancel.
    }
  }
}

/** The retrieval endpoints of the row: the captions and the embeddings; null without a route. */
export interface ByokRetrievalEndpoints {
  // The captions: the user's chat model; null without the vision ok.
  vision: VisionEndpoint | null;
  // The embeddings: the saved embedding model; null without the ok.
  embedding: EmbeddingEndpoint | null;
}

/**
 * The retrieval endpoints of the principal's BYOK row: null in any of the
 * five no-route cases (no Pro, no valid master key, no row, an untested or
 * failed capability per endpoint, an unconfigured model), or the endpoints
 * with the decrypted key — only on the server — and the per-call egress.
 * Both endpoints null answers null too (there is nothing to route): the
 * caller keeps the gateway path, or the text-only turn search.
 */
export async function byokRetrievalEndpoints(env: CloudEnv, principal: Principal): Promise<ByokRetrievalEndpoints | null> {
  // The stored row that names the Pinar has no route either, before the
  // capabilities and the decrypt (byokRoutableRow, shared with the turn's
  // and the capability routes).
  const routable = await byokRoutableRow(env, principal);
  if (routable === null) return null;
  const { crypto, row } = routable;
  const capabilities = capabilitiesOf(row.capabilitiesJson);
  // The capabilities alone make both endpoints unusable: no decrypt, and
  // no key in a log or an error (the S3a rule — the status and the
  // availability reads must not decrypt a key they would refuse).
  const visionUsable = capabilities.vision.ok === true && row.chatModel !== "";
  const embeddingUsable = capabilities.embeddings.ok === true && row.embeddingModel !== "";
  if (!visionUsable && !embeddingUsable) return null;
  let apiKey: string;
  try {
    apiKey = await crypto.decrypt(row.keyCiphertext);
  } catch {
    // A ciphertext the master key cannot read: no route, and the error is
    // not logged (a driver or a tag may echo the key).
    return null;
  }
  const egress = byokSlotEgress(byokEgressFor(env), principal.id);
  const callFetch = byokEgressAsFetch(egress);
  const vision: VisionEndpoint | null =
    visionUsable
      ? { apiKey, baseUrl: row.baseUrl, byok: true, fetch: callFetch, kind: "openai-compatible", model: row.chatModel, thinkingControl: false }
      : null;
  const embedding: EmbeddingEndpoint | null =
    embeddingUsable
      ? { apiKey, baseUrl: row.baseUrl, byok: true, fetch: callFetch, model: row.embeddingModel }
      : null;
  return { embedding, vision };
}
