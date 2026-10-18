// F5/S3: the common cause classification of a BYOK failure (F5 contract
// §1 and §4): the single table shared by S2's capability detection
// (byok/detect.ts) and the assistant turn routing (byok/route.ts).
//
// Every answer is a short cause code: the provider's body and the key never
// appear in an error, a result or a log. 401/403 → key_rejected (a 403 whose
// body type is scope_denied → scope_denied); 404 → model_not_found when the
// body names a model, else service_disabled; 429 → rate_limited; 503 →
// unavailable; a deadline → timeout; a 200 outside the expected shape →
// invalid_response; the egress refusal → egress_unavailable; the guard's
// x-edger-egress-error codes (EDG-38 §4) → endpoint_blocked,
// endpoint_unreachable, timeout or rate_limited. The 429's Retry-After
// (seconds) rides the rate_limited cause, honored only to inform, never
// waited.

import { ByokEgressUnavailableError } from "./fetch";

/** A short cause for a BYOK capability or call that did not pass (F5 contract §2). */
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

/** The cause, with the 429's Retry-After in seconds when there is one. */
export interface ByokCause {
  cause: ByokCauseCode;
  retryAfterSeconds: number | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
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

/**
 * The Retry-After of a limit answer, in seconds, only when the header is a
 * plain integer (an HTTP-date is not seconds: it is not informed).
 */
export function byokRetryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seconds = Number(trimmed);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

/**
 * The cause of a non-2xx response: the guard's x-edger-egress-error header
 * wins, then the status (EDG-38 §4). The 429's Retry-After rides the
 * rate_limited cause.
 */
export function byokResponseCause(response: Response, bodyText: string | undefined): ByokCause {
  let cause: ByokCauseCode;
  const guardError = response.headers.get("x-edger-egress-error");
  if (guardError !== null) {
    switch (guardError) {
      case "EGRESS_TIMEOUT":
        cause = "timeout";
        break;
      case "EGRESS_LIMIT":
        cause = "rate_limited";
        break;
      case "EGRESS_BAD_TARGET":
      case "EGRESS_HOST_BLOCKED":
      case "EGRESS_PORT_BLOCKED":
        cause = "endpoint_blocked";
        break;
      default:
        // DNS, upstream, redirects, response size and any code the
        // provisional contract still names differently: the endpoint did
        // not answer as it should.
        cause = "endpoint_unreachable";
        break;
    }
  } else {
    const marker = bodyErrorMarker(bodyText);
    switch (response.status) {
      case 401:
        cause = "key_rejected";
        break;
      case 403:
        cause = marker.includes("scope_denied") ? "scope_denied" : "key_rejected";
        break;
      case 404:
        cause = marker.includes("model") ? "model_not_found" : "service_disabled";
        break;
      case 429:
        cause = "rate_limited";
        break;
      case 503:
        cause = "unavailable";
        break;
      case 504:
        cause = "timeout";
        break;
      default:
        // A 4xx (400, 422, ...) is the endpoint refusing what the model was
        // asked to do; any other 5xx is the endpoint itself.
        cause = response.status < 500 ? "model_not_found" : "unavailable";
        break;
    }
  }
  return { cause, retryAfterSeconds: cause === "rate_limited" ? byokRetryAfterSeconds(response) : null };
}

/** The cause of the error the egress threw (its refusal, the deadline, the network). */
export function byokEgressErrorCause(error: unknown, signal?: AbortSignal): ByokCause {
  if (error instanceof ByokEgressUnavailableError) return { cause: "egress_unavailable", retryAfterSeconds: null };
  // The call's own signal ended it (the deadline, the caller's abort),
  // whatever the reason it carries: the same timeout in every phase.
  if (signal?.aborted === true || isAbort(error)) return { cause: "timeout", retryAfterSeconds: null };
  return { cause: "endpoint_unreachable", retryAfterSeconds: null };
}

/**
 * The cause of a 2xx body cut mid-stream (contract §4 "Streaming"): the
 * guard cut the stream by size or time, or the network dropped. A deadline
 * (an AbortError or a TimeoutError) is a timeout; any other cut is the
 * endpoint not reaching. The cut must never settle as a final, truncated
 * answer: byokTurnFetch turns it into a ByokAssistantTurnError.
 */
export function byokStreamCutCause(error: unknown): ByokCause {
  return { cause: isAbort(error) ? "timeout" : "endpoint_unreachable", retryAfterSeconds: null };
}

/**
 * The body capped at maxBytes, with the stream cancelled when the read
 * stops (at the cap, or by a failure that already closed it): a body cut at
 * the cap must not keep the connection open, and the lock is released
 * before the cancel. A read failure throws to the caller, which classifies
 * the call from what it already knows (the status, the guard's header).
 */
export async function byokReadBody(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const body = response.body;
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < maxBytes) {
      signal?.throwIfAborted();
      const { done, value } = await byokAbortRace(reader.read(), signal);
      if (done || !value) break;
      const keep = Math.min(value.byteLength, maxBytes - length);
      chunks.push(keep === value.byteLength ? value : value.subarray(0, keep));
      length += keep;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released.
    }
    // Not awaited: a source whose cancel never settles must not hold the
    // caller (and a BYOK slot with it) past its deadline. Its rejection is
    // handled.
    try {
      body.cancel().catch(() => {});
    } catch {
      // A body that already errored or closed: nothing to cancel.
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * `promise` raced against the signal's abort: the abort rejects with the
 * signal's reason (the deadline's, the caller's) even while the read is
 * still in flight, and the promise's own outcome is always handled, so
 * neither side is left unprocessed. Without a signal the promise stands
 * alone.
 */
export function byokAbortRace<T>(value: Promise<T> | T, signal: AbortSignal | undefined): Promise<T> {
  // An egress may answer synchronously (a test fake): it is still a promise here.
  const promise = Promise.resolve(value);
  if (signal === undefined) return promise;
  if (signal.aborted) {
    // Already aborted (before the call, or synchronously inside it): no
    // abort event will fire again. The promise's late outcome is handled.
    promise.catch(() => {});
    const reason = signal.reason;
    return Promise.reject(reason instanceof Error ? reason : new Error("the call's signal aborted the read"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      const reason = signal.reason;
      reject(reason instanceof Error ? reason : new Error("the call's signal aborted the read"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * The turn's BYOK failure (thrown by the byok/route.ts model fetch): the
 * classified cause and a fixed message. The provider's body, the URL and
 * the key never cross this class, so it can be thrown, carried by the
 * stream's error part or logged without leaking.
 */
export class ByokAssistantTurnError extends Error {
  readonly cause: ByokCauseCode;
  readonly retryAfterSeconds: number | null;
  constructor(byokCause: ByokCause) {
    super("byok assistant turn failed");
    this.name = "ByokAssistantTurnError";
    this.cause = byokCause.cause;
    this.retryAfterSeconds = byokCause.retryAfterSeconds;
  }
}

/**
 * A BYOK capability call's failure (F5/S3c: the pin captions and embeddings
 * of the index, the capture's embedding of the automatic destination):
 * the classified cause and a fixed message, the same contract as the turn's
 * class. The provider's body, the URL and the key never cross it, so it can
 * be thrown through the retrieval and filing layers — whose fixed-message
 * errors it replaces where it is thrown — or classified by the caller (the
 * destination's cause in the choice's result) without leaking.
 */
export class ByokCallError extends Error {
  readonly cause: ByokCauseCode;
  readonly retryAfterSeconds: number | null;
  constructor(byokCause: ByokCause) {
    super("byok call failed");
    this.name = "ByokCallError";
    this.cause = byokCause.cause;
    this.retryAfterSeconds = byokCause.retryAfterSeconds;
  }
}
