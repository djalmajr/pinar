// Picks the collection a new capture is filed in (F3.5 contract §1).
//
// chooseCollection asks one engine, `decisions` (the appliance's
// POST /v1/decisions) or `similarity` (the capture's embedding against each
// collection's centroid in the F3 index), and files the capture only when
// the engine is confident enough. Anything else (low confidence, an engine
// error, the deadline) answers collectionId null: the capture goes to the
// Inbox. Engine failures never reach the caller; invalid candidates do,
// since they are the caller's bug.
//
// `confidence` is the engine's score for its best collection, whatever the
// reason: the probability of the best collection label for `decisions`,
// the best cosine (floored at 0) for `similarity`, 0 when no engine
// answered.
//
// For `similarity`, confident enough means the best cosine reaches
// FILING_SIMILARITY_MIN and leads the second by FILING_SIMILARITY_MARGIN
// (F3.5 §1): the deployment's plain decimals in 0-1, read from the
// environment at each call (filingSimilarityThresholds), the defaults of
// constants.ts when a value is absent or invalid.

import type { AssistantEndpoint } from "../assistant/models";
import type { EmbeddingEndpoint } from "../assistant/retrieval/embeddings";
import {
  FILING_DECISIONS_MIN,
  FILING_NONE_OPTION,
  FILING_SIMILARITY_MARGIN,
  FILING_SIMILARITY_MIN,
  FILING_TIMEOUT_MS,
  filingSimilarityThresholds,
  type FilingCandidate,
  type FilingSimilarityThresholds,
} from "./constants";
import { decideCollection } from "./decisions";
import { rankBySimilarity } from "./similarity";

export {
  FILING_DECISIONS_MIN,
  FILING_NONE_OPTION,
  FILING_SIMILARITY_MARGIN,
  FILING_SIMILARITY_MIN,
  FILING_TIMEOUT_MS,
  filingSimilarityThresholds,
  type FilingCandidate,
  type FilingSimilarityThresholds,
};

// /v1/decisions takes up to 20 options, and the last one is
// FILING_NONE_OPTION (A32).
const DECISIONS_MAX_CANDIDATES = 19;
const LABEL_MAX_CHARS = 200;

export type FilingEngine =
  | { kind: "decisions"; endpoint: AssistantEndpoint } // appliance with the `decisions` extra available
  | { kind: "similarity"; embedding: EmbeddingEndpoint; centroid(collectionId: string): Promise<number[] | null> };

export interface FilingChoice {
  collectionId: string | null; // null → Inbox
  confidence: number; // 0..1
  engine: FilingEngine["kind"] | "none";
  reason: "chosen" | "low_confidence" | "no_candidates" | "timeout" | "error" | "no_credits";
}

/**
 * The credits of the automatic destination (A53): the Cloud passes one so
 * the engine call charges one credit; the local runtime files without one,
 * so it is optional. `chooseCollection` asks it right before the engine
 * call — a capture that never calls the engine (no candidates, the batch
 * rule, no engine) is never billed.
 */
export interface FilingCreditMeter {
  /**
   * Reserve the capture's credit with the engine's model. "reserved": this
   * run settles the credit (consume on the answer, refund on a failure or
   * the deadline). "replayed": an earlier run of this capture already
   * settled — the engine must not be called again (a refund is not a
   * payment), and the filing replays `replayChoice()`. "existing": the
   * capture already has an open or refunded usage — the engine is not
   * called and the capture keeps the destination the session already has.
   * "no_credits": no balance — the engine must not be called and the
   * capture is the Inbox with reason no_credits. "error": reserving failed
   * — already logged; the capture is the Inbox and nothing is called.
   */
  reserve(model: string): Promise<"error" | "existing" | "no_credits" | "replayed" | "reserved">;
  /**
   * The settled run's stored choice (`result_json`) after a "replayed"
   * reserve: the filing reapplies it without the engine and without a
   * charge; null when there is no stored result.
   */
  replayChoice(): string | null;
  /**
   * Consume the reserved credit; the answer (the FilingChoice) is stored as
   * result_json. Returns false when the settlement failed (already logged):
   * the capture goes to the Inbox, unmarked, and the credit is left to the
   * sweeper.
   */
  consume(resultJson: string): Promise<boolean>;
  /** Refund the reserved credit: the engine failed or the deadline fired. A failed refund is logged and left to the sweeper. */
  refund(errorCode: string): Promise<void>;
}

