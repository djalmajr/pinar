import type {
  AssistantMessage,
  AssistantMessageStatus,
  AssistantRole,
  AssistantStore,
  AssistantThread,
} from "./store";

/** Structural D1/libSQL statement shape, as used by `cloud-api.ts`. */
interface D1Result {
  meta?: { changes?: number };
  results?: Record<string, unknown>[];
}

export interface AssistantD1Statement {
  all(): Promise<D1Result>;
  bind(...values: unknown[]): AssistantD1Statement;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<D1Result>;
}

export interface AssistantD1Database {
  batch(statements: AssistantD1Statement[]): Promise<unknown>;
  prepare(query: string): AssistantD1Statement;
}

function threadFromRow(row: Record<string, unknown>): AssistantThread {
  return {
    createdAt: String(row.created_at),
    id: String(row.id),
    title: String(row.title),
    updatedAt: String(row.updated_at),
  };
}

function messageFromRow(row: Record<string, unknown>): AssistantMessage {
  return {
    createdAt: String(row.created_at),
    errorCode: row.error_code === null || row.error_code === undefined ? null : String(row.error_code),
    id: String(row.id),
    role: row.role === "assistant" ? "assistant" : "user",
    status: row.status === "error" ? "error" : "final",
    text: String(row.text),
    threadId: String(row.thread_id),
  };
}

interface MemoryAssistantThread {
  createdAt: string;
  id: string;
  ownerId: string;
  title: string;
  updatedAt: string;
}

interface MemoryAssistantMessage {
  createdAt: string;
  errorCode: string | null;
  id: string;
  ownerId: string;
  role: AssistantRole;
  sequence: number;
  status: AssistantMessageStatus;
  text: string;
  threadId: string;
}

const memoryAssistantThreads = new Map<string, MemoryAssistantThread>();
const memoryAssistantMessages = new Map<string, MemoryAssistantMessage>();
let memoryAssistantMessageSequence = 0;

export function resetCloudAssistantMemoryForTests() {
  memoryAssistantThreads.clear();
  memoryAssistantMessages.clear();
  memoryAssistantMessageSequence = 0;
}

/**
 * Cloud `AssistantStore`: every query is filtered by `owner_id`, so a thread
 * owned by another account behaves as if it did not exist. With `env.DB`
 * missing, a per-module in-memory branch stands in for the tables.
 */
export function cloudAssistantStore(env: { DB?: AssistantD1Database }, ownerId: string): AssistantStore {
  if (env.DB) return cloudDbAssistantStore(env.DB, ownerId);
  return cloudMemoryAssistantStore(ownerId);
}

