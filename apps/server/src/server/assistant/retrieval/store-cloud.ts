import type { AssistantD1Database } from "../store-cloud";
import type { PinIndexEntry, PinIndexStore } from "./types";

// D1 caps one query at 100 bound parameters; the IN lists (plus the owner)
// are cut below it.
const D1_IN_CHUNK = 90;

const PIN_INDEX_COLUMNS = "session_id, pin_id, number, model, vector, doc_text, doc_hash, truncated, caption, ocr, updated_at";

/**
 * D1 returns a BLOB as an array of bytes (`Array.from` of the buffer);
 * libSQL (`edger/libsql-d1.ts`) and bun:sqlite return a Uint8Array.
 */
function vectorFromColumn(value: unknown): Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error("pin index vector has an unexpected shape");
}

function entryFromRow(row: Record<string, unknown>): PinIndexEntry {
  return {
    caption: row.caption === null || row.caption === undefined ? null : String(row.caption),
    docHash: String(row.doc_hash),
    docText: String(row.doc_text),
    model: String(row.model),
    number: Number(row.number),
    ocr: row.ocr === null || row.ocr === undefined ? null : String(row.ocr),
    pinId: String(row.pin_id),
    sessionId: String(row.session_id),
    truncated: Boolean(Number(row.truncated)),
    updatedAt: String(row.updated_at),
    vector: vectorFromColumn(row.vector),
  };
}

function copyEntry(entry: PinIndexEntry): PinIndexEntry {
  return { ...entry, vector: entry.vector === null ? null : new Uint8Array(entry.vector) };
}

/** Rejects the whole replacement before any write: an entry of another session, without a pin id, or a vector that is not bytes. */
function checkEntries(sessionId: string, entries: PinIndexEntry[]) {
  for (const entry of entries) {
    if (entry.sessionId !== sessionId) throw new Error("pin index entry belongs to another session");
    if (entry.pinId === DIRTY_PIN_ID) throw new Error("pin index entry has no pin id");
    if (entry.vector !== null && !(entry.vector instanceof Uint8Array)) {
      throw new Error("pin index vector must be a Uint8Array or null");
    }
  }
}

/** Requested session order first, then pin number, then pin id by code unit. */
function orderEntries(entries: PinIndexEntry[], sessionIds: string[]): PinIndexEntry[] {
  const position = new Map(sessionIds.map((id, index) => [id, index]));
  return entries.sort((left, right) =>
    (position.get(left.sessionId) ?? 0) - (position.get(right.sessionId) ?? 0)
    || left.number - right.number
    || (left.pinId < right.pinId ? -1 : left.pinId > right.pinId ? 1 : 0));
}

/**
 * Input order, each id once, up to `limit`: a session is stale with no entry
 * yet, when it carries a dirty mark, or when its `updatedAt` is newer than
 * its oldest entry's.
 */
function staleIds(
  sessions: Array<{ id: string; updatedAt: string }>,
  indexedAt: Map<string, string>,
  limit: number,
  dirty: Set<string>,
) {
  const stale: string[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    if (stale.length >= limit) break;
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    const oldest = indexedAt.get(session.id);
    if (oldest === undefined || dirty.has(session.id) || session.updatedAt > oldest) stale.push(session.id);
  }
  return stale;
}

function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

/** Every entry of a session shares one owner: `replaceSession` refuses a session held by another. */
interface MemoryPinIndexSession {
  entries: PinIndexEntry[];
  ownerId: string;
}

const memoryPinIndex = new Map<string, MemoryPinIndexSession>();
// sessionId → dirty-mark token of the in-memory branch
const memoryDirtyMarks = new Map<string, string>();

export function resetCloudPinIndexMemoryForTests() {
  memoryPinIndex.clear();
  memoryDirtyMarks.clear();
}

/** In-memory branch of the session delete and the retention cleanup: the session is gone, so are its entries. */
export function deleteMemoryPinIndexForSession(sessionId: string) {
  memoryPinIndex.delete(sessionId);
  memoryDirtyMarks.delete(sessionId);
}

// The dirty mark (decision A26) is one extra row of the session under the
// empty pin id, which no indexed pin has (the sources leave pins without
// an id out, and checkEntries refuses one): its doc_hash holds a fresh
// token per mark. A session with the row is stale whatever the times say.
// indexSession reads the token (readMark) before it reads the session, and
// replaceSession removes the row only while it still holds that token, so
// a write that marks the session during an indexing keeps it stale for the
// next pass. Entry reads never return the row.
const DIRTY_PIN_ID = "";
const DIRTY_AT = new Date(0).toISOString();

