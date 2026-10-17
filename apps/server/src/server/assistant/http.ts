// Generic HTTP layer for the assistant routes (contract sections 2 and 5).
//
// Both runtimes (local app and Cloud) serve the same routes under
// /api/assistant/ through handleAssistantRequest; the runtime-specific
// pieces (store, status, endpoint, toolHost, optional model and rate
// limit) arrive via AssistantRequestDeps. Errors outside the stream are
// JSON { error, code }; inside the stream the client only ever sees the
// AssistantErrorCode (runAssistantTurn keeps the boundary clean).
//
// Turn order (contract section 5): status → body validation → rate limit
// → thread (create or fetch) → one-turn-per-thread gate → persist the user
// message → endpoint → runAssistantTurn → persist the assistant answer
// when the outcome settles and release the thread.

import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { ASSISTANT_SYSTEM_PROMPT } from "./prompt";
import {
  assistantLanguageModel,
  assistantProviderOptions,
  type AssistantEndpoint,
} from "./models";
import {
  ASSISTANT_THREAD_ID_PATTERN,
  assistantThreadTitle,
  newAssistantMessageId,
  newAssistantThreadId,
  type AssistantStore,
  type AssistantThread,
} from "./store";
import {
  buildTurnWindow,
  runAssistantTurn,
  type AssistantHistoryEntry,
} from "./turn";
import {
  buildAssistantToolSet,
  type AssistantToolHost,
} from "./tools";
import type { AssistantSurface, AssistantToolKind } from "./tool-policy";

export type AssistantStatusReason = "not_configured" | "requires_pro" | "disabled";

export interface AssistantStatus {
  available: boolean;
  reason: AssistantStatusReason | null;
}

export interface AssistantRequestDeps {
  // null → 503 assistant_unavailable
  endpoint(): Promise<AssistantEndpoint | null>;
  // passed through to assistantLanguageModel (tests)
  fetch?: typeof fetch;
  // test substitute for the real language model
  model?: (endpoint: AssistantEndpoint, context: { conversationId: string; requestId: string }) => LanguageModel;
  now?: () => Date;
  // false → 429 assistant_rate_limited
  rateLimitTurn?: () => Promise<boolean>;
  status(): Promise<AssistantStatus>;
  store: AssistantStore;
  surface: AssistantSurface;
  toolHost: AssistantToolHost;
}

// Turn body ceiling (contract section 2: body above 64 KB → 400).
const TURN_BODY_MAX_BYTES = 64 * 1024;
// Trimmed question length range.
const TURN_TEXT_MIN = 1;
const TURN_TEXT_MAX = 8_000;
// GET /api/assistant/threads pagination (limit 1..50, default 20, offset ≥ 0).
const THREADS_LIMIT_DEFAULT = 20;
const THREADS_LIMIT_MAX = 50;
// Newest messages returned by GET /api/assistant/threads/:id.
const THREAD_DETAIL_MESSAGES = 200;
// Store ceiling for the history window of a turn.
const TURN_HISTORY_LIMIT = 50;

// The read-only assistant only exposes the "read" tools of its surface.
const TURN_TOOL_KINDS: readonly AssistantToolKind[] = ["read"];

// One turn per thread at a time, per process (contract section 5, step 5).
const inFlightTurnThreads = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assistantJson(value: unknown, status = 200): Response {
  return Response.json(value, { headers: { "Cache-Control": "no-store" }, status });
}

function assistantError(status: number, code: string, error: string): Response {
  return assistantJson({ code, error }, status);
}

// The SDK stream response says `Cache-Control: no-cache`; assistant answers
// are private and must not be stored at all. The other SSE headers stay.
function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText });
}

// Reads the request body without buffering more than maxBytes: once the
// limit is exceeded the read stops and null is returned (400 at the
// caller). null body (no content) reads as "".
async function readLimitedBody(request: Request, maxBytes: number): Promise<string | null> {
  const body = request.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(combined);
}

export function isAssistantPath(pathname: string): boolean {
  return pathname === "/api/assistant" || pathname.startsWith("/api/assistant/");
}

// The defined "server cannot serve" answer. Used for any failure outside the
// stream, so no exception (store, status, endpoint, deps) crosses the
// boundary or reaches a log with its message.
export function assistantUnavailableResponse(): Response {
  return assistantError(503, "assistant_unavailable", "The assistant is unavailable");
}

