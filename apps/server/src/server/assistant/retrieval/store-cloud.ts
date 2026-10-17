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

/** Rejects the whole replacement before any write: an entry of another session or a vector that is not bytes. */
function checkEntries(sessionId: string, entries: PinIndexEntry[]) {
  for (const entry of entries) {
    if (entry.sessionId !== sessionId) throw new Error("pin index entry belongs to another session");
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
 * yet, or when its `updatedAt` is newer than its oldest entry's.
 */
function staleIds(sessions: Array<{ id: string; updatedAt: string }>, indexedAt: Map<string, string>, limit: number) {
  const stale: string[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    if (stale.length >= limit) break;
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    const oldest = indexedAt.get(session.id);
    if (oldest === undefined || session.updatedAt > oldest) stale.push(session.id);
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

export function resetCloudPinIndexMemoryForTests() {
  memoryPinIndex.clear();
}

/** In-memory branch of the session delete and the retention cleanup: the session is gone, so are its entries. */
export function deleteMemoryPinIndexForSession(sessionId: string) {
  memoryPinIndex.delete(sessionId);
}

// The epoch: older than any time a pin source lists.
const PIN_INDEX_STALE_AT = new Date(0).toISOString();

/**
 * After a write that changes what a pin document holds, stamps every entry
 * of the session (whoever owns it) with the epoch, so the session is stale
 * for the next pass (a search or the cron) while indexSession still reuses
 * the captions and vectors of the pins that did not change. Best effort: a
 * failure (the pin_index table missing before migration 0029, for example)
 * is swallowed and not logged, since the write itself already succeeded.
 */
export async function markCloudPinIndexSessionStale(env: { DB?: AssistantD1Database }, sessionId: string): Promise<void> {
  try {
    if (env.DB) {
      await env.DB.prepare("UPDATE pin_index SET updated_at = ? WHERE session_id = ?").bind(PIN_INDEX_STALE_AT, sessionId).run();
      return;
    }
    for (const entry of memoryPinIndex.get(sessionId)?.entries ?? []) entry.updatedAt = PIN_INDEX_STALE_AT;
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
        .prepare(`SELECT ${PIN_INDEX_COLUMNS} FROM pin_index WHERE session_id = ? AND owner_id = ?`)
        .bind(sessionId, ownerId)
        .all();
      return orderEntries((result.results || []).map(entryFromRow), [sessionId]);
    },
    async entriesFor(sessionIds) {
      const ids = [...new Set(sessionIds)];
      const entries: PinIndexEntry[] = [];
      for (const chunk of chunked(ids, D1_IN_CHUNK)) {
        const placeholders = chunk.map(() => "?").join(", ");
        const result = await db
          .prepare(`SELECT ${PIN_INDEX_COLUMNS} FROM pin_index WHERE owner_id = ? AND session_id IN (${placeholders})`)
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
     * session can still land.
     */
    async replaceSession(sessionId, entries) {
      checkEntries(sessionId, entries);
      const foreign = await db
        .prepare("SELECT owner_id FROM pin_index WHERE session_id = ? AND owner_id <> ? LIMIT 1")
        .bind(sessionId, ownerId)
        .first();
      if (foreign) throw new Error("pin index session belongs to another owner");
      await db.batch([
        db.prepare("DELETE FROM pin_index WHERE session_id = ? AND owner_id = ?").bind(sessionId, ownerId),
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
      for (const chunk of chunked([...new Set(sessions.map((session) => session.id))], D1_IN_CHUNK)) {
        const placeholders = chunk.map(() => "?").join(", ");
        const result = await db
          .prepare(
            `SELECT session_id, MIN(updated_at) AS updated_at FROM pin_index WHERE owner_id = ? AND session_id IN (${placeholders}) GROUP BY session_id`,
          )
          .bind(ownerId, ...chunk)
          .all();
        for (const row of result.results || []) indexedAt.set(String(row.session_id), String(row.updated_at));
      }
      return staleIds(sessions, indexedAt, limit);
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
      if (ownedMemorySession(sessionId, ownerId)) memoryPinIndex.delete(sessionId);
    },
    async entries(sessionId) {
      const session = ownedMemorySession(sessionId, ownerId);
      return session ? orderEntries(session.entries.map(copyEntry), [sessionId]) : [];
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
    async replaceSession(sessionId, entries) {
      checkEntries(sessionId, entries);
      const pinIds = new Set<string>();
      for (const entry of entries) {
        if (pinIds.has(entry.pinId)) throw new Error("duplicate pin index entry");
        pinIds.add(entry.pinId);
      }
      const current = memoryPinIndex.get(sessionId);
      if (current && current.ownerId !== ownerId) throw new Error("pin index session belongs to another owner");
      if (entries.length === 0) memoryPinIndex.delete(sessionId);
      else memoryPinIndex.set(sessionId, { entries: entries.map(copyEntry), ownerId });
    },
    async staleSessions(input) {
      const { limit, sessions } = input;
      if (!(limit > 0) || sessions.length === 0) return [];
      const indexedAt = new Map<string, string>();
      for (const { id } of sessions) {
        const session = ownedMemorySession(id, ownerId);
        if (!session || session.entries.length === 0) continue;
        indexedAt.set(id, session.entries.reduce((oldest, entry) => (entry.updatedAt < oldest ? entry.updatedAt : oldest), session.entries[0].updatedAt));
      }
      return staleIds(sessions, indexedAt, limit);
    },
  };
}
