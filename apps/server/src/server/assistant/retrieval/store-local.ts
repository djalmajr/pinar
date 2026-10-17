import type { PinIndexEntry, PinIndexStore } from "./types";

/**
 * Structural shape of the synchronous pin index methods on `apps/cli/src/history.mjs`
 * (`SqliteHistoryDb` and `JsonHistoryDb`). Both return and accept the camelCase
 * `PinIndexEntry` objects from `types.ts`.
 */
export interface LocalPinIndexDatabase {
  deletePinIndexSession(sessionId: string): void;
  listPinIndexEntries(sessionId: string): PinIndexEntry[];
  listPinIndexEntriesFor(sessionIds: string[]): PinIndexEntry[];
  replacePinIndexSession(sessionId: string, entries: PinIndexEntry[]): void;
  stalePinIndexSessions(input: { limit: number; sessions: Array<{ id: string; updatedAt: string }> }): string[];
}

/** Adapts the synchronous local history db to the `PinIndexStore` promise interface. */
export function localPinIndexStore(db: LocalPinIndexDatabase): PinIndexStore {
  return {
    async deleteSession(sessionId) {
      db.deletePinIndexSession(sessionId);
    },
    async entries(sessionId) {
      return db.listPinIndexEntries(sessionId);
    },
    async entriesFor(sessionIds) {
      return db.listPinIndexEntriesFor(sessionIds);
    },
    async replaceSession(sessionId, entries) {
      db.replacePinIndexSession(sessionId, entries);
    },
    async staleSessions(input) {
      return db.stalePinIndexSessions(input);
    },
  };
}