export async function handleAssistantRequest(request: Request, deps: AssistantRequestDeps): Promise<Response | null> {
  if (!isAssistantPath(new URL(request.url).pathname)) return null;
  try {
    return await routeAssistantRequest(request, deps);
  } catch {
    // Swallowed on purpose: the original error may carry internals.
    return assistantUnavailableResponse();
  }
}

function routeAssistantRequest(request: Request, deps: AssistantRequestDeps): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const { method } = request;
  if (method === "GET" && pathname === "/api/assistant/status") return statusRoute(deps);
  if (method === "POST" && pathname === "/api/assistant/turn") return turnRoute(request, deps);
  if (method === "GET" && pathname === "/api/assistant/threads") return listThreadsRoute(url, deps);
  if (method === "GET" || method === "DELETE") {
    const threadId = threadIdFromPath(pathname);
    if (threadId !== null) return method === "GET" ? threadRoute(deps, threadId) : deleteThreadRoute(deps, threadId);
  }
  // Wrong method, an undecodable thread id, or an unknown sub-path inside
  // the assistant namespace. Thread-shaped paths use the defined 404 code;
  // everything else reports the generic validation code.
  const code = isThreadShapedPath(pathname) ? "thread_not_found" : "invalid_request";
  return Promise.resolve(assistantError(404, code, "Not found"));
}

function isThreadShapedPath(pathname: string): boolean {
  return /^\/api\/assistant\/threads\/[^/]*$/.test(pathname);
}

// The path segment of /api/assistant/threads/:id, or null when the path has
// another shape or the segment is empty (decode failures keep null so the
// caller 404s).
function threadIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/assistant\/threads\/([^/]*)$/);
  if (!match || match[1] === "") return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function statusRoute(deps: AssistantRequestDeps): Promise<Response> {
  const status = await deps.status();
  return assistantJson({ available: status.available, reason: status.reason, surface: deps.surface });
}

async function listThreadsRoute(url: URL, deps: AssistantRequestDeps): Promise<Response> {
  const page = parseThreadsPagination(url);
  if (!page) return assistantError(400, "invalid_request", "Invalid pagination");
  const threads = await deps.store.listThreads(page);
  return assistantJson({ threads });
}

// limit: 1..50 (default 20); offset: integer ≥ 0. Missing params use the
// defaults; anything else (NaN, out of range, non-integer) is invalid.
function parseThreadsPagination(url: URL): { limit: number; offset: number } | null {
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const limit = limitParam === null ? THREADS_LIMIT_DEFAULT : Number(limitParam);
  const offset = offsetParam === null ? 0 : Number(offsetParam);
  if (!Number.isInteger(limit) || limit < TURN_TEXT_MIN || limit > THREADS_LIMIT_MAX) return null;
  if (!Number.isInteger(offset) || offset < 0) return null;
  return { limit, offset };
}

async function threadRoute(deps: AssistantRequestDeps, id: string): Promise<Response> {
  if (!ASSISTANT_THREAD_ID_PATTERN.test(id)) {
    return assistantError(404, "thread_not_found", "Thread not found");
  }
  const thread = await deps.store.getThread(id);
  if (!thread) return assistantError(404, "thread_not_found", "Thread not found");
  const messages = await deps.store.listMessages(id, { limit: THREAD_DETAIL_MESSAGES });
  return assistantJson({ messages, thread });
}

async function deleteThreadRoute(deps: AssistantRequestDeps, id: string): Promise<Response> {
  if (!ASSISTANT_THREAD_ID_PATTERN.test(id)) {
    return assistantError(404, "thread_not_found", "Thread not found");
  }
  const deleted = await deps.store.deleteThread(id);
  return deleted ? assistantJson({ ok: true }) : assistantError(404, "thread_not_found", "Thread not found");
}

