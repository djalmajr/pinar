// Pin indexing and search runtime of the Cloud (F3 contract §3.3,
// decisions A18, A20 and A23).
//
// Endpoints: the chat endpoint is the assistant's (AI_BASE_URL, AI_API_KEY,
// AI_MODEL). The embedding endpoint is the same base URL and key with
// AI_EMBEDDING_MODEL; without it the entries are text-only and the search
// is textual. Vision uses the chat endpoint only when
// detectRetrievalCapabilities finds image input for AI_MODEL.
//
// Store (A20): the entries of a session belong to its owner. The search
// store sends each session to cloudPinIndexStore(env, ownerId) of the owner
// the source mapped it to; entriesFor and staleSessions ask each owner's
// store only for that owner's ids. A session outside the map is never read
// (empty answers) nor written (replaceSession throws).
//
// Search: before searchPins, indexStale with a 10 s budget and up to 20
// sessions, every search. The cron job (runCloudPinIndexCron) indexes, for
// each owner it is given, that owner's own sessions (stale and lagging,
// newest first) within one 60 s budget for the whole run; an owner that
// fails is skipped and the next one runs. cloud-api.ts applies the gates
// (A3) before calling either.

import type { AssistantD1Database } from "../store-cloud";
import type { AssistantEndpoint } from "../models";
import { detectRetrievalCapabilities } from "./detect";
import {
  indexStale,
  PIN_SEARCH_MAX_SESSIONS,
  searchPins,
  type PinIndexDeps,
  type PinIndexEntry,
  type PinIndexStore,
  type PinSearchService,
  type PinSource,
} from "./index";
import { cloudPinSource, type CloudPinSourceData } from "./source-cloud";
import { cloudPinIndexStore } from "./store-cloud";

export const CLOUD_PIN_SEARCH_BUDGET_MS = 10_000;
export const CLOUD_PIN_SEARCH_MAX_SESSIONS = 20;
export const CLOUD_PIN_INDEX_CRON_BUDGET_MS = 60_000;

export interface CloudPinEnv {
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_EMBEDDING_MODEL?: string;
  AI_MODEL?: string;
  DB?: AssistantD1Database;
}

// The assistant's chat endpoint (the one cloud-api.ts gives the turn), or
// null without the AI configuration.
export function cloudChatEndpoint(env: CloudPinEnv): AssistantEndpoint | null {
  if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL) return null;
  return { apiKey: env.AI_API_KEY, baseUrl: env.AI_BASE_URL, kind: "appliance", model: env.AI_MODEL, thinkingControl: true };
}

async function indexDeps(
  env: CloudPinEnv,
  options: { fetch?: typeof fetch; now: () => Date; source: PinSource; store: PinIndexStore },
): Promise<PinIndexDeps | null> {
  const chat = cloudChatEndpoint(env);
  if (!chat) return null;
  const capabilities = await detectRetrievalCapabilities({ endpoint: chat, ...(options.fetch ? { fetch: options.fetch } : {}) });
  return {
    chat: capabilities.vision ? chat : null,
    embedding: env.AI_EMBEDDING_MODEL ? { apiKey: chat.apiKey, baseUrl: chat.baseUrl, model: env.AI_EMBEDDING_MODEL } : null,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    now: options.now,
    source: options.source,
    store: options.store,
  };
}

// The ids of `sessionIds` grouped by owner, in input order, each id once;
// ids without an owner are left out.
function byOwner(owners: Map<string, string>, sessionIds: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of new Set(sessionIds)) {
    const ownerId = owners.get(id);
    if (ownerId === undefined) continue;
    const group = groups.get(ownerId) ?? [];
    group.push(id);
    groups.set(ownerId, group);
  }
  return groups;
}

