// Pin indexing and search runtime of the Cloud (F3 contract §3.3,
// decisions A18, A20 and A23).
//
// Endpoints (cloudRetrievalEndpoints), by the first link of ASSISTANT_CHAIN
// (F4 contract §4, decision A46: the environment never decides the
// provider, so the hub is the same in every environment):
// - appliance: the OpenAI-compatible endpoint of AI_BASE_URL (AI_API_KEY,
//   AI_MODEL) - the assistant's chat endpoint. The embedding endpoint is
//   the same base URL and key with AI_EMBEDDING_MODEL; without it the
//   entries are text-only and the search is textual. Vision uses the chat
//   endpoint only when detectRetrievalCapabilities finds image input for
//   AI_MODEL, and the filing engine is `decisions` when AI_MODEL declares
//   it;
// - gateway: the gateway's OpenAI-compatible endpoint
//   (GATEWAY_OPENAI_BASE_URL) with AI_GATEWAY_API_KEY, and the chain's
//   privacy options (AI_GATEWAY_ZERO_DATA_RETENTION) on every call, and
//   the cost recorder cloud-api.ts passes (recordIndexCost), if any.
//   detectGatewayRetrievalCapabilities reads the catalog for the configured
//   ids only: captions by the first link when its tags list "vision", and
//   embeddings only with AI_EMBEDDING_MODEL of type "embedding" (otherwise
//   the search is textual and the automatic destination is off, A44).
//   Never `decisions`.
// Without the configuration of the first link's hub (an invalid chain,
// an appliance link without AI_BASE_URL/AI_API_KEY, a gateway link
// without AI_GATEWAY_API_KEY) there is no endpoint (the gate of
// cloud-api.ts is off then too, in every environment).
//
// Store (A20): the entries of a session belong to its owner. The search
// store sends each session to cloudPinIndexStore(env, ownerId) of the owner
// the source mapped it to; entriesFor and staleSessions ask each owner's
// store only for that owner's ids. A session outside the map is never read
// (empty answers) nor written (replaceSession throws).
//
// Search: before searchPins, indexStale with a 10 s budget and up to 20
// sessions, every search. The budget is a deadline that starts with the
// search: every indexing request (vision, document embeddings) runs on a
// signal that joins it with the turn's signal, so a slow request is cut
// when either ends and its session stays stale for a later pass. The
// question's embedding runs on the turn's signal only. Once the turn's
// signal is aborted the search starts no new request.
//
// The cron job (runCloudPinIndexCron) enumerates its owners and indexes,
// for each one, that owner's own sessions (stale and lagging, newest
// first), all within one 60 s budget that starts before the enumeration;
// requests in flight are cut at its end. An owner that fails is skipped
// and the next one runs. cloud-api.ts applies the gates (A3) before calling
// either.

import { parseAssistantChain, type AssistantChainLink } from "../chain";
import type { AssistantD1Database } from "../store-cloud";
import type { AssistantEndpoint } from "../models";
import { detectGatewayRetrievalCapabilities, detectRetrievalCapabilities } from "./detect";
import type { EmbeddingEndpoint } from "./embeddings";
import { GATEWAY_OPENAI_BASE_URL, type GatewayCallOptions } from "./gateway";
import {
  indexStale,
  PIN_SEARCH_MAX_SESSIONS,
  searchPins,
  withAbortSignal,
  type PinIndexDeps,
  type PinIndexEntry,
  type PinIndexStore,
  type PinSearchService,
  type PinSource,
} from "./index";
import { cloudPinSource, type CloudPinSourceData } from "./source-cloud";
import { cloudPinIndexStore } from "./store-cloud";
import type { VisionEndpoint } from "./vision";

export const CLOUD_PIN_SEARCH_BUDGET_MS = 10_000;
export const CLOUD_PIN_SEARCH_MAX_SESSIONS = 20;
export const CLOUD_PIN_INDEX_CRON_BUDGET_MS = 60_000;

export interface CloudPinEnv {
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_EMBEDDING_MODEL?: string;
  AI_GATEWAY_API_KEY?: string;
  AI_GATEWAY_ZERO_DATA_RETENTION?: string;
  AI_MODEL?: string;
  ASSISTANT_CHAIN?: string;
  DB?: AssistantD1Database;
  DEPLOYMENT_ENV?: string;
}

// The assistant's appliance chat endpoint (the OpenAI-compatible endpoint
// of AI_BASE_URL), or null without the AI configuration.
function cloudChatEndpoint(env: CloudPinEnv): AssistantEndpoint | null {
  if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL) return null;
  return { apiKey: env.AI_API_KEY, baseUrl: env.AI_BASE_URL, kind: "appliance", model: env.AI_MODEL, thinkingControl: true };
}

