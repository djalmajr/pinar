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
  reason: "chosen" | "low_confidence" | "no_candidates" | "timeout" | "error";
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

  // The engine is raced against the signal, so the answer never waits past
  // the deadline, even for a fetch or centroid lookup that ignores it.
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([runEngine({ ...input, similarity }, signal), aborted]);
  } catch {
    return failed();
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
