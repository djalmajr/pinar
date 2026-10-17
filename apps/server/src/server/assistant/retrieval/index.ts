// Pin indexing and search (F3 contract §1.4, decisions A16 to A18).
//
// indexSession rebuilds the index entries of one session from a PinSource
// and replaces them in a PinIndexStore in one write:
// - captions come from one vision call per session (vision.ts), only when
//   there is a chat endpoint and a screenshot and some pin has no caption
//   yet or the list of numbers and comments changed; otherwise the stored
//   caption of each unchanged pin is reused. A failed vision call leaves
//   the captions missing, so the next indexing retries it. Pins the model
//   did not describe get an empty caption, which is not retried, and so
//   does every pin of a session without a screenshot;
// - only documents whose hash changed (or that have no vector of the
//   current embedding model) are embedded; without an embedding endpoint
//   the entries are text-only (vector null, model "").
//
// indexStale indexes, among the accessible sessions, the ones staleSessions
// returns and then the ones with an entry that lags behind the current
// endpoints (no vector of the current embedding model, or a null caption
// while there is a vision endpoint), up to maxSessions. It starts no new
// session once budgetMs has passed (a session already running finishes),
// nor once its signal is aborted; the requests themselves are cut by the
// fetch the runtime gives it (withAbortSignal). Entries it writes are
// stamped no earlier than the session's listed updatedAt, so a session
// dated in the future (a skewed clock, a client timestamp) is not stale
// again on every pass. The stores compare times as text, so every listed
// updatedAt is first made canonical (canonicalTime): the same instant in
// ISO UTC, whatever offset or format the source used.
//
// searchPins ranks the entries of the PIN_SEARCH_MAX_SESSIONS most recent
// accessible sessions by cosine against the embedded query, or by a text
// score without an embedding endpoint or when embedding the query fails.
// Entries of sessions outside listSessions are dropped even when the store
// returns them, and every hit is resolved through source.session, so a
// session the source no longer returns, or a pin no longer in it, never
// becomes a hit.

import { buildPinDocument, pinDocumentHash, PIN_SECTION_LINE, pinSectionText, type PinDocumentInput } from "./document";
import { cosine, decodeVector, embedTexts, encodeVector, type EmbeddingEndpoint } from "./embeddings";
import { captionSessionPins, type VisionEndpoint } from "./vision";
import type { PinIndexEntry, PinIndexStore } from "./types";

export const PIN_SEARCH_MAX_SESSIONS = 500;
export const PIN_SEARCH_MAX_LIMIT = 50;
const SESSION_PAGE_SIZE = 100;

export interface PinSource {
  /** Sessions whose pins the principal can see (owner + accepted collaborations), newest first. */
  listSessions(input: { limit: number; offset: number }): Promise<Array<{ id: string; updatedAt: string }>>;
  session(id: string): Promise<{ id: string; page: { title: string; url: string }; pins: PinDocumentInput["pin"][]; pinIds: string[] } | null>;
  comments(sessionId: string): Promise<Map<string, Array<{ author: string; body: string }>>>; // by pinId
  shot(sessionId: string): Promise<{ bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" } | null>;
}

export type { PinIndexEntry, PinIndexStore } from "./types";

export interface PinIndexDeps {
  chat: VisionEndpoint | null; // null or no image input → no captions
  embedding: EmbeddingEndpoint | null; // null → text-only entries
  fetch?: typeof fetch;
  now: () => Date;
  source: PinSource;
  store: PinIndexStore;
}

export interface PinSearchHit {
  caption: string | null;
  comment: string;
  number: number;
  pinId: string;
  score: number;
  sessionId: string;
  sessionTitle: string;
  url: string;
}

/**
 * A runtime's pin search: its lazy indexing, then searchPins (contract
 * §3.1). `signal` is the assistant turn's: once it aborts, the search starts
 * no new request.
 */
export interface PinSearchService {
  search(input: { limit: number; query: string; signal?: AbortSignal }): Promise<PinSearchHit[]>;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

/**
 * The fetch (or the global one when absent) bound to `signal`: once the
 * signal is aborted no request starts, and a request in flight is cut (its
 * own signal is combined with this one) and rejected at once, even by a
 * fetch that ignores its signal. Without a signal the fetch is unchanged.
 */
export function withAbortSignal(fetchFn: typeof fetch | undefined, signal: AbortSignal | undefined): typeof fetch | undefined {
  if (!signal) return fetchFn;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (signal.aborted) throw abortReason(signal);
    const combined = init?.signal ? AbortSignal.any([init.signal, signal]) : signal;
    const target = fetchFn ?? globalThis.fetch;
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      target(input, { ...init, signal: combined })
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", onAbort));
    });
  }) as typeof fetch;
}