type CloudRetrievalHub =
  | { chat: AssistantEndpoint; hub: "appliance" }
  | { chat: AssistantEndpoint; hub: "gateway"; zeroDataRetention: boolean };

// The hub of the first link of the chain; null when there is none or when
// that hub lacks its configuration (A46: the same in every environment).
function cloudRetrievalHub(env: CloudPinEnv): CloudRetrievalHub | null {
  const appliance = (): CloudRetrievalHub | null => {
    const chat = cloudChatEndpoint(env);
    return chat ? { chat, hub: "appliance" } : null;
  };
  const csv = env.ASSISTANT_CHAIN?.trim();
  if (!csv) return appliance();
  let first: AssistantChainLink;
  try {
    first = parseAssistantChain(csv)[0]!;
  } catch {
    return null;
  }
  if (first.hub === "appliance") return appliance();
  if (!env.AI_GATEWAY_API_KEY) return null;
  return {
    chat: { apiKey: env.AI_GATEWAY_API_KEY, baseUrl: GATEWAY_OPENAI_BASE_URL, kind: "openai-compatible", model: first.model, thinkingControl: false },
    hub: "gateway",
    zeroDataRetention: env.AI_GATEWAY_ZERO_DATA_RETENTION === "true",
  };
}

export interface CloudRetrievalEndpoints {
  // Captions; null without image input for the chat model.
  chat: VisionEndpoint | null;
  // The filing engine `decisions`; never through the gateway.
  decisions: AssistantEndpoint | null;
  // Document and query embeddings; null → text-only entries and search.
  embedding: EmbeddingEndpoint | null;
}

/** The recorder cloud-api.ts gives the gateway calls (the margin monitor's index costs). */
export type CloudIndexCostRecorder = NonNullable<GatewayCallOptions["record"]>;

/**
 * The retrieval endpoints of the deployment, after the detection of the
 * hub (cached, see detect.ts); null without a hub. `detectFetch` runs the
 * /models probe; `recordIndexCost` goes with the gateway endpoints only
 * (the appliance records nothing).
 */
export async function cloudRetrievalEndpoints(
  env: CloudPinEnv,
  detectFetch?: typeof fetch,
  recordIndexCost?: CloudIndexCostRecorder,
): Promise<CloudRetrievalEndpoints | null> {
  const hub = cloudRetrievalHub(env);
  if (!hub) return null;
  const { chat } = hub;
  if (hub.hub === "appliance") {
    const capabilities = await detectRetrievalCapabilities({ endpoint: chat, ...(detectFetch ? { fetch: detectFetch } : {}) });
    return {
      chat: capabilities.vision ? chat : null,
      decisions: capabilities.decisions ? chat : null,
      embedding: env.AI_EMBEDDING_MODEL ? { apiKey: chat.apiKey, baseUrl: chat.baseUrl, model: env.AI_EMBEDDING_MODEL } : null,
    };
  }
  const capabilities = await detectGatewayRetrievalCapabilities({
    baseUrl: chat.baseUrl,
    chatModel: chat.model,
    embeddingModel: env.AI_EMBEDDING_MODEL || null,
    ...(detectFetch ? { fetch: detectFetch } : {}),
  });
  const gateway: GatewayCallOptions = {
    ...(recordIndexCost ? { record: recordIndexCost } : {}),
    zeroDataRetention: hub.zeroDataRetention,
  };
  return {
    chat: capabilities.vision ? { ...chat, gateway } : null,
    decisions: null,
    embedding: capabilities.embeddingModel
      ? {
          apiKey: chat.apiKey,
          baseUrl: chat.baseUrl,
          gateway: { ...gateway, inputPrice: capabilities.embeddingInputPrice ?? null },
          model: capabilities.embeddingModel,
        }
      : null,
  };
}

