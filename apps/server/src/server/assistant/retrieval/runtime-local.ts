// Pin indexing and search runtime of the local app (F3 contract §3.2,
// decisions A18 and A19).
//
// Endpoints: the chat endpoint is the configured one (ai.json, read like
// the rest of the local AI surface). detectRetrievalCapabilities reads its
// /models: the embedding endpoint is the same base URL and key with the
// detected embedding model, and vision uses the chat endpoint only when its
// model declares image input. Without a configured endpoint nothing is
// indexed and there is no pin search.
//
// Queue: every write that changes what a pin document holds (a session
// saved or patched, a pin added, edited or removed, a comment added, edited
// or removed) schedules its session. The session is indexed delayMs (2 s)
// after its last write, so edits close together become one indexing. All
// the work (queued sessions, the first-search pass and its background
// continuation) runs through one promise chain, so two indexings never run
// at the same time. A deleted session leaves the queue; its entries are
// already deleted with it (S2), and a session deleted while any job runs
// (a queued indexing, the first-search pass or its continuation) has its
// entries removed again when that job ends, so an indexing that was
// running for it cannot leave them behind. The queue lives in memory: an edit
// whose indexing had not run when the process exits reaches the index with
// the session's next write.
//
// Search: before searching, an indexStale pass (20 s budget, up to 500
// sessions) runs through the same chain the first time, again whenever the
// endpoint capabilities (the embedding endpoint's identity — model and,
// for a direct endpoint, its base URL — plus vision) change, and again
// after a pass chain that left work behind. When a pass leaves work behind, the
// chain runs up to LOCAL_PIN_INDEX_MAX_CONTINUATIONS more passes in the
// background, while a pass still indexes something. The turn's signal only
// keeps the search from starting a request after it aborts (the question's
// embedding); the passes in the chain run as they are.
//
// Trigger: attachLocalPinIndex wraps the history database object that
// historyDatabase() returns (api.local.ts). The routes, the local MCP at
// /api/mcp, the confirmed assistant proposals and the local AI routes all
// write through that object, so the wrapper is the single point that
// schedules sessions; closing the database stops its runtime.

import { readAiSettings, readAiSettingsMetadata } from "@pinar/cli/ai-settings";
import { pinarHome, shotsDir } from "@pinar/cli/paths";
import { localAiVault } from "../../ai/local-ai";
import { detectThinkingControl, type AssistantEndpoint } from "../models";
import { detectRetrievalCapabilities } from "./detect";
import {
  embeddingIdentity,
  indexSession,
  indexStale,
  searchPins,
  withAbortSignal,
  type PinIndexDeps,
  type PinIndexStore,
  type PinSearchService,
  type PinSource,
} from "./index";
import { localPinSource, type LocalPinSourceDatabase } from "./source-local";
import { localPinIndexStore, type LocalPinIndexDatabase } from "./store-local";

export const LOCAL_PIN_INDEX_DELAY_MS = 2_000;
export const LOCAL_PIN_INDEX_SEARCH_BUDGET_MS = 20_000;
export const LOCAL_PIN_INDEX_SEARCH_MAX_SESSIONS = 500;
// Background passes after a search pass that left work behind; a vision
// endpoint that keeps timing out could otherwise keep the chain busy.
export const LOCAL_PIN_INDEX_MAX_CONTINUATIONS = 10;

// ---------- configured endpoint ----------

type LocalAiSettings = Awaited<ReturnType<typeof readAiSettings>>;

// The configured endpoint of the local app, or null when the AI is not
// configured (mode disabled, or endpoint/model missing). The key only
// exists in byok mode: readAiSettings fills it from the vault only then.
export async function localAiSettings(root = pinarHome()): Promise<{ apiKey?: string; baseUrl: string; model: string } | null> {
  const settings: LocalAiSettings = await readAiSettings(root, localAiVault());
  if (settings.mode === "disabled" || !settings.endpoint || !settings.model) return null;
  return settings.apiKey
    ? { apiKey: settings.apiKey, baseUrl: settings.endpoint, model: settings.model }
    : { baseUrl: settings.endpoint, model: settings.model };
}