type Caption = { caption: string; ocr: string };

// The stored document still has the pin's "Pin #n: comment" line in its
// fixed place. Values are written on one line, so no other text can fill
// that place.
function sameSection(docText: string, pin: PinDocumentInput["pin"]): boolean {
  return docText.split("\n")[PIN_SECTION_LINE] === pinSectionText(pin);
}

export async function indexSession(
  deps: PinIndexDeps,
  sessionId: string,
  // the session's listed updatedAt: entries are stamped no earlier
  // (canonical, see canonicalTime)
  options: { notBefore?: string } = {},
): Promise<{ captioned: boolean; embedded: number; pins: number }> {
  // Read before the session, so an edit mark that arrives while this
  // indexing runs is newer than the one it clears.
  const readMark = deps.store.readMark ? await deps.store.readMark(sessionId) : undefined;
  const session = await deps.source.session(sessionId);
  if (!session) return { captioned: false, embedded: 0, pins: 0 };
  const { pinIds, pins } = session;
  if (pinIds.length !== pins.length) throw new Error("pin source returned mismatched pins");
  const previous = new Map((await deps.store.entries(sessionId)).map((entry) => [entry.pinId, entry]));
  const comments = await deps.source.comments(sessionId);

  // An entry is current only when its text is of this renderer's format
  // (its hash matches) and still has the pin's line.
  const unchanged = await Promise.all(
    pins.map(async (pin, index) => {
      const entry = previous.get(pinIds[index]!);
      if (entry === undefined || entry.number !== pin.number || !sameSection(entry.docText, pin)) return false;
      return (await pinDocumentHash(entry.docText)) === entry.docHash;
    }),
  );
  const listChanged = previous.size !== pins.length || unchanged.includes(false);
  const missingCaption = pinIds.some((pinId) => previous.get(pinId)?.caption == null);

  let fresh: Map<number, Caption> | null = null;
  let captioned = false;
  if (deps.chat && pins.length > 0 && (listChanged || missingCaption)) {
    const shot = await deps.source.shot(sessionId);
    if (!shot) {
      // The screenshot is stored with the session, so a session without one
      // never gets captions: empty captions mark them done, not pending.
      fresh = new Map();
    } else {
      try {
        const result = await captionSessionPins({
          endpoint: deps.chat,
          fetch: deps.fetch,
          image: shot,
          pins: pins.map((pin) => ({ comment: pin.comment, number: pin.number })),
        });
        fresh = new Map(result.map((item) => [item.number, { caption: item.caption, ocr: item.ocr }]));
        captioned = result.length > 0;
      } catch {
        fresh = null;
      }
    }
  }

  const captions: Array<Caption | null> = pins.map((pin, index) => {
    if (fresh) return fresh.get(pin.number) ?? { caption: "", ocr: "" };
    const entry = previous.get(pinIds[index]!);
    if (!unchanged[index] || entry?.caption == null) return null;
    return { caption: entry.caption, ocr: entry.ocr ?? "" };
  });

  const docs = await Promise.all(
    pins.map((pin, index) =>
      buildPinDocument({ caption: captions[index]!, comments: comments.get(pinIds[index]!) ?? [], page: session.page, pin }),
    ),
  );

  const embedding = deps.embedding;
  const vectors = new Map<number, Uint8Array>();
  let embedded = 0;
  if (embedding) {
    const pending = docs.flatMap((doc, index) => {
      const entry = previous.get(pinIds[index]!);
      const current = entry !== undefined && entry.docHash === doc.hash && entry.vector !== null && entry.model === embedding.model;
      if (current) vectors.set(index, entry.vector!);
      return current ? [] : [index];
    });
    if (pending.length > 0) {
      const result = await embedTexts({ endpoint: embedding, fetch: deps.fetch, kind: "document", texts: pending.map((index) => docs[index]!.text) });
      pending.forEach((index, position) => vectors.set(index, encodeVector(result[position]!)));
    }
    embedded = pending.length;
  }

  const now = deps.now();
  const notBefore = options.notBefore === undefined ? Number.NaN : Date.parse(options.notBefore);
  const updatedAt = notBefore > now.getTime() ? new Date(notBefore).toISOString() : now.toISOString();
  const entries: PinIndexEntry[] = pins.map((pin, index) => ({
    caption: captions[index]?.caption ?? null,
    docHash: docs[index]!.hash,
    docText: docs[index]!.text,
    model: embedding?.model ?? "",
    number: pin.number,
    ocr: captions[index]?.ocr ?? null,
    pinId: pinIds[index]!,
    sessionId,
    truncated: docs[index]!.truncated,
    updatedAt,
    vector: vectors.get(index) ?? null,
  }));
  await deps.store.replaceSession(sessionId, entries, ...(readMark === undefined ? [] : [{ readMark }]));
  return { captioned, embedded, pins: entries.length };
}