// The FilingChoice a settled run of the capture stored as result_json: the
// re-upload replays it without the engine (F4d: a refund is not a payment).
// Anything that is not exactly the shape the filing stored is refused as a
// whole, so a corrupted or foreign result_json never drives a destination.
export function parseFilingChoice(json: string | null): FilingChoice | null {
  if (typeof json !== "string") return null;
  let body: unknown;
  try {
    body = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const choice = body as Record<string, unknown>;
  const { collectionId, confidence, engine, reason } = choice;
  if (collectionId !== null && typeof collectionId !== "string") return null;
  if (typeof confidence !== "number" || Number.isNaN(confidence) || confidence < 0 || confidence > 1) return null;
  if (engine !== "decisions" && engine !== "similarity" && engine !== "none") return null;
  if (!["chosen", "low_confidence", "no_candidates", "timeout", "error", "no_credits"].includes(String(reason))) return null;
  return {
    collectionId: collectionId as string | null,
    confidence,
    engine: engine as FilingChoice["engine"],
    reason: reason as FilingChoice["reason"],
  };
}

// Labels are the decisions options: unique, not empty, at most
// LABEL_MAX_CHARS, and never FILING_NONE_OPTION itself.
function assertCandidates(candidates: FilingCandidate[]): void {
  const labels = new Set<string>([FILING_NONE_OPTION]);
  for (const { label } of candidates) {
    if (label.trim() === "" || label.length > LABEL_MAX_CHARS || labels.has(label)) {
      throw new Error("invalid filing candidates");
    }
    labels.add(label);
  }
}

function lastUsedTime(candidate: FilingCandidate): number {
  const time = candidate.lastUsedAt === null ? Number.NaN : Date.parse(candidate.lastUsedAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

// The `limit` candidates captured into most recently (never used last, ties
// by label), kept in the caller's order.
function mostRecentlyUsed(candidates: FilingCandidate[], limit: number): FilingCandidate[] {
  if (candidates.length <= limit) return candidates;
  const kept = new Set(
    [...candidates]
      .sort((a, b) => lastUsedTime(b) - lastUsedTime(a) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
      .slice(0, limit),
  );
  return candidates.filter((candidate) => kept.has(candidate));
}

// The env the similarity thresholds are read from (F3.5 §1): the worker's
// (Deno) environment on the Cloud, the node process's on the local server.
// A runtime without readable env yields undefined, and the defaults apply:
// the read never throws and a capture is never broken by it.
function readFilingEnv(name: string): string | undefined {
  try {
    const deno = (globalThis as { Deno?: { env?: { get(name: string): string | undefined } } }).Deno;
    if (deno?.env) return deno.env.get(name);
  } catch {
    // The env is not readable in this runtime (no permission).
  }
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return processEnv?.[name];
}

async function runEngine(
  input: { candidates: FilingCandidate[]; engine: FilingEngine; fetch?: typeof fetch; similarity: FilingSimilarityThresholds; text: string },
  signal: AbortSignal,
): Promise<FilingChoice> {
  const { engine } = input;
  if (engine.kind === "decisions") {
    const decision = await decideCollection({
      candidates: mostRecentlyUsed(input.candidates, DECISIONS_MAX_CANDIDATES),
      endpoint: engine.endpoint,
      fetch: input.fetch,
      signal,
      text: input.text,
    });
    const chosen = decision.collectionId !== null && decision.confidence >= FILING_DECISIONS_MIN;
    return {
      collectionId: chosen ? decision.collectionId : null,
      confidence: decision.confidence,
      engine: "decisions",
      reason: chosen ? "chosen" : "low_confidence",
    };
  }

  const ranked = await rankBySimilarity({
    candidates: input.candidates,
    centroid: (collectionId) => engine.centroid(collectionId),
    embedding: engine.embedding,
    fetch: input.fetch,
    signal,
    text: input.text,
  });
  const [best, second] = ranked;
  // A lone collection has no rival to be confused with.
  const chosen =
    best !== undefined &&
    best.score >= input.similarity.min &&
    (second === undefined || best.score - second.score >= input.similarity.margin);
  return {
    collectionId: chosen ? best.candidate.collectionId : null,
    confidence: Math.max(0, best?.score ?? 0),
    engine: "similarity",
    reason: chosen ? "chosen" : "low_confidence",
  };
}

export async function chooseCollection(input: {
  candidates: FilingCandidate[];
  engine: FilingEngine;
  fetch?: typeof fetch;
  meter?: FilingCreditMeter;
  signal?: AbortSignal;
  text: string; // captureFilingText(...)
  timeoutMs?: number; // default FILING_TIMEOUT_MS
}): Promise<FilingChoice> {
  assertCandidates(input.candidates);
  if (input.candidates.length === 0) {
    return { collectionId: null, confidence: 0, engine: "none", reason: "no_candidates" };
  }

  const deadline = AbortSignal.timeout(input.timeoutMs ?? FILING_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  const failed = (): FilingChoice => ({
    collectionId: null,
    confidence: 0,
    engine: input.engine.kind,
    reason: deadline.aborted ? "timeout" : "error",
  });
  if (signal.aborted) return failed();
  // The deployment's similarity thresholds (F3.5 §1), resolved per call:
  // an absent or invalid value keeps the default and never throws.
  const similarity = filingSimilarityThresholds(readFilingEnv);

  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  // The meter never throws (it logs its own failures); these guards keep a
  // surprise rejection from breaking the capture, which never fails because
  // of the billing.
  const settleLog = (error: unknown) =>
    console.error("filing_credit_settle_failed", JSON.stringify({ error: String(error) }));

  // A53 (F4d hardened): the credit is reserved only now, after the
  // no-candidates and the already-expired checks — a capture that never
  // calls the engine is never billed — and the reservation, the
  // consumption and the refund respect the capture's budget. A deadline
  // that fires while the credit is reserved or consumed answers now (the
  // Inbox, the capture's reason); the late settlement, when it lands,
  // settles itself: a late reservation becomes a refund for its timeout,
  // a late consumption is voided by the row's status. A refunded run never
  // calls the engine or settles again (a refund is not a payment): a
  // settled run replays its stored choice, an open or refunded usage keeps
  // the destination the session already has.
  const meter = input.meter;
  let settled = false;
  if (meter) {
    const model = input.engine.kind === "decisions" ? input.engine.endpoint.model : input.engine.embedding.model;
    const reserve = meter.reserve(model);
    void reserve.catch(settleLog);
    let state: Awaited<ReturnType<FilingCreditMeter["reserve"]>>;
    try {
      state = await Promise.race([reserve, aborted]);
    } catch {
      // The deadline fired while the reservation was pending: the capture
      // answers now, and the late reservation, when it confirms, is
      // refunded as its timeout.
      void reserve
        .then((late) => (late === "reserved" ? meter.refund("reservation_timeout") : undefined))
        .catch(settleLog);
      return failed();
    }
    if (state === "replayed") {
      // An earlier run of this capture already settled: the filing replays
      // its stored choice, without the engine and without a charge. A
      // corrupt stored choice falls back to the Inbox.
      const replayedChoice = parseFilingChoice(meter.replayChoice());
      return replayedChoice ?? {
        collectionId: null,
        confidence: 0,
        engine: input.engine.kind,
        reason: "error",
      };
    }
    if (state === "existing") {
      // The capture already has an open or a refunded usage: the engine is
      // not called again and nothing settles; the capture keeps the
      // destination the session already has.
      return { collectionId: null, confidence: 0, engine: input.engine.kind, reason: "error" };
    }
    if (state === "no_credits") {
      return { collectionId: null, confidence: 0, engine: input.engine.kind, reason: "no_credits" };
    }
    if (state === "error") return failed();
    settled = true;
  }

  // The engine posts through its own deadline (postEndpointJson,
  // FILING_TIMEOUT_MS), which can fire a tick before the race's signal when
  // the two coincide, and the caller's signal (fileCapture's budget) can
  // fire a few milliseconds before this deadline. All of them are a
  // deadline, not an inference failure, so the refund classifies them
  // together (the reason keeps its own contract: failed() below).
  const timedOut = (error: unknown) =>
    signal.aborted || (error instanceof Error && error.message.endsWith("timed out"));
  try {
    // The engine is raced against the signal, so the answer never waits
    // past the deadline, even for a fetch or centroid lookup that ignores
    // it.
    const choice = await Promise.race([runEngine({ ...input, similarity }, signal), aborted]);
    if (settled) {
      // The engine answered (the Inbox included): one credit, whatever the
      // choice. The settlement respects the budget too.
      const consume = meter!.consume(JSON.stringify(choice));
      void consume.catch(settleLog);
      let ok: boolean;
      try {
        ok = await Promise.race([consume, aborted]);
      } catch {
        // The deadline fired while the credit was being consumed: the
        // capture answers now and the credit goes back when the
        // confirmation lands (it is voided when it committed first).
        void meter!.refund("reservation_timeout").catch(settleLog);
        return failed();
      }
      if (!ok) {
        // The settlement failed (logged by the meter): the credit is left
        // to the sweeper and the capture goes to the Inbox, unmarked — it
        // never fails because of the billing.
        return { collectionId: null, confidence: 0, engine: input.engine.kind, reason: "error" };
      }
    }
    return choice;
  } catch (error) {
    if (settled) {
      // The engine failed, or it was cut by a deadline — this one or the
      // caller's, or the engine's own postEndpointJson deadline. The cut
      // is not an inference failure, so the credit goes back as the
      // reservation's timeout. Within the budget the refund is awaited;
      // past it the capture answers now and the refund settles when it
      // settles.
      const refund = meter!.refund(timedOut(error) ? "reservation_timeout" : "ai_inference_failed");
      void refund.catch(settleLog);
      if (!signal.aborted) await Promise.race([refund, aborted]).catch(() => {});
    }
    // The reason keeps the contract: this deadline is "timeout", the
    // caller's signal is "error" (the caller relabels its own budget).
    return failed();
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