// The same decision as localAiSettings, read synchronously from ai.json
// without the vault.
export function localAiConfigured(root = pinarHome()): boolean {
  const settings = readAiSettingsMetadata(root);
  return settings.mode !== "disabled" && Boolean(settings.endpoint) && Boolean(settings.model);
}

// The chat endpoint of the local app (the assistant turn and vision).
export async function localAssistantEndpoint(input: { fetch?: typeof fetch; root?: string } = {}): Promise<AssistantEndpoint | null> {
  const settings = await localAiSettings(input.root);
  if (!settings) return null;
  const endpoint: AssistantEndpoint = {
    baseUrl: settings.baseUrl,
    kind: "openai-compatible",
    model: settings.model,
    thinkingControl: await detectThinkingControl({
      baseUrl: settings.baseUrl,
      model: settings.model,
      ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
      ...(input.fetch ? { fetch: input.fetch } : {}),
    }),
  };
  if (settings.apiKey) endpoint.apiKey = settings.apiKey;
  return endpoint;
}

// ---------- queue and search ----------

export interface PinIndexTimers {
  clear(handle: unknown): void;
  set(callback: () => void, ms: number): unknown;
}

export interface LocalPinIndexRuntimeDeps {
  delayMs?: number;
  // null → nothing is indexed and search fails
  endpoint: () => Promise<AssistantEndpoint | null>;
  fetch?: typeof fetch;
  now?: () => Date;
  source: PinSource;
  store: PinIndexStore;
  timers?: PinIndexTimers;
}

export interface LocalPinIndexRuntime {
  /** Drops a deleted session from the queue. */
  forget(sessionId: string): void;
  /** Settles once nothing is queued or running (timers still waiting are not awaited). */
  idle(): Promise<void>;
  /** Indexes the session delayMs after its last schedule, one session at a time. */
  schedule(sessionId: string): void;
  search: PinSearchService;
  /** Cancels the waiting timers; no new work starts afterwards. */
  stop(): void;
}

const realTimers: PinIndexTimers = {
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  set: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    // A waiting indexing never keeps the process alive.
    (timer as { unref?: () => void }).unref?.();
    return timer;
  },
};

