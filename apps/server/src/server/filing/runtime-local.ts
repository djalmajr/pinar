// Capture filing of the local app (F3.5 contract §3.1, decisions A28 and
// A33).
//
// Engine: the configured chat endpoint (localAssistantEndpoint, as the F3
// pin index reads it) and its /models detection (cached): `decisions` when
// the chat model declares the decisions extra available, otherwise
// `similarity` with the detected embedding model, otherwise none.
//
// Data: the history database that historyDatabase() hands out. The
// candidates are the collections of every project except the protected
// Inbox, in the project tree's order. The recent sessions come from the
// history newest first (created_at DESC), read in pages of SCAN_PAGE_SIZE
// until every candidate has enough of them, the history ends or the budget
// is spent; the pages are synchronous reads, and the deadline is checked
// (and timers get a turn) between them. The centroids read the F3 entries of
// the local pin index.

import type { Collection, Project } from "@pinar/shared";
import { pinarHome } from "@pinar/cli/paths";
import { detectRetrievalCapabilities } from "../assistant/retrieval/detect";
import { localAiConfigured, localAssistantEndpoint } from "../assistant/retrieval/runtime-local";
import type { PinIndexEntry } from "../assistant/retrieval/types";
import type { FilingRecentSession } from "./candidates";
import { FILING_TIMEOUT_MS } from "./choose";
import { fileCapture, type FilingCapture, type FilingEngineChoice, type FilingOutcome, type FilingSource } from "./runtime";

const SCAN_PAGE_SIZE = 100;

/** The history database methods the filing reads (apps/cli/src/history.mjs). */
export interface LocalFilingDatabase {
  listCollections(projectId: string): Collection[];
  listPinIndexEntriesFor(sessionIds: string[]): PinIndexEntry[];
  listProjects(): Project[];
  listSessions(options: { batchId?: string; limit: number; offset: number; query: string }): Array<{
    collectionId?: string | null;
    createdAt: string;
    filedBy?: "auto";
    id: string;
    page: { title?: string };
  }>;
}

let testFetch: typeof fetch | null = null;

// Test hook: the fetch of the detection and the engine (null restores the
// real one).
export function setLocalFilingFetchForTests(fetchFn: typeof fetch | null): void {
  testFetch = fetchFn;
}

function fetchOption(): { fetch?: typeof fetch } {
  return testFetch ? { fetch: testFetch } : {};
}

/** The engine of the configured endpoint, or null without AI or without a detected engine. */
export async function localFilingEngine(root = pinarHome()): Promise<FilingEngineChoice | null> {
  const endpoint = await localAssistantEndpoint({ root, ...fetchOption() });
  if (!endpoint) return null;
  const capabilities = await detectRetrievalCapabilities({ endpoint, ...fetchOption() });
  if (capabilities.decisions) return { endpoint, kind: "decisions" };
  if (!capabilities.embeddingModel) return null;
  return {
    embedding: {
      ...(endpoint.apiKey ? { apiKey: endpoint.apiKey } : {}),
      baseUrl: endpoint.baseUrl,
      model: capabilities.embeddingModel,
    },
    kind: "similarity",
  };
}

/**
 * GET and PATCH /api/preferences: the AI is configured and an engine is
 * detected. The answer waits at most FILING_TIMEOUT_MS; a detection still
 * running then answers false, and its result reaches the cache for the next
 * read.
 */
export async function localAutoCaptureDestinationAvailable(root = pinarHome()): Promise<boolean> {
  if (!localAiConfigured(root)) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FILING_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([localFilingEngine(root).catch(() => null), late])) !== null;
  } finally {
    clearTimeout(timer);
  }
}

// One macrotask, so a deadline timer can fire between synchronous pages.
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function localFilingSource(db: LocalFilingDatabase): FilingSource {
  return {
    async batchSession(batchId, excludeId) {
      // Newest first; two rows cover the capture's own row.
      const session = db.listSessions({ batchId, limit: 2, offset: 0, query: "" }).find((item) => item.id !== excludeId);
      return session?.collectionId ? { collectionId: session.collectionId, filedBy: session.filedBy === "auto" ? "auto" : null } : null;
    },
    async collections() {
      return db.listProjects().flatMap((project) =>
        db
          .listCollections(project.id)
          .filter((collection) => !collection.isProtected)
          .map((collection) => ({ collectionId: collection.id, collectionName: collection.name, projectName: project.name })),
      );
    },
    async entriesFor(sessionIds) {
      return db.listPinIndexEntriesFor(sessionIds);
    },
    async recentSessions({ collectionIds, excludeId, expired, perCollection }) {
      const counts = new Map(collectionIds.map((id) => [id, 0]));
      let open = counts.size;
      const sessions: FilingRecentSession[] = [];
      for (let offset = 0; open > 0; offset += SCAN_PAGE_SIZE) {
        if (expired()) throw new Error("filing scan expired");
        const page = db.listSessions({ limit: SCAN_PAGE_SIZE, offset, query: "" });
        for (const session of page) {
          const collectionId = session.collectionId;
          const count = collectionId ? counts.get(collectionId) : undefined;
          if (!collectionId || count === undefined || count >= perCollection || session.id === excludeId) continue;
          counts.set(collectionId, count + 1);
          if (count + 1 === perCollection) open -= 1;
          sessions.push({ collectionId, createdAt: session.createdAt, id: session.id, title: session.page.title ?? "" });
        }
        if (page.length < SCAN_PAGE_SIZE) break;
        await nextTurn();
      }
      return sessions;
    },
  };
}

/** Files a new local capture; the caller checked the preference and localAiConfigured. */
export function fileLocalCapture(input: {
  batchId: string | null;
  capture: FilingCapture;
  db: LocalFilingDatabase;
  root?: string;
}): Promise<FilingOutcome> {
  const root = input.root ?? pinarHome();
  return fileCapture({
    batchId: input.batchId,
    capture: input.capture,
    engine: () => localFilingEngine(root),
    ...fetchOption(),
    source: localFilingSource(input.db),
  });
}