function cloudDbAssistantStore(db: AssistantD1Database, ownerId: string): AssistantStore {
  return {
    async appendMessage(message) {
      const thread = await db
        .prepare("SELECT id FROM assistant_threads WHERE id = ? AND owner_id = ?")
        .bind(message.threadId, ownerId)
        .first();
      if (!thread) throw new Error("assistant thread not found");
      await db.batch([
        db.prepare(
          "INSERT INTO assistant_messages (id, thread_id, owner_id, role, text, status, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(message.id, message.threadId, ownerId, message.role, message.text, message.status, message.errorCode, message.createdAt),
        db.prepare("UPDATE assistant_threads SET updated_at = ? WHERE id = ? AND owner_id = ?")
          .bind(message.createdAt, message.threadId, ownerId),
      ]);
    },
    async createThread(input) {
      await db
        .prepare("INSERT INTO assistant_threads (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(input.id, ownerId, input.title, input.now, input.now)
        .run();
      return { createdAt: input.now, id: input.id, title: input.title, updatedAt: input.now };
    },
    async deleteThread(id) {
      const results = (await db.batch([
        db.prepare("DELETE FROM assistant_messages WHERE thread_id = ? AND owner_id = ?").bind(id, ownerId),
        db.prepare("DELETE FROM assistant_threads WHERE id = ? AND owner_id = ?").bind(id, ownerId),
      ])) as { meta?: { changes?: number } }[];
      return Number(results[1]?.meta?.changes ?? 0) > 0;
    },
    async getThread(id) {
      const row = await db
        .prepare("SELECT id, title, created_at, updated_at FROM assistant_threads WHERE id = ? AND owner_id = ?")
        .bind(id, ownerId)
        .first();
      return row ? threadFromRow(row) : null;
    },
    async listMessages(threadId, input) {
      // rowid breaks timestamp ties by insertion order; reversing restores chronology.
      const result = await db
        .prepare(
          "SELECT id, thread_id, role, text, status, error_code, created_at FROM assistant_messages WHERE thread_id = ? AND owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
        )
        .bind(threadId, ownerId, input.limit)
        .all();
      return (result.results || []).map(messageFromRow).reverse();
    },
    async listThreads(input) {
      const result = await db
        .prepare(
          "SELECT id, title, created_at, updated_at FROM assistant_threads WHERE owner_id = ? ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?",
        )
        .bind(ownerId, input.limit, input.offset)
        .all();
      return (result.results || []).map(threadFromRow);
    },
  };
}

function memoryOwner(id: string, ownerId: string): MemoryAssistantThread | null {
  const thread = memoryAssistantThreads.get(id);
  return thread && thread.ownerId === ownerId ? thread : null;
}

function cloudMemoryAssistantStore(ownerId: string): AssistantStore {
  return {
    async appendMessage(message) {
      const thread = memoryOwner(message.threadId, ownerId);
      if (!thread) throw new Error("assistant thread not found");
      memoryAssistantMessages.set(message.id, {
        createdAt: message.createdAt,
        errorCode: message.errorCode,
        id: message.id,
        ownerId,
        role: message.role,
        sequence: ++memoryAssistantMessageSequence,
        status: message.status,
        text: message.text,
        threadId: message.threadId,
      });
      thread.updatedAt = message.createdAt;
    },
    async createThread(input) {
      memoryAssistantThreads.set(input.id, {
        createdAt: input.now,
        id: input.id,
        ownerId,
        title: input.title,
        updatedAt: input.now,
      });
      return { createdAt: input.now, id: input.id, title: input.title, updatedAt: input.now };
    },
    async deleteThread(id) {
      const thread = memoryOwner(id, ownerId);
      if (!thread) return false;
      for (const [messageId, message] of memoryAssistantMessages) {
        if (message.threadId === id && message.ownerId === ownerId) memoryAssistantMessages.delete(messageId);
      }
      memoryAssistantThreads.delete(id);
      return true;
    },
    async getThread(id) {
      const thread = memoryOwner(id, ownerId);
      return thread
        ? { createdAt: thread.createdAt, id: thread.id, title: thread.title, updatedAt: thread.updatedAt }
        : null;
    },
    async listMessages(threadId, input) {
      // The insertion sequence breaks equal timestamps and must be applied
      // before the limit cut, so the newest of a tied group survives; the
      // reverse then restores chronological order.
      return Array.from(memoryAssistantMessages.values())
        .filter((message) => message.threadId === threadId && message.ownerId === ownerId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.sequence - left.sequence)
        .slice(0, input.limit)
        .reverse()
        .map((message) => ({
          createdAt: message.createdAt,
          errorCode: message.errorCode,
          id: message.id,
          role: message.role,
          status: message.status,
          text: message.text,
          threadId: message.threadId,
        }));
    },
    async listThreads(input) {
      return Array.from(memoryAssistantThreads.values())
        .filter((thread) => thread.ownerId === ownerId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
        .slice(input.offset, input.offset + input.limit)
        .map((thread) => ({
          createdAt: thread.createdAt,
          id: thread.id,
          title: thread.title,
          updatedAt: thread.updatedAt,
        }));
    },
  };
}

/**
 * Deletes every thread (all owners) whose `updated_at` is before `cutoffIso`
 * plus its messages. With `env.DB` the two DELETEs run in a single
 * `db.batch`, so a failure (or a concurrent append) in between cannot leave
 * a surviving thread with its history already gone: the batch either
 * deletes both or nothing. The in-memory branch keeps the same
 * thread-then-messages order inside one synchronous step.
 */
export async function cleanupAssistantThreads(env: { DB?: AssistantD1Database }, cutoffIso: string): Promise<number> {
  if (env.DB) {
    const results = await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM assistant_messages WHERE thread_id IN (SELECT id FROM assistant_threads WHERE updated_at < ?)",
      ).bind(cutoffIso),
      env.DB.prepare("DELETE FROM assistant_threads WHERE updated_at < ?").bind(cutoffIso),
    ]) as { meta?: { changes?: number } }[];
    return Number(results[1]?.meta?.changes || 0);
  }
  let deleted = 0;
  for (const [id, thread] of memoryAssistantThreads) {
    if (thread.updatedAt < cutoffIso) {
      memoryAssistantThreads.delete(id);
      deleted += 1;
    }
  }
  for (const [messageId, message] of memoryAssistantMessages) {
    if (!memoryAssistantThreads.has(message.threadId)) memoryAssistantMessages.delete(messageId);
  }
  return deleted;
}