// `fetch` runs the indexing requests; `detectFetch` the /models probe,
// which keeps its own 5 s deadline and cache without the run's signal, so an
// aborted turn never leaves a failed detection cached for a minute.
async function indexDeps(
  env: CloudPinEnv,
  options: {
    detectFetch?: typeof fetch;
    fetch?: typeof fetch;
    now: () => Date;
    recordIndexCost?: CloudIndexCostRecorder;
    source: PinSource;
    store: PinIndexStore;
  },
): Promise<PinIndexDeps | null> {
  const endpoints = await cloudRetrievalEndpoints(env, options.detectFetch, options.recordIndexCost);
  if (!endpoints) return null;
  return {
    chat: endpoints.chat,
    embedding: endpoints.embedding,
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
    async readMark(sessionId) {
      const ownerId = owners.get(sessionId);
      return ownerId === undefined ? null : (storeOf(ownerId).readMark?.(sessionId) ?? null);
    },
    async replaceSession(sessionId, entries, options) {
      const ownerId = owners.get(sessionId);
      if (ownerId === undefined) throw new Error("pin index session has no known owner");
      await storeOf(ownerId).replaceSession(sessionId, entries, options);
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
 * 20 stale sessions within `indexBudgetMs` (10 s), then searches.
 */
export function createCloudPinSearch(input: {
  data: CloudPinSourceData;
  env: CloudPinEnv;
  fetch?: typeof fetch;
  indexBudgetMs?: number;
  now?: () => Date;
  recordIndexCost?: CloudIndexCostRecorder;
}): PinSearchService {
  const now = input.now ?? (() => new Date());
  const indexBudgetMs = input.indexBudgetMs ?? CLOUD_PIN_SEARCH_BUDGET_MS;
  return {
    async search({ limit, query, signal }) {
      signal?.throwIfAborted();
      // The indexing deadline starts with the search; the turn ends it sooner.
      const deadline = AbortSignal.timeout(indexBudgetMs);
      const indexSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      // A fresh source per search: the accessible sessions are read again.
      const source = cloudPinSource(input.data);
      const store = cloudOwnerPinIndexStore(input.env, await source.owners());
      signal?.throwIfAborted();
      const indexing = await indexDeps(input.env, {
        ...(input.fetch ? { detectFetch: input.fetch } : {}),
        fetch: withAbortSignal(input.fetch, indexSignal),
        now,
        ...(input.recordIndexCost ? { recordIndexCost: input.recordIndexCost } : {}),
        source,
        store,
      });
      if (!indexing) throw new Error("pin search unavailable");
      await indexStale(indexing, { budgetMs: indexBudgetMs, maxSessions: CLOUD_PIN_SEARCH_MAX_SESSIONS, signal: indexSignal });
      signal?.throwIfAborted();
      // The question's embedding is bound to the turn only.
      const { fetch: _indexFetch, ...rest } = indexing;
      const searchFetch = withAbortSignal(input.fetch, signal);
      return searchPins({ ...rest, ...(searchFetch ? { fetch: searchFetch } : {}) }, { limit, query });
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
 * The daily indexing: the budget (60 s) starts first, then `owners()`
 * enumerates the owners inside it; for each owner, in that order,
 * indexStale over the owner's own sessions with the store of that owner,
 * until the budget is spent (`remaining: true`). Requests in flight are cut
 * when the budget ends. An owner that fails counts in `failed` and the next
 * one runs.
 */
export async function runCloudPinIndexCron(input: {
  budgetMs?: number;
  env: CloudPinEnv;
  fetch?: typeof fetch;
  now?: () => Date;
  ownerData: (ownerId: string) => CloudPinSourceData;
  // `expired` tells the enumeration that the budget is spent
  owners: (expired: () => boolean) => Promise<string[]>;
  recordIndexCost?: CloudIndexCostRecorder;
}): Promise<CloudPinIndexCronResult> {
  const now = input.now ?? (() => new Date());
  const budgetMs = input.budgetMs ?? CLOUD_PIN_INDEX_CRON_BUDGET_MS;
  const startedAt = now().getTime();
  const deadline = AbortSignal.timeout(budgetMs);
  const result: CloudPinIndexCronResult = { failed: 0, indexed: 0, owners: 0, remaining: false };
  const expired = () => deadline.aborted || now().getTime() - startedAt >= budgetMs;
  const owners = await input.owners(expired);
  if (expired()) {
    // The enumeration used the budget up, or stopped early.
    result.remaining = true;
    return result;
  }
  for (const ownerId of owners) {
    const left = budgetMs - (now().getTime() - startedAt);
    if (left <= 0 || deadline.aborted) {
      result.remaining = true;
      break;
    }
    try {
      const deps = await indexDeps(input.env, {
        ...(input.fetch ? { detectFetch: input.fetch } : {}),
        fetch: withAbortSignal(input.fetch, deadline),
        now,
        ...(input.recordIndexCost ? { recordIndexCost: input.recordIndexCost } : {}),
        source: cloudPinSource(input.ownerData(ownerId)),
        store: cloudPinIndexStore(input.env, ownerId),
      });
      if (!deps) return result;
      const pass = await indexStale(deps, { budgetMs: left, maxSessions: PIN_SEARCH_MAX_SESSIONS, signal: deadline });
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
