import {
  AssistantWriteFencedError,
  type AssistantMessage,
  type AssistantMessageStatus,
  type AssistantProposalErrorCode,
  type AssistantProposalRecord,
  type AssistantProposalRisk,
  type AssistantProposalStatus,
  type AssistantRole,
  type AssistantStore,
  type AssistantThread,
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
    ask: row.ask_json === null || row.ask_json === undefined ? null : (JSON.parse(String(row.ask_json)) as { options: string[]; question: string }),
    createdAt: String(row.created_at),
    errorCode: row.error_code === null || row.error_code === undefined ? null : String(row.error_code),
    id: String(row.id),
    role: row.role === "assistant" ? "assistant" : "user",
    status: row.status === "error" ? "error" : "final",
    text: String(row.text),
    threadId: String(row.thread_id),
  };
}

function proposalFromRow(row: Record<string, unknown>): AssistantProposalRecord {
  return {
    args: JSON.parse(String(row.args_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
    display: JSON.parse(String(row.display_json)) as AssistantProposalRecord["display"],
    errorCode: row.error_code === null || row.error_code === undefined ? null : (String(row.error_code) as AssistantProposalErrorCode),
    executedAt: row.executed_at === null || row.executed_at === undefined ? null : String(row.executed_at),
    expiresAt: String(row.expires_at),
    fingerprint: String(row.fingerprint),
    id: String(row.id),
    messageId: String(row.message_id),
    result: row.result_json === null || row.result_json === undefined ? null : JSON.parse(String(row.result_json)),
    risk: String(row.risk) as AssistantProposalRisk,
    status: String(row.status) as AssistantProposalStatus,
    summary: String(row.summary),
    threadId: String(row.thread_id),
    tool: String(row.tool),
    undo: row.undo_json === null || row.undo_json === undefined ? null : (JSON.parse(String(row.undo_json)) as AssistantProposalRecord["undo"]),
    undoExpiresAt: row.undo_expires_at === null || row.undo_expires_at === undefined ? null : String(row.undo_expires_at),
    updatedAt: String(row.updated_at),
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
  ask: { options: string[]; question: string } | null;
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

interface MemoryAssistantProposal {
  ownerId: string;
  record: AssistantProposalRecord;
}

const memoryAssistantThreads = new Map<string, MemoryAssistantThread>();
const memoryAssistantMessages = new Map<string, MemoryAssistantMessage>();
const memoryAssistantProposals = new Map<string, MemoryAssistantProposal>();
let memoryAssistantMessageSequence = 0;

export function resetCloudAssistantMemoryForTests() {
  memoryAssistantThreads.clear();
  memoryAssistantMessages.clear();
  memoryAssistantProposals.clear();
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
    async appendMessage(message, options) {
      const thread = await db
        .prepare("SELECT id FROM assistant_threads WHERE id = ? AND owner_id = ?")
        .bind(message.threadId, ownerId)
        .first();
      if (!thread) throw new Error("assistant thread not found");
      const fence = options?.fence;
      if (fence) {
        if (fence.signal.aborted) throw new AssistantWriteFencedError();
        // The deadline is checked again inside the transaction, on the
        // database's clock; the update follows only the inserted row.
        const results = (await db.batch([
          db.prepare(
            "INSERT INTO assistant_messages (id, thread_id, owner_id, role, text, status, error_code, created_at, ask_json) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE strftime('%Y-%m-%dT%H:%M:%fZ', 'now') <= ?",
          ).bind(message.id, message.threadId, ownerId, message.role, message.text, message.status, message.errorCode, message.createdAt, message.ask ? JSON.stringify(message.ask) : null, fence.notAfter),
          db.prepare("UPDATE assistant_threads SET updated_at = ? WHERE id = ? AND owner_id = ? AND EXISTS (SELECT 1 FROM assistant_messages WHERE id = ? AND owner_id = ?)")
            .bind(message.createdAt, message.threadId, ownerId, message.id, ownerId),
        ])) as { meta?: { changes?: number } }[];
        if (Number(results[0]?.meta?.changes ?? 0) === 0) throw new AssistantWriteFencedError();
        return;
      }
      await db.batch([
        db.prepare(
          "INSERT INTO assistant_messages (id, thread_id, owner_id, role, text, status, error_code, created_at, ask_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(message.id, message.threadId, ownerId, message.role, message.text, message.status, message.errorCode, message.createdAt, message.ask ? JSON.stringify(message.ask) : null),
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
        db.prepare("DELETE FROM assistant_proposals WHERE thread_id = ? AND owner_id = ?").bind(id, ownerId),
        db.prepare("DELETE FROM assistant_messages WHERE thread_id = ? AND owner_id = ?").bind(id, ownerId),
        db.prepare("DELETE FROM assistant_threads WHERE id = ? AND owner_id = ?").bind(id, ownerId),
      ])) as { meta?: { changes?: number } }[];
      return Number(results[2]?.meta?.changes ?? 0) > 0;
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
          "SELECT id, thread_id, role, text, status, error_code, created_at, ask_json FROM assistant_messages WHERE thread_id = ? AND owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
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
    async createProposal(record) {
      const thread = await db
        .prepare("SELECT id FROM assistant_threads WHERE id = ? AND owner_id = ?")
        .bind(record.threadId, ownerId)
        .first();
      if (!thread) throw new Error("assistant thread not found");
      await db
        .prepare(
          "INSERT INTO assistant_proposals (id, thread_id, owner_id, message_id, tool, args_json, display_json, summary, risk, fingerprint, status, error_code, result_json, undo_json, created_at, expires_at, executed_at, undo_expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          record.id,
          record.threadId,
          ownerId,
          record.messageId,
          record.tool,
          JSON.stringify(record.args),
          JSON.stringify(record.display),
          record.summary,
          record.risk,
          record.fingerprint,
          record.status,
          record.errorCode,
          record.result === null ? null : JSON.stringify(record.result),
          record.undo === null ? null : JSON.stringify(record.undo),
          record.createdAt,
          record.expiresAt,
          record.executedAt,
          record.undoExpiresAt,
          record.updatedAt,
        )
        .run();
    },
    async getProposal(id) {
      const row = await db
        .prepare("SELECT * FROM assistant_proposals WHERE id = ? AND owner_id = ?")
        .bind(id, ownerId)
        .first();
      return row ? proposalFromRow(row) : null;
    },
    async listProposals(threadId) {
      const result = await db
        .prepare(
          "SELECT * FROM assistant_proposals WHERE thread_id = ? AND owner_id = ? ORDER BY created_at ASC, id ASC",
        )
        .bind(threadId, ownerId)
        .all();
      return (result.results || []).map(proposalFromRow);
    },
    async transitionProposal(input) {
      const { id, from, to, now, patch, requireBefore } = input;
      if (from.length === 0) return null;
      const sets = ["status = ?", "updated_at = ?"];
      const params: unknown[] = [to, now];
      if (patch) {
        if (patch.errorCode !== undefined) {
          sets.push("error_code = ?");
          params.push(patch.errorCode);
        }
        if (patch.executedAt !== undefined) {
          sets.push("executed_at = ?");
          params.push(patch.executedAt);
        }
        if (patch.result !== undefined) {
          sets.push("result_json = ?");
          params.push(patch.result === null ? null : JSON.stringify(patch.result));
        }
        if (patch.undo !== undefined) {
          sets.push("undo_json = ?");
          params.push(patch.undo === null ? null : JSON.stringify(patch.undo));
        }
        if (patch.undoExpiresAt !== undefined) {
          sets.push("undo_expires_at = ?");
          params.push(patch.undoExpiresAt);
        }
      }
      const statusPlaceholders = from.map(() => "?").join(", ");
      let query = `UPDATE assistant_proposals SET ${sets.join(", ")} WHERE id = ? AND owner_id = ? AND status IN (${statusPlaceholders})`;
      const bound: unknown[] = [id, ownerId, ...from];
      if (requireBefore) {
        query += requireBefore === "expiresAt" ? " AND expires_at > ?" : " AND undo_expires_at > ?";
        bound.push(now);
      }
      query += " RETURNING *";
      const result = await db.prepare(query).bind(...params, ...bound).all();
      return result.results && result.results.length > 0 ? proposalFromRow(result.results[0]) : null;
    },
  };
}

function memoryOwner(id: string, ownerId: string): MemoryAssistantThread | null {
  const thread = memoryAssistantThreads.get(id);
  return thread && thread.ownerId === ownerId ? thread : null;
}

function cloudMemoryAssistantStore(ownerId: string): AssistantStore {
  return {
    async appendMessage(message, options) {
      const thread = memoryOwner(message.threadId, ownerId);
      if (!thread) throw new Error("assistant thread not found");
      // Read in the same synchronous step as the insert.
      if (options?.fence?.signal.aborted) throw new AssistantWriteFencedError();
      memoryAssistantMessages.set(message.id, {
        ask: message.ask,
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
      for (const [proposalId, proposal] of memoryAssistantProposals) {
        if (proposal.record.threadId === id && proposal.ownerId === ownerId) memoryAssistantProposals.delete(proposalId);
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
          ask: message.ask,
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
    async createProposal(record) {
      const thread = memoryOwner(record.threadId, ownerId);
      if (!thread) throw new Error("assistant thread not found");
      memoryAssistantProposals.set(record.id, { ownerId, record: { ...record } });
    },
    async getProposal(id) {
      const entry = memoryAssistantProposals.get(id);
      return entry && entry.ownerId === ownerId ? { ...entry.record } : null;
    },
    async listProposals(threadId) {
      return Array.from(memoryAssistantProposals.values())
        .filter((entry) => entry.ownerId === ownerId && entry.record.threadId === threadId)
        .sort((left, right) => left.record.createdAt.localeCompare(right.record.createdAt) || left.record.id.localeCompare(right.record.id))
        .map((entry) => ({ ...entry.record }));
    },
    async transitionProposal(input) {
      const { id, from, to, now, patch, requireBefore } = input;
      const entry = memoryAssistantProposals.get(id);
      if (!entry || entry.ownerId !== ownerId || from.length === 0) return null;
      const record = entry.record;
      if (!from.includes(record.status)) return null;
      if (requireBefore) {
        const value = requireBefore === "expiresAt" ? record.expiresAt : record.undoExpiresAt;
        if (typeof value !== "string" || !(value > now)) return null;
      }
      const next: AssistantProposalRecord = { ...record, status: to, updatedAt: now };
      if (patch) {
        if (patch.errorCode !== undefined) next.errorCode = patch.errorCode;
        if (patch.executedAt !== undefined) next.executedAt = patch.executedAt;
        if (patch.result !== undefined) next.result = patch.result;
        if (patch.undo !== undefined) next.undo = patch.undo;
        if (patch.undoExpiresAt !== undefined) next.undoExpiresAt = patch.undoExpiresAt;
      }
      entry.record = next;
      return { ...next };
    },
  };
}

/**
 * Deletes every thread (all owners) whose `updated_at` is before `cutoffIso`
 * plus its proposals and messages. With `env.DB` the three DELETEs run in a
 * single `db.batch`, so a failure (or a concurrent append) in between cannot
 * leave a surviving thread with its history already gone: the batch either
 * deletes all of it or nothing. The in-memory branch keeps the same
 * thread-then-messages order inside one synchronous step.
 */
export async function cleanupAssistantThreads(env: { DB?: AssistantD1Database }, cutoffIso: string): Promise<number> {
  if (env.DB) {
    const results = await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM assistant_proposals WHERE thread_id IN (SELECT id FROM assistant_threads WHERE updated_at < ?)",
      ).bind(cutoffIso),
      env.DB.prepare(
        "DELETE FROM assistant_messages WHERE thread_id IN (SELECT id FROM assistant_threads WHERE updated_at < ?)",
      ).bind(cutoffIso),
      env.DB.prepare("DELETE FROM assistant_threads WHERE updated_at < ?").bind(cutoffIso),
    ]) as { meta?: { changes?: number } }[];
    return Number(results[2]?.meta?.changes || 0);
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
  for (const [proposalId, proposal] of memoryAssistantProposals) {
    if (!memoryAssistantThreads.has(proposal.record.threadId)) memoryAssistantProposals.delete(proposalId);
  }
  return deleted;
}