// The PIN_SEARCH_MAX_SESSIONS most recent accessible sessions, newest
// first, without duplicates.
async function accessibleSessions(source: PinSource): Promise<Array<{ id: string; updatedAt: string }>> {
  const sessions: Array<{ id: string; updatedAt: string }> = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < PIN_SEARCH_MAX_SESSIONS; offset += SESSION_PAGE_SIZE) {
    const limit = Math.min(SESSION_PAGE_SIZE, PIN_SEARCH_MAX_SESSIONS - offset);
    const page = await source.listSessions({ limit, offset });
    for (const session of page.slice(0, limit)) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      sessions.push(session);
    }
    if (page.length < limit) break;
  }
  return sessions;
}

// Sessions, in the given order, with an entry that lags behind the current
// endpoints: no vector of the current embedding model, or a caption still
// null while there is a vision endpoint ("" means vision already ran). One
// entriesFor read over all the given sessions.
async function laggingSessions(deps: PinIndexDeps, sessionIds: string[]): Promise<string[]> {
  const { chat, embedding } = deps;
  if ((!chat && !embedding) || sessionIds.length === 0) return [];
  const lagging = new Set<string>();
  for (const entry of await deps.store.entriesFor(sessionIds)) {
    const noVector = embedding !== null && (entry.vector === null || entry.model !== embedding.model);
    const noCaption = chat !== null && entry.caption === null;
    if (noVector || noCaption) lagging.add(entry.sessionId);
  }
  return sessionIds.filter((id) => lagging.has(id));
}

// The latest time that still sorts as text in ISO form (toISOString of a
// later year starts with "+").
const LATEST_TIME = Date.parse("9999-12-31T23:59:59.999Z");

// A listed updatedAt as the same instant in ISO UTC, so the stores' text
// comparison orders it right against the entries' stamps. An unreadable
// time counts as the epoch: the session is indexed once and is stale again
// only through its writes or a lagging entry.
export function canonicalTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return new Date(0).toISOString();
  return new Date(Math.min(time, LATEST_TIME)).toISOString();
}