async function turnRoute(request: Request, deps: AssistantRequestDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();

  // 1. Unavailable status: requires_pro → 403, the rest → 503.
  const status = await deps.status();
  if (!status.available) {
    if (status.reason === "requires_pro") {
      return assistantError(403, "assistant_requires_pro", "The assistant requires a Pro plan");
    }
    return assistantError(503, "assistant_unavailable", "The assistant is unavailable");
  }

  // 2. Body validation: 64 KB ceiling (read with the limit), an object with
  //    a trimmed text of 1..8,000 characters, and a threadId (when present)
  //    that matches ASSISTANT_THREAD_ID_PATTERN.
  const raw = await readLimitedBody(request, TURN_BODY_MAX_BYTES);
  if (raw === null) return assistantError(400, "invalid_request", "Request body too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return assistantError(400, "invalid_request", "Invalid request body");
  }
  if (!isRecord(parsed)) return assistantError(400, "invalid_request", "Invalid request body");
  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (text.length < TURN_TEXT_MIN || text.length > TURN_TEXT_MAX) {
    return assistantError(400, "invalid_request", "Invalid request body");
  }
  let threadId: string | null = null;
  if (parsed.threadId !== undefined) {
    if (typeof parsed.threadId !== "string" || !ASSISTANT_THREAD_ID_PATTERN.test(parsed.threadId)) {
      return assistantError(400, "invalid_request", "Invalid request body");
    }
    threadId = parsed.threadId;
  }

  // 3. Rate limit (absent on the local app).
  if (deps.rateLimitTurn && !(await deps.rateLimitTurn())) {
    return assistantError(429, "assistant_rate_limited", "Too many questions in a short time");
  }

  // 4. Existing threads must exist; new threads get a fresh id and a title
  //    derived from the question.
  let thread: AssistantThread;
  if (threadId) {
    const existing = await deps.store.getThread(threadId);
    if (!existing) return assistantError(404, "thread_not_found", "Thread not found");
    thread = existing;
  } else {
    thread = await deps.store.createThread({
      id: newAssistantThreadId(),
      now: stamp(),
      title: assistantThreadTitle(text),
    });
  }

  // 5. One turn per thread at a time.
  if (inFlightTurnThreads.has(thread.id)) {
    return assistantError(409, "turn_in_progress", "A turn is already in progress for this thread");
  }
  inFlightTurnThreads.add(thread.id);

  try {
    // 6. The user message is persisted before the model, then the history
    //    (final messages only, the new question included) is cut to the
    //    turn window.
    await deps.store.appendMessage({
      createdAt: stamp(),
      errorCode: null,
      id: newAssistantMessageId(),
      role: "user",
      status: "final",
      text,
      threadId: thread.id,
    });
    const recent = await deps.store.listMessages(thread.id, { limit: TURN_HISTORY_LIMIT });
    const history: AssistantHistoryEntry[] = recent
      .filter((message) => message.status === "final")
      .map((message) => ({ role: message.role, text: message.text }));

    // 7. Endpoint, model and tools; the streamed response goes back to the
    //    client right away.
    const endpoint = await deps.endpoint();
    if (!endpoint) {
      inFlightTurnThreads.delete(thread.id);
      return assistantError(503, "assistant_unavailable", "The assistant is unavailable");
    }
    const requestId = randomUUID();
    const conversationId = thread.id;
    const model = deps.model
      ? deps.model(endpoint, { conversationId, requestId })
      : assistantLanguageModel(endpoint, { conversationId, fetch: deps.fetch, requestId });
    const { outcome, response } = runAssistantTurn({
      history: buildTurnWindow(history),
      model,
      providerOptions: assistantProviderOptions(endpoint),
      system: ASSISTANT_SYSTEM_PROMPT,
      thread: { id: thread.id, title: thread.title },
      tools: buildAssistantToolSet({
        host: deps.toolHost,
        kinds: TURN_TOOL_KINDS,
        surface: deps.surface,
      }),
    });

    // 8. The assistant answer is persisted when the outcome settles (final
    //    text or the error code), and the thread is released either way.
    //    A persistence failure is swallowed; nothing is logged, so no
    //    provider content can leak.
    outcome
      .then(async (result) => {
        try {
          await deps.store.appendMessage({
            createdAt: stamp(),
            errorCode: result.kind === "error" ? result.code : null,
            id: newAssistantMessageId(),
            role: "assistant",
            status: result.kind === "final" ? "final" : "error",
            text: result.kind === "final" ? result.text : "",
            threadId: thread.id,
          });
        } catch {
          // Swallowed on purpose (contract 5.8).
        }
      })
      .catch(() => {})
      .finally(() => {
        inFlightTurnThreads.delete(thread.id);
      });

    return withNoStore(response);
  } catch {
    inFlightTurnThreads.delete(thread.id);
    // Store or endpoint failures surface with the defined unavailable code;
    // the original error (which may carry internals) never crosses the
    // boundary.
    return assistantUnavailableResponse();
  }
}
