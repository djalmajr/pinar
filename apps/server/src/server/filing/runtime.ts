// Files a new capture (F3.5 contract §0 and §3.1, decisions A27 to A31),
// for both runtimes: runtime-local.ts and runtime-cloud.ts give it the
// engine detection and the person's data.
//
// Order: the batch rule comes first, since it needs no engine (A27): a
// capture that enters an existing batch (one with another session already
// in it) follows the batch's most recent other session, its collection and
// its mark ("auto" or none), even with the endpoint down; a batch whose
// collection is not a candidate (the Inbox) keeps the capture in the Inbox,
// unmarked. Two first captures of a batch that arrive together both find it
// empty; the routes keep the batch whole (A36): the Cloud one claims the
// batch's destination after the choice, the local one files the captures of
// a batch one at a time. Otherwise the engine is detected; without one the capture goes
// to the Inbox with reason "error" (A29), and with one chooseCollection
// picks among the candidates, marking "auto" what it files.
//
// Deadline: one FILING_TIMEOUT_MS budget starts with fileCapture and covers
// the batch lookup, the detection, the candidates, the centroids and the
// engine. Every step is raced against it, so the answer never waits past it;
// a step that ignores the signal goes on in the background (a detection
// still fills its cache), and its result is dropped. Past the budget the
// capture goes to the Inbox with reason "timeout". fileCapture never throws:
// any failure is the Inbox with reason "error".
//
// The capture itself never counts as an example: its id is left out of the
// batch lookup and of the recent sessions, so a re-upload is decided again
// from the other sessions.

import type { AssistantEndpoint } from "../assistant/models";
import { decodeVector, type EmbeddingEndpoint } from "../assistant/retrieval/embeddings";
import type { PinIndexEntry } from "../assistant/retrieval/types";
import { captureFilingText } from "./capture-text";
import {
  FILING_CENTROID_SESSIONS,
  FILING_EXAMPLE_TITLES,
  filingCandidates,
  type FilingCollection,
  type FilingRecentSession,
} from "./candidates";
import { chooseCollection, FILING_TIMEOUT_MS, type FilingChoice, type FilingEngine } from "./choose";
import { collectionCentroid } from "./similarity";

/** The engine a runtime detected, before the centroids are attached. */
export type FilingEngineChoice =
  | { endpoint: AssistantEndpoint; kind: "decisions" }
  | { embedding: EmbeddingEndpoint; kind: "similarity" };

export interface FilingCapture {
  captureId: string;
  page: { title: string; url: string };
  pins: Array<{ comment: string; number: number }>;
}

/** What the filing reads of the person, in each runtime. */
export interface FilingSource {
  /** The collection and mark of the batch's most recent session other than `excludeId`, or null when there is none. */
  batchSession(batchId: string, excludeId: string): Promise<{ collectionId: string; filedBy: "auto" | null } | null>;
  /** The person's collections without the protected Inbox, in a stable order. */
  collections(): Promise<FilingCollection[]>;
  /** The F3 index entries of these sessions. */
  entriesFor(sessionIds: string[]): Promise<PinIndexEntry[]>;
  /**
   * Up to `perCollection` most recent sessions of each of `collectionIds`,
   * newest first, without `excludeId`. A source that scans in pages stops
   * once `expired()` says the budget is spent.
   */
  recentSessions(input: {
    collectionIds: string[];
    excludeId: string;
    expired: () => boolean;
    perCollection: number;
  }): Promise<FilingRecentSession[]>;
}

