export interface PinIndexEntry {
  caption: string | null; docHash: string; docText: string; model: string; number: number;
  ocr: string | null; pinId: string; sessionId: string; truncated: boolean; updatedAt: string;
  vector: Uint8Array | null; // null when there is no embedding model (text-only entry)
}

export interface PinIndexStore {
  entries(sessionId: string): Promise<PinIndexEntry[]>;
  /**
   * Replaces every entry of the session in one atomic write (pins removed from the session disappear).
   * `readMark` is what `readMark` returned before the indexing read the session: a store with edit
   * marks clears the session's mark only while it is still that one.
   */
  replaceSession(sessionId: string, entries: PinIndexEntry[], options?: { readMark: string | null }): Promise<void>;
  /** Optional: the session's current edit mark (null when unmarked), for stores whose writes mark sessions dirty. */
  readMark?(sessionId: string): Promise<string | null>;
  deleteSession(sessionId: string): Promise<void>;
  /** Entries of the given sessions, for search. */
  entriesFor(sessionIds: string[]): Promise<PinIndexEntry[]>;
  /** Sessions with no entry yet, or whose `updatedAt` is newer than their entries. */
  staleSessions(input: { limit: number; sessions: Array<{ id: string; updatedAt: string }> }): Promise<string[]>;
}