export async function indexStale(
  deps: PinIndexDeps,
  input: { budgetMs: number; maxSessions: number; signal?: AbortSignal },
): Promise<{ indexed: number; remaining: boolean }> {
  const startedAt = deps.now().getTime();
  const maxSessions = Math.max(0, Math.trunc(input.maxSessions));
  const sessions = (await accessibleSessions(deps.source)).map((session) => ({
    id: session.id,
    updatedAt: canonicalTime(session.updatedAt),
  }));
  const ids = sessions.map((session) => session.id);
  const accessible = new Set(ids);
  const stale = (await deps.store.staleSessions({ limit: maxSessions + 1, sessions })).filter((id) => accessible.has(id));
  // Changed sessions first, then the lagging ones, newest first.
  const pending = [...new Set([...stale, ...(await laggingSessions(deps, ids))])];
  const listedAt = new Map(sessions.map((session) => [session.id, session.updatedAt]));
  let indexed = 0;
  let remaining = pending.length > maxSessions;
  for (const sessionId of pending.slice(0, maxSessions)) {
    if (input.signal?.aborted || deps.now().getTime() - startedAt >= input.budgetMs) {
      remaining = true;
      break;
    }
    try {
      await indexSession(deps, sessionId, { notBefore: listedAt.get(sessionId) });
      indexed += 1;
    } catch {
      // The session stays stale and is retried by the next pass.
      remaining = true;
    }
  }
  return { indexed, remaining };
}

function terms(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term !== "");
}

// Share of the query's distinct terms found in the document, in [0, 1].
function textScore(queryTerms: Set<string>, docText: string): number {
  const docTerms = new Set(terms(docText));
  let found = 0;
  for (const term of queryTerms) if (docTerms.has(term)) found += 1;
  return found / queryTerms.size;
}

export async function searchPins(deps: PinIndexDeps, input: { limit: number; query: string }): Promise<PinSearchHit[]> {
  if (!Number.isFinite(input.limit)) throw new RangeError("invalid search limit");
  const limit = Math.min(PIN_SEARCH_MAX_LIMIT, Math.max(1, Math.trunc(input.limit)));
  const query = input.query.trim();
  if (query === "") return [];
  const sessions = await accessibleSessions(deps.source);
  if (sessions.length === 0) return [];
  const order = new Map(sessions.map((session, index) => [session.id, index]));
  const entries = (await deps.store.entriesFor([...order.keys()])).filter((entry) => order.has(entry.sessionId));

  // Without an embedding endpoint, or when embedding the query fails, the
  // ranking is textual.
  let queryVector: number[] | null = null;
  const embedding = deps.embedding;
  if (embedding) {
    try {
      const vectors = await embedTexts({ endpoint: embedding, fetch: deps.fetch, kind: "query", texts: [query] });
      queryVector = vectors[0] ?? null;
    } catch {
      queryVector = null;
    }
  }
  let scored: Array<{ entry: PinIndexEntry; score: number }>;
  if (embedding && queryVector) {
    const vector = queryVector;
    scored = entries
      .filter((entry) => entry.vector !== null && entry.model === embedding.model)
      .map((entry) => ({ entry, score: cosine(vector, decodeVector(entry.vector!)) }));
  } else {
    const queryTerms = new Set(terms(query));
    if (queryTerms.size === 0) return [];
    scored = entries.map((entry) => ({ entry, score: textScore(queryTerms, entry.docText) })).filter((item) => item.score > 0);
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      order.get(a.entry.sessionId)! - order.get(b.entry.sessionId)! ||
      a.entry.number - b.entry.number,
  );

  const hits: PinSearchHit[] = [];
  const resolved = new Map<string, Awaited<ReturnType<PinSource["session"]>>>();
  for (const { entry, score } of scored) {
    if (hits.length >= limit) break;
    if (!resolved.has(entry.sessionId)) resolved.set(entry.sessionId, await deps.source.session(entry.sessionId));
    const session = resolved.get(entry.sessionId);
    if (!session) continue;
    const index = session.pinIds.indexOf(entry.pinId);
    const pin = index >= 0 ? session.pins[index] : undefined;
    if (!pin) continue;
    hits.push({
      caption: entry.caption || null,
      comment: pin.comment,
      number: pin.number,
      pinId: entry.pinId,
      score,
      sessionId: entry.sessionId,
      sessionTitle: session.page.title,
      url: session.page.url,
    });
  }
  return hits;
}