// Resolves with the step's value, or rejects as soon as the signal aborts.
async function beforeDeadline<T>(step: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([step, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

// The similarity engine over the centroids of `sessions`: a collection's
// centroid is made of the vectors of the current embedding model in the
// index entries of its sessions (at most FILING_CENTROID_SESSIONS).
function similarityEngine(
  embedding: EmbeddingEndpoint,
  sessions: FilingRecentSession[],
  source: FilingSource,
): FilingEngine {
  return {
    async centroid(collectionId) {
      const ids = sessions
        .filter((session) => session.collectionId === collectionId)
        .slice(0, FILING_CENTROID_SESSIONS)
        .map((session) => session.id);
      if (ids.length === 0) return null;
      const wanted = new Set(ids);
      const vectors = (await source.entriesFor(ids))
        .filter((entry) => wanted.has(entry.sessionId) && entry.vector !== null && entry.model === embedding.model)
        .map((entry) => Array.from(decodeVector(entry.vector!)));
      return collectionCentroid(vectors);
    },
    embedding,
    kind: "similarity",
  };
}

/**
 * The filing of one new capture: `filing.collectionId` is the collection the
 * capture is filed in (null for the Inbox) and `filedBy` the mark to store
 * with it. `followedBatch` is set when the capture followed its batch's
 * most recent session (A27): only a batch without one has a destination
 * still to claim (A36).
 */
export interface FilingOutcome {
  filedBy: "auto" | null;
  filing: FilingChoice;
  followedBatch?: true;
}

export async function fileCapture(input: {
  batchId: string | null;
  capture: FilingCapture;
  engine: () => Promise<FilingEngineChoice | null>;
  fetch?: typeof fetch;
  source: FilingSource;
  timeoutMs?: number; // default FILING_TIMEOUT_MS
}): Promise<FilingOutcome> {
  const timeoutMs = input.timeoutMs ?? FILING_TIMEOUT_MS;
  const startedAt = Date.now();
  const deadline = AbortSignal.timeout(Math.max(0, timeoutMs));
  const left = () => timeoutMs - (Date.now() - startedAt);
  const expired = () => deadline.aborted || left() <= 0;
  let engineKind: FilingChoice["engine"] = "none";
  const inbox = (reason: FilingChoice["reason"]): FilingOutcome => ({
    filedBy: null,
    filing: { collectionId: null, confidence: 0, engine: engineKind, reason },
  });

  try {
    if (input.batchId) {
      const batch = await beforeDeadline(input.source.batchSession(input.batchId, input.capture.captureId), deadline);
      if (batch !== null) {
        const collections = await beforeDeadline(input.source.collections(), deadline);
        const candidate = collections.some((collection) => collection.collectionId === batch.collectionId);
        // The batch rule asks no engine.
        return {
          filedBy: candidate ? batch.filedBy : null,
          filing: { collectionId: candidate ? batch.collectionId : null, confidence: 0, engine: "none", reason: "chosen" },
          followedBatch: true,
        };
      }
    }

    const engine = await beforeDeadline(input.engine(), deadline);
    if (!engine) return inbox("error");
    const collections = await beforeDeadline(input.source.collections(), deadline);
    engineKind = engine.kind;
    const sessions = await beforeDeadline(
      input.source.recentSessions({
        collectionIds: collections.map((collection) => collection.collectionId),
        excludeId: input.capture.captureId,
        expired,
        perCollection: engine.kind === "similarity" ? FILING_CENTROID_SESSIONS : FILING_EXAMPLE_TITLES,
      }),
      deadline,
    );
    const remaining = left();
    if (remaining <= 0) return inbox("timeout");
    const choice = await chooseCollection({
      candidates: filingCandidates(collections, sessions),
      engine: engine.kind === "decisions" ? engine : similarityEngine(engine.embedding, sessions, input.source),
      ...(input.fetch ? { fetch: input.fetch } : {}),
      signal: deadline,
      text: captureFilingText({ page: input.capture.page, pins: input.capture.pins }),
      timeoutMs: remaining,
    });
    // chooseCollection reports its own deadline as "timeout" and the
    // caller's signal as "error"; here the signal is this budget.
    const filing: FilingChoice = choice.reason === "error" && expired() ? { ...choice, reason: "timeout" } : choice;
    return { filedBy: filing.collectionId !== null ? "auto" : null, filing };
  } catch {
    return inbox(expired() ? "timeout" : "error");
  }
}
