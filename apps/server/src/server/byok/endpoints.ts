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
// the turn). Both endpoints carry byokCallEgress: the egress (byokFetch,
// the refusal until S6, or the fake the tests inject) wrapped with the
// per-user concurrency slot held PER EGRESS CALL — a multi-call index or a
// batched embedding hold one slot at a time, never the whole pass — and
// with the common cause table, so every failure crosses the retrieval and
// filing layers as a caused ByokCallError: the provider's body, the URL
// and the key never appear in an error, a result or a log.
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
import { byokAcquireSlot, byokSlotRelease } from "./route";
import { byokRow } from "./store";

// The body of a non-2xx answer, capped like the turn's and S2's: enough
// for the 403/404 markers of the common table, never more.
const BYOK_CALL_ERROR_BODY_LIMIT = 256 * 1024;

// The egress as the endpoint's fetch (assistant/retrieval): the SDK and the
// endpoint helpers call fetch with the URL string, and the Request/URL forms
// are kept for the typeof fetch contract (byok/route.ts, the same shape).
function byokEgressAsFetch(egress: ByokEgress): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return egress(url, init);
  }) as typeof fetch;
}

/**
 * The BYOK egress with the per-call concurrency slot and the common cause
 * table (F5 contract §1 and §5). The slot is taken right before the egress
 * call and released in the finally: above BYOK_MAX_CONCURRENT_CALLS the
 * call is refused with rate_limited (no queue), and a call in flight never
 * holds the slot of the next one. A non-2xx is read (capped) for the 403/
 * 404 markers and refused as the caused ByokCallError; a thrown egress
 * failure (the refusal, the deadline, the network) is the same cause table.
 * A 2xx passes through untouched (the caller reads the body).
 */
export function byokCallEgress(egress: ByokEgress, ownerId: string): ByokEgress {
  return async (url, init) => {
    if (!byokAcquireSlot(ownerId)) throw new ByokCallError({ cause: "rate_limited", retryAfterSeconds: null });
    const release = byokSlotRelease(ownerId);
    try {
      const response = await egress(url, init);
      if (response.ok) return response;
      let bodyText: string | undefined;
      try {
        bodyText = await byokReadBody(response, BYOK_CALL_ERROR_BODY_LIMIT);
      } catch {
        // A body that fails to be read: the status and the guard's header
        // still decide the cause.
      }
      throw new ByokCallError(byokResponseCause(response, bodyText));
    } catch (error) {
      if (error instanceof ByokCallError) throw error;
      throw new ByokCallError(byokEgressErrorCause(error));
    } finally {
      release();
    }
  };
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
  const egress = byokCallEgress(byokEgressFor(env), principal.id);
  const callFetch = byokEgressAsFetch(egress);
  const vision: VisionEndpoint | null =
    visionUsable
      ? { apiKey, baseUrl: row.baseUrl, fetch: callFetch, kind: "openai-compatible", model: row.chatModel, thinkingControl: false }
      : null;
  const embedding: EmbeddingEndpoint | null =
    embeddingUsable
      ? { apiKey, baseUrl: row.baseUrl, byok: true, fetch: callFetch, model: row.embeddingModel }
      : null;
  return { embedding, vision };
}
