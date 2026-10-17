// Local-app AssistantStateReader over the history database (contract 1.1).
//
// The reads are the ones the local MCP handlers already make (local-mcp.ts),
// so a proposal sees exactly what the tools will act on: collections are
// found across the projects the way findCollection does, a collection's
// sessions come from listSessions in position order (the same call
// pinar.reorder_sessions checks against), and a pin is matched by
// `pinId || id` as get_pin does. The local app has no share links, so
// share() is always null.

import type { AssistantStateReader } from "./state-reader";

interface LocalStateBatch {
  finishedAt: string | null;
  id: string;
  label: string;
  sessionCount: number;
}

interface LocalStateSession {
  batchId?: string | null;
  // Optional in the shared Session type; the history db always fills it.
  collectionId?: string;
  id: string;
  page: { title: string };
  pinCount?: number;
  pins: Array<{ comment?: string; id?: string; number: number; pinId?: string }>;
}

/** Structural shape of the history db reads the reader uses (`apps/cli/src/history.mjs`). */
export interface LocalAssistantStateDatabase {
  getSession(id: string): LocalStateSession | null;
  listBatches(): LocalStateBatch[];
  listCollections(projectId: string): Array<{ id: string; name: string; parentId: string | null; projectId: string }>;
  listPinComments(captureId: string): Array<{ body: string; id: string; pinId: string }>;
  listProjects(): Array<{ id: string; name: string }>;
  listSessions(options: { batchId?: string; collectionId?: string; limit: number; offset: number; query: string }): Array<{ id: string }>;
}

export function localAssistantStateReader(db: LocalAssistantStateDatabase): AssistantStateReader {
  const findCollection = (collectionId: string) => {
    for (const project of db.listProjects()) {
      const collection = db.listCollections(project.id).find((item) => item.id === collectionId);
      if (collection) return collection;
    }
    return null;
  };
  const collectionSessionIds = (collectionId: string) =>
    db.listSessions({ batchId: "", collectionId, limit: Number.MAX_SAFE_INTEGER, offset: 0, query: "" }).map((session) => session.id);
  const findPin = (sessionId: string, pinId: string) => {
    const session = db.getSession(sessionId);
    return session?.pins.find((pin) => (pin.pinId || pin.id) === pinId) ?? null;
  };
  return {
    async batch(id) {
      const batch = db.listBatches().find((item) => item.id === id);
      return batch ? { finishedAt: batch.finishedAt ?? null, id: batch.id, label: batch.label, sessionCount: batch.sessionCount } : null;
    },
    async collection(id) {
      const collection = findCollection(id);
      if (!collection) return null;
      return {
        id: collection.id,
        name: collection.name,
        parentId: collection.parentId ?? null,
        projectId: collection.projectId,
        sessionCount: collectionSessionIds(collection.id).length,
      };
    },
    // listCollections returns the hierarchy parents-first with siblings in
    // position order; given back to reorder_collections as `items`, the
    // same list rebuilds the same parents and positions.
    async collectionPlacements(projectId) {
      if (!db.listProjects().some((project) => project.id === projectId)) return null;
      return db.listCollections(projectId).map((collection) => ({ id: collection.id, parentId: collection.parentId ?? null }));
    },
    async comment(sessionId, pinId, commentId) {
      if (!findPin(sessionId, pinId)) return null;
      const comment = db.listPinComments(sessionId).find((item) => item.pinId === pinId && item.id === commentId);
      return comment ? { body: comment.body, id: comment.id } : null;
    },
    async pin(sessionId, pinId) {
      const pin = findPin(sessionId, pinId);
      if (!pin) return null;
      const commentCount = db.listPinComments(sessionId).filter((comment) => comment.pinId === pinId).length;
      return { comment: pin.comment || "", commentCount, id: pinId, number: pin.number };
    },
    async project(id) {
      const project = db.listProjects().find((item) => item.id === id);
      return project ? { collectionCount: db.listCollections(project.id).length, id: project.id, name: project.name } : null;
    },
    async projectOrder() {
      return db.listProjects().map((project) => project.id);
    },
    async session(id) {
      const session = db.getSession(id);
      if (!session) return null;
      return {
        batchId: session.batchId ?? null,
        collectionId: session.collectionId ?? "",
        id: session.id,
        pinCount: session.pinCount ?? session.pins.length,
        title: session.page.title,
      };
    },
    async sessionOrder(collectionId) {
      return findCollection(collectionId) ? collectionSessionIds(collectionId) : null;
    },
    async share() {
      return null;
    },
  };
}
