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
import { buildPinDocument, pinDocumentHash } from "./document";
import { detectGatewayRetrievalCapabilities, detectRetrievalCapabilities } from "./detect";
import type { EmbeddingEndpoint } from "./embeddings";
import { GATEWAY_OPENAI_BASE_URL, type GatewayCallOptions } from "./gateway";
import {
  indexStale,
  sameSection,
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

/**
 * The pin search of a BYOK assistant turn (F5/S3, contract §5): the turn
 * makes no gateway call — no hub detection, no indexing, no captions from
 * the model, no query embedding, no pin_index write. The ranking is the
 * text-only one searchPins already has (embedding: null), over the
 * CURRENT documents of the accessible sessions — page, URL, the pin's own
 * fields and the conversation comments — built in memory from the same
 * source the indexing reads (F1 review fix: a pin that was never indexed
 * is found, and an edited comment is scored by its new text, not by the
 * stale entry). An entry that is still current by the indexing' own rule
 * (its "Pin #n" line in place and its stored hash still the hash of its
 * stored text) contributes its caption; without it the document is
 * caption-less. S3c indexes with the user's own capabilities.
 *
 * The limits are the indexing' own, so the search never reads the whole
 * account per call: at most CLOUD_PIN_SEARCH_MAX_SESSIONS (20) sessions
 * are read and built per search, and the search settles at
 * CLOUD_PIN_SEARCH_BUDGET_MS (10 s, or the test's budgetMs) from its start,
 * joined with the turn's signal. Every read the search starts (the
 * preparation's listing, the session and comments builds, the hit
 * resolution) ends its wait on that combined signal (R2 review fix): a
 * read the driver has already started may keep going alone, but the search
 * does not wait for it, and checks the signal after each await before
 * starting the next read. The turn's abort ends the search with the
 * caller's reason — the gateway search's answer (throwIfAborted and its
 * bound fetch) — and starts no new read; the budget alone settles it with
 * what it already resolved (a session not resolved simply does not
 * contribute). Nothing is written.
 */
export function createByokTextPinSearch(input: {
  budgetMs?: number;
  data: CloudPinSourceData;
  env: CloudPinEnv;
  now?: () => Date;
}): PinSearchService {
  const now = input.now ?? (() => new Date());
  return {
    async search({ limit, query, signal }) {
      signal?.throwIfAborted();
      // The build's deadline starts with the search (10 s by default);
      // the turn ends it sooner.
      const deadline = AbortSignal.timeout(input.budgetMs ?? CLOUD_PIN_SEARCH_BUDGET_MS);
      const buildSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      // A fresh source per search: the accessible sessions are read again.
      const source = cloudPinSource(input.data);
      // The combined signal's end at a check point (R2): the turn's abort
      // rejects with the caller's reason (the gateway search's answer);
      // the budget alone stops the search.
      const budgetOnlyEnded = (): boolean => {
        if (signal?.aborted) throw turnAbortReason(signal);
        return buildSignal.aborted;
      };
      // Checked after each await, before the next read starts: the turn's
      // abort rejects with the caller's reason (the gateway search's
      // answer); the budget alone stops the search with what it already
      // resolved (here: no stored captions, no listing).
      const ownersRead = await byokRaceSignal(source.owners(), buildSignal);
      if (ownersRead === undefined) budgetOnlyEnded();
      const indexStore = cloudOwnerPinIndexStore(input.env, ownersRead ?? new Map());
      // The store searchPins ranks: the current documents, built in memory
      // (entriesFor below). It never writes pin_index.
      const store: PinIndexStore = {
        async deleteSession() {
          throw new Error("the byok text pin search does not write the pin index");
        },
        async entries() {
          throw new Error("the byok text pin search does not read stored entries per session");
        },
        async entriesFor(sessionIds) {
          // The CLOUD_PIN_SEARCH_MAX_SESSIONS most recent accessible
          // sessions (searchPins hands them over newest first).
          const wanted = sessionIds.slice(0, CLOUD_PIN_SEARCH_MAX_SESSIONS);
          const stored = new Map<string, PinIndexEntry[]>();
          const storedRead = await byokRaceSignal(indexStore.entriesFor(wanted), buildSignal);
          if (storedRead === undefined) budgetOnlyEnded();
          for (const entry of storedRead ?? []) {
            const list = stored.get(entry.sessionId) ?? [];
            list.push(entry);
            stored.set(entry.sessionId, list);
          }
          const entries: PinIndexEntry[] = [];
          for (const sessionId of wanted) {
            if (budgetOnlyEnded()) break;
            const session = await byokRaceSignal(source.session(sessionId), buildSignal);
            if (session === undefined) {
              // Checked after the await, before the comments read starts:
              // the turn's abort rejects here, the budget stops without a
              // new read.
              budgetOnlyEnded();
              break;
            }
            if (session === null) continue;
            const comments = await byokRaceSignal(source.comments(sessionId), buildSignal);
            if (comments === undefined) {
              budgetOnlyEnded();
              break;
            }
            const commentList = comments;
            const previous = new Map((stored.get(sessionId) ?? []).map((entry) => [entry.pinId, entry]));
            for (let index = 0; index < session.pins.length; index += 1) {
              if (budgetOnlyEnded()) break;
              const pin = session.pins[index]!;
              const pinId = session.pinIds[index]!;
              const entry = previous.get(pinId);
              // The indexing' own "current" rule (indexSession): the pin's
              // line still in place, the stored hash still the hash of the
              // stored text, the same number. Only such an entry's caption
              // is the caption of the current pin; otherwise the document
              // is built without a caption (no model call, BYOK).
              const caption =
                entry !== undefined &&
                entry.number === pin.number &&
                entry.caption !== null &&
                entry.caption !== "" &&
                sameSection(entry.docText, pin) &&
                (await pinDocumentHash(entry.docText)) === entry.docHash
                  ? { caption: entry.caption, ocr: "" }
                  : null;
              const doc = await buildPinDocument({
                caption,
                comments: commentList.get(pinId) ?? [],
                page: session.page,
                pin,
              });
              entries.push({
                caption: caption?.caption ?? null,
                docHash: doc.hash,
                docText: doc.text,
                model: "",
                number: pin.number,
                ocr: null,
                pinId,
                sessionId,
                truncated: doc.truncated,
                updatedAt: now().toISOString(),
                vector: null,
              });
            }
          }
          return entries;
        },
        async replaceSession() {
          throw new Error("the byok text pin search does not write the pin index");
        },
        async staleSessions() {
          // There is no index to be stale: the text store is the current
          // documents.
          return [];
        },
      };
      // The source searchPins reads (the preparation's listing and the hit
      // resolution): the same rule as the build — the wait ends on the
      // combined signal, and the check after the await rejects the turn's
      // abort (the gateway search's answer) or stops at the budget, which
      // starts no new read and answers with what was already resolved.
      const guardedSource: PinSource = {
        ...source,
        async listSessions(searchInput) {
          if (budgetOnlyEnded()) return [];
          const page = await byokRaceSignal(source.listSessions(searchInput), buildSignal);
          if (page === undefined) {
            budgetOnlyEnded();
            return [];
          }
          return page;
        },
        async session(id) {
          if (budgetOnlyEnded()) return null;
          const value = await byokRaceSignal(source.session(id), buildSignal);
          if (value === undefined) {
            budgetOnlyEnded();
            return null;
          }
          return value;
        },
      };
      // chat: null → no captions from the model; embedding: null → the
      // text-only ranking, which never fetches (searchPins embeds the
      // query only with an embedding endpoint).
      return searchPins({ chat: null, embedding: null, now, source: guardedSource, store }, { limit, query });
    },
  };
}

/**
 * The wait of a read the search starts (R2 review fix): it ends when the
 * combined signal aborts. A read the driver has already started may keep
 * going alone, but the search does not wait for it — the wait ends with
 * `undefined`, and the caller checks the signal after the await before
 * starting the next read (the turn's abort rejects with the caller's
 * reason — the gateway search's answer; the budget alone stops the search
 * with what it already resolved). The read's own failure still rejects.
 */
function byokRaceSignal<T>(read: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise<T | undefined>((resolve, reject) => {
    const onAbort = () => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    read.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** The abort's reason, the way the gateway search rejects (index.ts). */
function turnAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}
