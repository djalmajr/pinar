// Pin indexing and search runtime of the Cloud (F3 contract §3.3,
// decisions A18, A20 and A23).
//
// Endpoints (cloudRetrievalEndpoints), by the first link of ASSISTANT_CHAIN
// (F4 contract §4, decision A46: the environment never decides the
// provider, so the hub is the same in every environment):
// - appliance: the OpenAI-compatible endpoint of AI_BASE_URL with
//   AI_API_KEY - the assistant's chat endpoint, with the chain's appliance
//   link as the model (AI_MODEL in the default chain, without
//   ASSISTANT_CHAIN). The embedding endpoint is the same base URL and key
//   with AI_EMBEDDING_MODEL; without it the entries are text-only and the
//   search is textual. Vision uses the chat endpoint only when
//   detectRetrievalCapabilities finds image input for the chat model, and
//   the filing engine is `decisions` when the chat model declares it;
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
// The search indexes the stale sessions on demand, within the turn's
// budget (A53: the daily index cron is gone — indexing only happens inside
// the charged assistant message).
// cloud-api.ts applies the gates (A3) before calling it.

import { parseAssistantChain, type AssistantChainLink } from "../chain";
import type { AssistantD1Database } from "../store-cloud";
import type { AssistantEndpoint } from "../models";
import { detectGatewayRetrievalCapabilities, detectRetrievalCapabilities } from "./detect";
import type { EmbeddingEndpoint } from "./embeddings";
import { GATEWAY_OPENAI_BASE_URL, type GatewayCallOptions } from "./gateway";
import {
  indexStale,
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
// of AI_BASE_URL), or null without its configuration (AI_BASE_URL and
// AI_API_KEY) or without a chat model.
function cloudChatEndpoint(env: CloudPinEnv, model: string): AssistantEndpoint | null {
  if (!env.AI_BASE_URL || !env.AI_API_KEY || !model) return null;
  return { apiKey: env.AI_API_KEY, baseUrl: env.AI_BASE_URL, kind: "appliance", model, thinkingControl: true };
}

type CloudRetrievalHub =
  | { chat: AssistantEndpoint; hub: "appliance" }
  | { chat: AssistantEndpoint; hub: "gateway"; zeroDataRetention: boolean };

// The hub of the first link of the chain; null when there is none or when
// that hub lacks its configuration (A46: the same in every environment).
// The appliance's chat model comes from the chain's appliance link, like
// the chat; AI_MODEL serves only the default chain (no ASSISTANT_CHAIN).
function cloudRetrievalHub(env: CloudPinEnv): CloudRetrievalHub | null {
  const appliance = (model: string): CloudRetrievalHub | null => {
    const chat = cloudChatEndpoint(env, model);
    return chat ? { chat, hub: "appliance" } : null;
  };
  const csv = env.ASSISTANT_CHAIN?.trim();
  if (!csv) return appliance(env.AI_MODEL ?? "");
  let first: AssistantChainLink;
  try {
    first = parseAssistantChain(csv)[0]!;
  } catch {
    return null;
  }
  if (first.hub === "appliance") return appliance(first.model);
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

// Each search indexes stale accessible sessions within the indexing budget,
// then ranks their pins using the deployment endpoints.
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
      const { fetch: _indexFetch, ...rest } = indexing;
      const searchFetch = withAbortSignal(input.fetch, signal);
      const result = await searchPins({ ...rest, ...(searchFetch ? { fetch: searchFetch } : {}) }, { limit, query });
      return result;
    },
  };
}
