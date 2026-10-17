// Capture filing of the Cloud (F3.5 contract §3.1, decisions A28 and A33).
//
// cloud-api.ts loads this module with a dynamic import, and only behind the
// assistant gate (A3) with the preference on: the engines pull in the AI SDK
// (decisions.ts and similarity.ts import retrieval/index), and the capture
// path with the preference off must not load it.
//
// Engine: the retrieval endpoints of the deployment and their /models
// detection (cloudRetrievalEndpoints, cached): `decisions` when the
// OpenAI-compatible endpoint of AI_BASE_URL declares the decisions extra
// available for the key (A46: in every environment), otherwise
// `similarity` with the embedding endpoint, otherwise none. Through the
// gateway it is never `decisions`, and `similarity` needs
// AI_EMBEDDING_MODEL in the gateway catalog (A44).
//
// Data: cloud-api.ts reads the owner's collections and sessions (it knows
// D1 and its in-memory fallback); the centroids read the owner's F3 entries
// through cloudPinIndexStore.

import { cloudRetrievalEndpoints, type CloudIndexCostRecorder, type CloudPinEnv } from "../assistant/retrieval/runtime-cloud";
import { cloudPinIndexStore } from "../assistant/retrieval/store-cloud";
import type { FilingThresholdEnv } from "./constants";
import { fileCapture, type FilingCapture, type FilingEngineChoice, type FilingOutcome, type FilingSource } from "./runtime";

let testFetch: typeof fetch | null = null;

// Test hook: the fetch of the detection and the engine (null restores the
// real one).
export function setCloudFilingFetchForTests(fetchFn: typeof fetch | null): void {
  testFetch = fetchFn;
}

function fetchOption(): { fetch?: typeof fetch } {
  return testFetch ? { fetch: testFetch } : {};
}

/**
 * The engine of the deployment, or null without the AI configuration or a
 * usable engine. `recordIndexCost` records the gateway embeddings of the
 * similarity engine (the margin monitor's index costs).
 */
export async function cloudFilingEngine(env: CloudPinEnv, recordIndexCost?: CloudIndexCostRecorder): Promise<FilingEngineChoice | null> {
  const endpoints = await cloudRetrievalEndpoints(env, testFetch ?? undefined, recordIndexCost);
  if (!endpoints) return null;
  if (endpoints.decisions) return { endpoint: endpoints.decisions, kind: "decisions" };
  if (!endpoints.embedding) return null;
  return { embedding: endpoints.embedding, kind: "similarity" };
}

/**
 * GET and PATCH /api/preferences behind the gate: an engine is available.
 * The answer waits at most `timeoutMs`; a detection still running then
 * answers false, and its result reaches the cache for the next read.
 */
export async function cloudAutoCaptureDestinationAvailable(env: CloudPinEnv, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, timeoutMs));
  });
  try {
    return (await Promise.race([cloudFilingEngine(env).catch(() => null), late])) !== null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Files a new Cloud capture of `ownerId`; the caller checked the gate and
 * the preference. The env also carries the filing similarity threshold
 * variables (F3.5 §1), applied where chooseCollection resolves them.
 */
export function fileCloudCapture(input: {
  batchId: string | null;
  capture: FilingCapture;
  env: CloudPinEnv & FilingThresholdEnv;
  ownerId: string;
  recordIndexCost?: CloudIndexCostRecorder;
  source: Omit<FilingSource, "entriesFor">;
  timeoutMs?: number;
}): Promise<FilingOutcome> {
  const store = cloudPinIndexStore(input.env, input.ownerId);
  return fileCapture({
    batchId: input.batchId,
    capture: input.capture,
    engine: () => cloudFilingEngine(input.env, input.recordIndexCost),
    ...fetchOption(),
    source: { ...input.source, entriesFor: (sessionIds) => store.entriesFor(sessionIds) },
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
}
