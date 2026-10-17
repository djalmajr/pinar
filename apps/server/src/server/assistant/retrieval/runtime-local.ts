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
// already deleted with it (S2), and an indexing that was running for it has
// its entries removed when it ends. The queue lives in memory: an edit
// whose indexing had not run when the process exits reaches the index with
// the session's next write.
//
// Search: the first search of the runtime runs indexStale (20 s budget, up
// to 500 sessions) through the same chain, then searchPins. When that pass
// leaves work behind, the chain keeps running indexStale passes in the
// background while a pass still indexes something.
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
  indexSession,
  indexStale,
  searchPins,
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
  const deletedWhileRunning = new Set<string>();
  let running: string | null = null;
  let tail: Promise<void> = Promise.resolve();
  let firstPass: Promise<void> | null = null;
  let staleQueued = false;
  let stopped = false;

  // Runs the job after every job queued before it; a failing job never
  // breaks the chain, and its error is not logged.
  function exclusive(job: () => Promise<void>): Promise<void> {
    const run = tail.then(job).catch(() => {});
    tail = run;
    return run;
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
      running = sessionId;
      try {
        const indexing = await indexDeps();
        if (indexing && !stopped) await indexSession(indexing, sessionId);
      } finally {
        running = null;
        if (deletedWhileRunning.delete(sessionId)) await deps.store.deleteSession(sessionId);
      }
    });
  }

  // Background indexStale passes after a first-search pass left work
  // behind, while each pass still indexes some session.
  function continueStale(): void {
    if (stopped || staleQueued) return;
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
      if (result.remaining && result.indexed > 0) continueStale();
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
      if (running === sessionId) deletedWhileRunning.add(sessionId);
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
      async search(input) {
        const indexing = await indexDeps();
        if (!indexing) throw new Error("pin search unavailable");
        firstPass ??= exclusive(async () => {
          if (stopped) return;
          const result = await indexStale(indexing, {
            budgetMs: LOCAL_PIN_INDEX_SEARCH_BUDGET_MS,
            maxSessions: LOCAL_PIN_INDEX_SEARCH_MAX_SESSIONS,
          });
          if (result.remaining) continueStale();
        });
        await firstPass;
        return searchPins(indexing, input);
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