/**
 * After a write that changes what a pin document holds, marks the session
 * (whoever owns it) dirty, so it is stale for the next pass (a search or
 * the cron) while indexSession still reuses the captions and vectors of
 * the pins that did not change. A session not indexed yet needs no mark.
 * Best effort: a failure (the pin_index table missing before migration
 * 0029, for example) is swallowed and not logged, since the write itself
 * already succeeded.
 */
export async function markCloudPinIndexSessionStale(env: { DB?: AssistantD1Database }, sessionId: string): Promise<void> {
  try {
    const token = crypto.randomUUID();
    if (env.DB) {
      await env.DB.prepare(
        `INSERT INTO pin_index (session_id, pin_id, owner_id, number, model, vector, doc_text, doc_hash, truncated, caption, ocr, updated_at)
         SELECT session_id, ?, owner_id, 0, '', NULL, '', ?, 0, NULL, NULL, ? FROM pin_index
         WHERE session_id = ? AND pin_id <> ? LIMIT 1
         ON CONFLICT(session_id, pin_id) DO UPDATE SET doc_hash = excluded.doc_hash, updated_at = excluded.updated_at`,
      ).bind(DIRTY_PIN_ID, token, DIRTY_AT, sessionId, DIRTY_PIN_ID).run();
      return;
    }
    if (memoryPinIndex.has(sessionId)) memoryDirtyMarks.set(sessionId, token);
  } catch {
    // Best effort: the next write marks the session again.
  }
}

/**
 * Cloud `PinIndexStore`: every query is filtered by `owner_id`, so entries
 * of another account behave as if they did not exist, and `entriesFor`
 * never widens the requested ids. With `env.DB` missing, a per-module
 * in-memory branch stands in for the table.
 */
export function cloudPinIndexStore(env: { DB?: AssistantD1Database }, ownerId: string): PinIndexStore {
  if (env.DB) return cloudDbPinIndexStore(env.DB, ownerId);
  return cloudMemoryPinIndexStore(ownerId);
}

function cloudDbPinIndexStore(db: AssistantD1Database, ownerId: string): PinIndexStore {
  return {
    async deleteSession(sessionId) {
      await db.prepare("DELETE FROM pin_index WHERE session_id = ? AND owner_id = ?").bind(sessionId, ownerId).run();
    },
    async entries(sessionId) {
      const result = await db
        .prepare(`SELECT ${PIN_INDEX_COLUMNS} FROM pin_index WHERE session_id = ? AND owner_id = ? AND pin_id <> ?`)
        .bind(sessionId, ownerId, DIRTY_PIN_ID)
        .all();
      return orderEntries((result.results || []).map(entryFromRow), [sessionId]);
    },
    async readMark(sessionId) {
      const row = await db
        .prepare("SELECT doc_hash FROM pin_index WHERE session_id = ? AND owner_id = ? AND pin_id = ?")
        .bind(sessionId, ownerId, DIRTY_PIN_ID)
        .first();
      return row ? String(row.doc_hash) : null;
    },
    async entriesFor(sessionIds) {
      const ids = [...new Set(sessionIds)];
      const entries: PinIndexEntry[] = [];
      for (const chunk of chunked(ids, D1_IN_CHUNK)) {
        const placeholders = chunk.map(() => "?").join(", ");
        const result = await db
          .prepare(`SELECT ${PIN_INDEX_COLUMNS} FROM pin_index WHERE owner_id = ? AND session_id IN (${placeholders}) AND pin_id <> ''`)
          .bind(ownerId, ...chunk)
          .all();
        entries.push(...(result.results || []).map(entryFromRow));
      }
      return orderEntries(entries, ids);
    },
    /**
     * The DELETE and the INSERTs run in one `db.batch`, so a failing INSERT
     * (a duplicate pin id hits the primary key) rolls the DELETE back. The
     * read before it refuses a session another owner already holds; between
     * that read and the batch, the primary key still refuses another
     * owner's row for the same pin, while one for a different pin of the
     * session can still land. The dirty mark goes with an empty
     * replacement, or when it still holds the `readMark` the indexing read
     * first; a mark that arrived since then, or any mark when no `readMark`
     * is given, stays.
     */
    async replaceSession(sessionId, entries, options) {
      checkEntries(sessionId, entries);
      const seen = options?.readMark;
      const foreign = await db
        .prepare("SELECT owner_id FROM pin_index WHERE session_id = ? AND owner_id <> ? LIMIT 1")
        .bind(sessionId, ownerId)
        .first();
      if (foreign) throw new Error("pin index session belongs to another owner");
      const clearMark = entries.length === 0
        // nothing left to index: the session needs no mark either
        ? [db.prepare("DELETE FROM pin_index WHERE session_id = ? AND owner_id = ? AND pin_id = ?").bind(sessionId, ownerId, DIRTY_PIN_ID)]
        : typeof seen === "string"
          ? [db.prepare("DELETE FROM pin_index WHERE session_id = ? AND owner_id = ? AND pin_id = ? AND doc_hash = ?").bind(sessionId, ownerId, DIRTY_PIN_ID, seen)]
          : [];
      await db.batch([
        db.prepare("DELETE FROM pin_index WHERE session_id = ? AND owner_id = ? AND pin_id <> ?").bind(sessionId, ownerId, DIRTY_PIN_ID),
        ...clearMark,
        ...entries.map((entry) =>
          db.prepare(
            "INSERT INTO pin_index (session_id, pin_id, owner_id, number, model, vector, doc_text, doc_hash, truncated, caption, ocr, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).bind(
            sessionId,
            entry.pinId,
            ownerId,
            entry.number,
            entry.model,
            entry.vector,
            entry.docText,
            entry.docHash,
            entry.truncated ? 1 : 0,
            entry.caption,
            entry.ocr,
            entry.updatedAt,
          )
        ),
      ]);
    },
    async staleSessions(input) {
      const { limit, sessions } = input;
      if (!(limit > 0) || sessions.length === 0) return [];
      const indexedAt = new Map<string, string>();
      const dirty = new Set<string>();
      for (const chunk of chunked([...new Set(sessions.map((session) => session.id))], D1_IN_CHUNK)) {
        const placeholders = chunk.map(() => "?").join(", ");
        const result = await db
          .prepare(
            `SELECT session_id, MIN(updated_at) AS updated_at, MAX(pin_id = '') AS dirty FROM pin_index WHERE owner_id = ? AND session_id IN (${placeholders}) GROUP BY session_id`,
          )
          .bind(ownerId, ...chunk)
          .all();
        for (const row of result.results || []) {
          indexedAt.set(String(row.session_id), String(row.updated_at));
          if (Number(row.dirty) === 1) dirty.add(String(row.session_id));
        }
      }
      return staleIds(sessions, indexedAt, limit, dirty);
    },
  };
}