export function createLocalPinIndexRuntime(deps: LocalPinIndexRuntimeDeps): LocalPinIndexRuntime {
  const delayMs = deps.delayMs ?? LOCAL_PIN_INDEX_DELAY_MS;
  const timers = deps.timers ?? realTimers;
  const now = deps.now ?? (() => new Date());
  const waiting = new Map<string, unknown>(); // sessionId → timer
  const queued = new Set<string>(); // fired, waiting for the chain
  const deletedDuringJob = new Set<string>();
  let busy = false;
  let tail: Promise<void> = Promise.resolve();
  // The search pass chain: its capabilities key, its promise, and whether
  // it ended with work left behind.
  let passKey: string | null = null;
  let pass: Promise<void> | null = null;
  let passLeftWork = false;
  let staleQueued = false;
  let stopped = false;

  // Runs the job after every job queued before it; a failing job never
  // breaks the chain, and its error is not logged. Sessions deleted while
  // the job ran lose whatever entries it wrote for them.
  function exclusive(job: () => Promise<void>): Promise<void> {
    const run = tail
      .then(async () => {
        busy = true;
        try {
          await job();
        } finally {
          busy = false;
          const deleted = [...deletedDuringJob];
          deletedDuringJob.clear();
          for (const sessionId of deleted) await deps.store.deleteSession(sessionId).catch(() => {});
        }
      })
      .catch(() => {});
    tail = run;
    return run;
  }

  // The pass key is the embedding endpoint's identity (model and, for a
  // direct endpoint, the base URL) plus vision: a URL change with the same
  // model starts a new pass, whose re-embedding brings the search back
  // (F5/S2 re-review fix).
  function capabilitiesKey(indexing: PinIndexDeps): string {
    const embedding = indexing.embedding;
    return `${embedding ? embeddingIdentity(embedding) : ""}\n${indexing.chat ? "vision" : ""}`;
  }

  async function indexDeps(): Promise<PinIndexDeps | null> {
    const endpoint = await deps.endpoint();
    if (!endpoint) return null;
    const capabilities = await detectRetrievalCapabilities({ endpoint, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
    return {
      chat: capabilities.vision ? endpoint : null,
      embedding: capabilities.embeddingModel
        ? { ...(endpoint.apiKey ? { apiKey: endpoint.apiKey } : {}), baseUrl: endpoint.baseUrl, model: capabilities.embeddingModel }
        : null,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      now,
      source: deps.source,
      store: deps.store,
    };
  }

  function enqueue(sessionId: string): void {
    if (stopped || queued.has(sessionId)) return;
    queued.add(sessionId);
    void exclusive(async () => {
      // Forgotten (deleted) while waiting for the chain.
      if (!queued.delete(sessionId) || stopped) return;
      const indexing = await indexDeps();
      if (indexing && !stopped) await indexSession(indexing, sessionId);
    });
  }

  // Background indexStale passes after a search pass left work behind,
  // while each pass still indexes some session, up to `left` more passes.
  // Work still left at the end makes the next search run a pass again.
  function continueStale(left: number): void {
    if (stopped || staleQueued) return;
    if (left <= 0) {
      passLeftWork = true;
      return;
    }
    staleQueued = true;
    void exclusive(async () => {
      staleQueued = false;
      if (stopped) return;
      const indexing = await indexDeps();
      if (!indexing || stopped) return;
      const result = await indexStale(indexing, {
        budgetMs: LOCAL_PIN_INDEX_SEARCH_BUDGET_MS,
        maxSessions: LOCAL_PIN_INDEX_SEARCH_MAX_SESSIONS,
      });
      if (!result.remaining) return;
      if (result.indexed > 0) continueStale(left - 1);
      else passLeftWork = true;
    });
  }

  return {
    forget(sessionId) {
      const timer = waiting.get(sessionId);
      if (timer !== undefined) {
        timers.clear(timer);
        waiting.delete(sessionId);
      }
      queued.delete(sessionId);
      if (busy) deletedDuringJob.add(sessionId);
    },

    async idle() {
      let current: Promise<void>;
      do {
        current = tail;
        await current;
      } while (current !== tail);
    },

    schedule(sessionId) {
      if (stopped) return;
      const previous = waiting.get(sessionId);
      if (previous !== undefined) timers.clear(previous);
      waiting.set(
        sessionId,
        timers.set(() => {
          waiting.delete(sessionId);
          enqueue(sessionId);
        }, delayMs),
      );
    },

    search: {
      async search({ limit, query, signal }) {
        signal?.throwIfAborted();
        const indexing = await indexDeps();
        if (!indexing) throw new Error("pin search unavailable");
        const key = capabilitiesKey(indexing);
        if (pass === null || passKey !== key || passLeftWork) {
          passKey = key;
          passLeftWork = false;
          pass = exclusive(async () => {
            if (stopped) return;
            const result = await indexStale(indexing, {
              budgetMs: LOCAL_PIN_INDEX_SEARCH_BUDGET_MS,
              maxSessions: LOCAL_PIN_INDEX_SEARCH_MAX_SESSIONS,
            });
            if (result.remaining) continueStale(LOCAL_PIN_INDEX_MAX_CONTINUATIONS);
          });
        }
        await pass;
        signal?.throwIfAborted();
        const searchFetch = withAbortSignal(indexing.fetch, signal);
        return searchPins({ ...indexing, ...(searchFetch ? { fetch: searchFetch } : {}) }, { limit, query });
      },
    },

    stop() {
      stopped = true;
      for (const timer of waiting.values()) timers.clear(timer);
      waiting.clear();
      queued.clear();
    },
  };
}

// ---------- the single write trigger ----------

type SessionWrite = (args: unknown[], result: unknown) => string | null;

function sessionArgument(args: unknown[]): string | null {
  return typeof args[0] === "string" ? args[0] : null;
}

// The history methods that change what a pin document holds, and the
// session each one wrote. moveSession, reorders and reviews change no
// document; deleteSession is handled apart.
const SESSION_WRITES = new Map<string, SessionWrite>([
  ["addPin", sessionArgument],
  ["addPinComment", sessionArgument],
  ["deletePin", (args, result) => (result === true ? sessionArgument(args) : null)],
  ["deletePinComment", sessionArgument],
  [
    "saveSession",
    (_args, result) => {
      const id = (result as { id?: unknown } | null)?.id;
      return typeof id === "string" ? id : null;
    },
  ],
  ["updatePinComment", sessionArgument],
  ["updatePinNote", sessionArgument],
  ["updateSession", (args, result) => (result ? sessionArgument(args) : null)],
]);

// Scheduling never breaks the write that triggered it.
function quietly(effect: () => void): void {
  try {
    effect();
  } catch {
    // The write already succeeded; the next write schedules again.
  }
}

/**
 * The database with its writes observed: after a write in SESSION_WRITES
 * succeeds, its session is scheduled; deleteSession forgets the session;
 * close stops the runtime first. Every other member is the original one.
 */
export function observePinIndexWrites<T extends object>(db: T, runtime: Pick<LocalPinIndexRuntime, "forget" | "schedule" | "stop">): T {
  return new Proxy(db, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof value !== "function") return value;
      const write = SESSION_WRITES.get(property);
      if (write) {
        return (...args: unknown[]) => {
          const result: unknown = Reflect.apply(value, target, args);
          quietly(() => {
            const sessionId = write(args, result);
            if (sessionId) runtime.schedule(sessionId);
          });
          return result;
        };
      }
      if (property === "deleteSession") {
        return (...args: unknown[]) => {
          const result: unknown = Reflect.apply(value, target, args);
          quietly(() => {
            const sessionId = sessionArgument(args);
            if (sessionId) runtime.forget(sessionId);
          });
          return result;
        };
      }
      if (property === "close") {
        return (...args: unknown[]) => {
          quietly(() => runtime.stop());
          return Reflect.apply(value, target, args);
        };
      }
      return value;
    },
  });
}

