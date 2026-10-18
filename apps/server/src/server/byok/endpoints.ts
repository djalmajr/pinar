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
// egress call and held until the answer settles: a non-2xx or a thrown
// egress failure release it at once, a 2xx keeps it until the body settles
// (read to the end, an error in the read, or a cancel), so the consumer's
// body read and parse are inside the call, never after the slot freed. A
// multi-call index or a batched embedding hold one slot at a time, never
// the whole pass. And with the common cause table, so every failure
// crosses the retrieval and filing layers as a caused ByokCallError: the
// provider's body, the URL and the key never appear in an error, a result
// or a log.
//
// Above the cap the call fails with rate_limited (no queue); the caller
// degrades: the turn's index goes text, the automatic destination the
// default with the cause in the choice's result.

import type { EmbeddingEndpoint } from "../assistant/retrieval/embeddings";
import type { VisionEndpoint } from "../assistant/retrieval/vision";
import { planIncludesAi } from "../../lib/entitlements";
import type { CloudEnv, Principal } from "../cloud-api";
import { capabilitiesOf } from "./api";
import { ByokCallError, byokEgressErrorCause, byokReadBody, byokResponseCause } from "./cause";
import { byokCrypto } from "./crypto";
import type { ByokEgress } from "./fetch";
import { byokEgressFor } from "./fetch";
import { byokAcquireSlot, byokEgressAsFetch, byokSlotRelease } from "./route";
import { byokRow } from "./store";

// The body of a non-2xx answer, capped like the turn's and S2's: enough
// for the 403/404 markers of the common table, never more.
const BYOK_CALL_ERROR_BODY_LIMIT = 256 * 1024;

/**
 * The BYOK egress with the per-call concurrency slot and the common cause
 * table (F5 contract §1 and §5). The slot is taken right before the egress
 * call and held for the call: above BYOK_MAX_CONCURRENT_CALLS the call is
 * refused with rate_limited (no queue), and a call in flight never holds
 * the slot of the next one. The release is idempotent; a thrown egress
 * failure (the refusal, the deadline, the network) and a non-2xx (read
 * capped for the 403/404 markers, refused as the caused ByokCallError) are
 * the common cause table and release the slot at once. A 2xx passes its
 * body through untouched, but the slot is held until the body settles —
 * read to the end, an error in the read, or a cancel: the consumer's read
 * and parse are part of the call, so a body still pending still counts the
 * call as in flight (the next call of the user is capped, not started on
 * top of it). The name keeps it apart from byok/call.ts's one-shot
 * byokCallEgress (the S3b voice/reproduction call): this one wraps an
 * egress with the slot and the cause, that one performs a single call and
 * returns the body text.
 */
export function byokSlotEgress(egress: ByokEgress, ownerId: string): ByokEgress {
  return async (url, init) => {
    if (!byokAcquireSlot(ownerId)) throw new ByokCallError({ cause: "rate_limited", retryAfterSeconds: null });
    // The release is idempotent: the 2xx hands it to the answer's body, where
    // the slot is held until the body settles; every other path releases it
    // right away.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      byokSlotRelease(ownerId)();
    };
    let response: Response;
    try {
      response = await egress(url, init);
    } catch (error) {
      release();
      if (error instanceof ByokCallError) throw error;
      throw new ByokCallError(byokEgressErrorCause(error));
    }
    if (response.ok) return byokResponseHoldingSlot(response, release);
    let bodyText: string | undefined;
    try {
      bodyText = await byokReadBody(response, BYOK_CALL_ERROR_BODY_LIMIT);
    } catch {
      // A body that fails to be read: the status and the guard's header
      // still decide the cause.
    }
    release();
    throw new ByokCallError(byokResponseCause(response, bodyText));
  };
}

// The 2xx answer of byokSlotEgress: the slot is held until the body
// settles — read to the end (EOF), an error in the read, or a cancel (the
// consumer's abort, or the body cut). The pass-through stream does not
// touch the bytes (the caller still owns the read and the parse); a
// response without a body settles at once.
function byokResponseHoldingSlot(response: Response, release: () => void): Response {
  const body = response.body;
  if (body === null) {
    release();
    return response;
  }
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    release();
  };
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      // The body read to the end: the call's work is done.
      flush() {
        settle();
      },
      // A cancel (the consumer's abort, an error in the read, a cut body):
      // the wait is over.
      cancel() {
        settle();
      },
    }),
  );
  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
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
  if (!planIncludesAi(principal.plan)) return null;
  const crypto = await byokCrypto(env.BYOK_MASTER_KEY);
  if (crypto === null) return null;
  const row = await byokRow(env, principal.id);
  if (row === null) return null;
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