function ownedMemorySession(sessionId: string, ownerId: string): MemoryPinIndexSession | null {
  const session = memoryPinIndex.get(sessionId);
  return session && session.ownerId === ownerId ? session : null;
}

function cloudMemoryPinIndexStore(ownerId: string): PinIndexStore {
  return {
    async deleteSession(sessionId) {
      if (ownedMemorySession(sessionId, ownerId)) {
        memoryPinIndex.delete(sessionId);
        memoryDirtyMarks.delete(sessionId);
      }
    },
    async entries(sessionId) {
      const session = ownedMemorySession(sessionId, ownerId);
      return session ? orderEntries(session.entries.map(copyEntry), [sessionId]) : [];
    },
    async readMark(sessionId) {
      return ownedMemorySession(sessionId, ownerId) ? memoryDirtyMarks.get(sessionId) ?? null : null;
    },
    async entriesFor(sessionIds) {
      const ids = [...new Set(sessionIds)];
      return orderEntries(
        ids.flatMap((id) => ownedMemorySession(id, ownerId)?.entries.map(copyEntry) ?? []),
        ids,
      );
    },
    // Checked in full, then swapped in one synchronous step, mirroring the
    // D1 batch and its primary key.
    async replaceSession(sessionId, entries, options) {
      checkEntries(sessionId, entries);
      const pinIds = new Set<string>();
      for (const entry of entries) {
        if (pinIds.has(entry.pinId)) throw new Error("duplicate pin index entry");
        pinIds.add(entry.pinId);
      }
      const current = memoryPinIndex.get(sessionId);
      if (current && current.ownerId !== ownerId) throw new Error("pin index session belongs to another owner");
      const seen = options?.readMark;
      if (entries.length === 0 || (typeof seen === "string" && memoryDirtyMarks.get(sessionId) === seen)) {
        memoryDirtyMarks.delete(sessionId);
      }
      if (entries.length === 0) memoryPinIndex.delete(sessionId);
      else memoryPinIndex.set(sessionId, { entries: entries.map(copyEntry), ownerId });
    },
    async staleSessions(input) {
      const { limit, sessions } = input;
      if (!(limit > 0) || sessions.length === 0) return [];
      const indexedAt = new Map<string, string>();
      const dirty = new Set<string>();
      for (const { id } of sessions) {
        const session = ownedMemorySession(id, ownerId);
        if (!session || session.entries.length === 0) continue;
        indexedAt.set(id, session.entries.reduce((oldest, entry) => (entry.updatedAt < oldest ? entry.updatedAt : oldest), session.entries[0].updatedAt));
        if (memoryDirtyMarks.has(id)) dirty.add(id);
      }
      return staleIds(sessions, indexedAt, limit, dirty);
    },
  };
}