export type LocalPinIndexHistory = LocalPinIndexDatabase & LocalPinSourceDatabase;

export interface LocalPinIndexTestOptions {
  delayMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
  timers?: PinIndexTimers;
}

const runtimes = new WeakMap<object, LocalPinIndexRuntime>();
let testOptions: LocalPinIndexTestOptions | null = null;

/**
 * Gives the history database of `root` its pin index runtime and returns the
 * observed database (the object historyDatabase() hands out).
 */
export function attachLocalPinIndex<T extends LocalPinIndexHistory>(db: T, root: string): T {
  const options = testOptions;
  const runtime = createLocalPinIndexRuntime({
    ...(options?.delayMs !== undefined ? { delayMs: options.delayMs } : {}),
    endpoint: () => localAssistantEndpoint({ root, ...(options?.fetch ? { fetch: options.fetch } : {}) }),
    ...(options?.fetch ? { fetch: options.fetch } : {}),
    ...(options?.now ? { now: options.now } : {}),
    source: localPinSource(db, shotsDir(root)),
    store: localPinIndexStore(db),
    ...(options?.timers ? { timers: options.timers } : {}),
  });
  const observed = observePinIndexWrites(db, runtime);
  runtimes.set(observed, runtime);
  return observed;
}

/** The runtime of an observed history database (tests and the pin search). */
export function localPinIndexRuntime(db: object): LocalPinIndexRuntime | undefined {
  return runtimes.get(db);
}

/** The pin search of an observed history database. */
export function localPinSearch(db: object): PinSearchService | undefined {
  return runtimes.get(db)?.search;
}

// Test hook: options for the runtimes attached from now on (null restores
// the real fetch, clock and timers).
export function setLocalPinIndexOptionsForTests(options: LocalPinIndexTestOptions | null): void {
  testOptions = options;
}