/** A PinIndexStore that sends each session to the store of its owner (A20). */
export function cloudOwnerPinIndexStore(env: CloudPinEnv, owners: Map<string, string>): PinIndexStore {
  const stores = new Map<string, PinIndexStore>();
  const storeOf = (ownerId: string) => {
    let store = stores.get(ownerId);
    if (!store) {
      store = cloudPinIndexStore(env, ownerId);
      stores.set(ownerId, store);
    }
    return store;
  };
  return {
    async deleteSession(sessionId) {
      const ownerId = owners.get(sessionId);
      if (ownerId !== undefined) await storeOf(ownerId).deleteSession(sessionId);
    },
    async entries(sessionId) {
      const ownerId = owners.get(sessionId);
      return ownerId === undefined ? [] : storeOf(ownerId).entries(sessionId);
    },
    async entriesFor(sessionIds) {
      const groups = byOwner(owners, sessionIds);
      const entries: PinIndexEntry[] = [];
      for (const [ownerId, ids] of groups) entries.push(...(await storeOf(ownerId).entriesFor(ids)));
      // The requested session order, then the order each store returned.
      const position = new Map([...new Set(sessionIds)].map((id, index) => [id, index]));
      return entries
        .map((entry, index) => ({ entry, index }))
        .sort((left, right) => position.get(left.entry.sessionId)! - position.get(right.entry.sessionId)! || left.index - right.index)
        .map((item) => item.entry);
    },
    async replaceSession(sessionId, entries) {
      const ownerId = owners.get(sessionId);
      if (ownerId === undefined) throw new Error("pin index session has no known owner");
      await storeOf(ownerId).replaceSession(sessionId, entries);
    },
    async staleSessions(input) {
      if (!(input.limit > 0)) return [];
      const groups = byOwner(owners, input.sessions.map((session) => session.id));
      const stale = new Set<string>();
      for (const [ownerId, ids] of groups) {
        const wanted = new Set(ids);
        const sessions = input.sessions.filter((session) => wanted.has(session.id));
        for (const id of await storeOf(ownerId).staleSessions({ limit: input.limit, sessions })) stale.add(id);
      }
      // Input order, each id once, up to the limit.
      const result: string[] = [];
      for (const session of input.sessions) {
        if (result.length >= input.limit) break;
        if (stale.delete(session.id)) result.push(session.id);
      }
      return result;
    },
  };
}

/**
 * The pin search of one principal: `data` is that principal's view
 * (owned sessions and accepted collaborations). Each search indexes up to
 * 20 stale sessions within 10 s, then searches.
 */
export function createCloudPinSearch(input: {
  data: CloudPinSourceData;
  env: CloudPinEnv;
  fetch?: typeof fetch;
  now?: () => Date;
}): PinSearchService {
  const now = input.now ?? (() => new Date());
  return {
    async search(query) {
      // A fresh source per search: the accessible sessions are read again.
      const source = cloudPinSource(input.data);
      const store = cloudOwnerPinIndexStore(input.env, await source.owners());
      const deps = await indexDeps(input.env, { ...(input.fetch ? { fetch: input.fetch } : {}), now, source, store });
      if (!deps) throw new Error("pin search unavailable");
      await indexStale(deps, { budgetMs: CLOUD_PIN_SEARCH_BUDGET_MS, maxSessions: CLOUD_PIN_SEARCH_MAX_SESSIONS });
      return searchPins(deps, query);
    },
  };
}

export interface CloudPinIndexCronResult {
  failed: number;
  indexed: number;
  owners: number;
  remaining: boolean;
}

/**
 * The daily indexing: for each owner, in the given order, indexStale over
 * the owner's own sessions with the store of that owner, until the 60 s
 * budget of the whole run is spent. An owner that fails counts in `failed`
 * and the next one runs.
 */
export async function runCloudPinIndexCron(input: {
  budgetMs?: number;
  env: CloudPinEnv;
  fetch?: typeof fetch;
  now?: () => Date;
  ownerData: (ownerId: string) => CloudPinSourceData;
  owners: string[];
}): Promise<CloudPinIndexCronResult> {
  const now = input.now ?? (() => new Date());
  const budgetMs = input.budgetMs ?? CLOUD_PIN_INDEX_CRON_BUDGET_MS;
  const startedAt = now().getTime();
  const result: CloudPinIndexCronResult = { failed: 0, indexed: 0, owners: 0, remaining: false };
  for (const ownerId of input.owners) {
    const left = budgetMs - (now().getTime() - startedAt);
    if (left <= 0) {
      result.remaining = true;
      break;
    }
    try {
      const deps = await indexDeps(input.env, {
        ...(input.fetch ? { fetch: input.fetch } : {}),
        now,
        source: cloudPinSource(input.ownerData(ownerId)),
        store: cloudPinIndexStore(input.env, ownerId),
      });
      if (!deps) return result;
      const pass = await indexStale(deps, { budgetMs: left, maxSessions: PIN_SEARCH_MAX_SESSIONS });
      result.indexed += pass.indexed;
      result.owners += 1;
      if (pass.remaining) result.remaining = true;
    } catch {
      // The next owner still runs; nothing about the failure is logged.
      result.failed += 1;
      result.remaining = true;
    }
  }
  return result;
}
