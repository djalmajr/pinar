// One streaming chat completion against an OpenAI-compatible endpoint.
//
// Contract honored (appliance):
//   - POST {base}/chat/completions, stream: true, stream_options.include_usage;
//   - baseUrl must be HTTPS (validated here, not only in the CLI);
//   - X-Conversation-Id stable per case run, X-Request-Id (UUID) per request;
//   - on 503: respect Retry-After (seconds or an HTTP date) and retry up to
//     3 times, only when nothing of the stream has arrived;
//   - a POST that already started answering is never repeated;
//   - request body strictly below 16 MiB, checked before any request;
//   - redirect: "error".
//
// Stream termination:
//   - explicit end = a `finish_reason` or the `[DONE]` marker;
//   - on `[DONE]` the reader is cancelled (F7): nothing is read after the
//     marker, so a late transport error or a connection left open cannot
//     hang or fail an already-completed answer;
//   - a stream that reaches EOF without an explicit end, or with an invalid
//     JSON event, is a sanitized protocol error; once the stream has started
//     there is never a retry.
//
// Key hygiene: the API key only goes in the Authorization header. Every
// boundary is redacted: the HTTP error detail (error.type/error.code, which
// an appliance could fill with the key), the streamed text and tool-call
// payloads (an appliance could echo the key into the stream), and transport
// errors, which are normalized to a fixed message with a type. The value of
// the key never travels in messages, structured fields, exceptions, run
// errors or reports.

import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatStreamResult, LlmToolDef, ParsedToolCall, UsageInfo } from "./types";

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_RETRY_AFTER_MS = 500;
const REDACTED = "***";

export class BenchHttpError extends Error {
  readonly detail: string;
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`HTTP ${status}${detail ? ` (${detail})` : ""}`);
    this.detail = detail;
    this.name = "BenchHttpError";
    this.status = status;
  }
}

export class BenchProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchProtocolError";
  }
}

// Sanitized transport failure (fetch or mid-stream read). The original
// exception message is discarded: an appliance or proxy can echo the API key
// into a network error, and it must not travel.
export class BenchTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchTransportError";
  }
}

export interface BenchClientOptions {
  apiKey: string;
  baseUrl: string;
  conversationId: string;
  delayImpl?: (ms: number) => Promise<void>;
  // Injectable for tests; the default is the global fetch.
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  // Retries after the first attempt when the appliance answers 503.
  maxRetries?: number;
  messages: ChatMessage[];
  model: string;
  // undefined keeps the field out of the body (omit).
  parallelToolCalls?: boolean;
  requestIdFactory?: () => string;
  thinking?: "off" | "omit" | "on";
  tools: LlmToolDef[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Replaces every occurrence of the secret with a fixed marker. Used at every
// boundary where appliance text could carry the key value.
export function redactSecret(value: string, secret: string): string {
  if (!secret || !value) return value;
  return value.split(secret).join(REDACTED);
}

// Builds the request body. chat_template_kwargs only ships when the
// thinking flag is explicit (on/off); other providers may reject it.
export function buildChatBody(options: Pick<BenchClientOptions, "messages" | "model" | "parallelToolCalls" | "thinking" | "tools">): Record<string, unknown> {
  const body: Record<string, unknown> = {
    messages: options.messages,
    model: options.model,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options.tools.length > 0) body.tools = options.tools;
  if (options.parallelToolCalls !== undefined) body.parallel_tool_calls = options.parallelToolCalls;
  if (options.thinking === "on") body.chat_template_kwargs = { enable_thinking: true };
  if (options.thinking === "off") body.chat_template_kwargs = { enable_thinking: false };
  return body;
}

// Retry-After: an integer number of seconds, or an HTTP date (RFC 7231).
// Anything invalid or already in the past falls back to the default.
export function parseRetryAfterMs(header: string | null, now = Date.now()): number {
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && /^\s*\d+\s*$/.test(header)) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs) && dateMs > now) {
    return dateMs - now;
  }
  return DEFAULT_RETRY_AFTER_MS;
}

// Extracts error.type/error.code from a JSON error body. Never returns body
// prose: the key could be echoed there and must not travel in messages.
// The picked value is redacted against the key and bounded; a value that was
// nothing but the key yields an empty detail.
async function extractErrorDetail(response: Response, apiKey: string): Promise<string> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return "";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "";
  }
  const pick = (record: Record<string, unknown>): string => {
    const value = record["type"] ?? record["code"];
    if (typeof value === "string") return value.slice(0, 120);
    if (typeof value === "number") return String(value);
    return "";
  };
  if (isRecord(parsed)) {
    const errorField = parsed["error"];
    if (isRecord(errorField)) {
      const detail = pick(errorField);
      if (detail) {
        const redacted = redactSecret(detail, apiKey);
        return redacted === REDACTED || redacted === "" ? "" : redacted;
      }
    }
    const detail = pick(parsed);
    if (detail) {
      const redacted = redactSecret(detail, apiKey);
      return redacted === REDACTED || redacted === "" ? "" : redacted;
    }
  }
  return "";
}

function parseArgs(argsRaw: string): { args: unknown; jsonError: string | null } {
  const trimmed = argsRaw.trim();
  if (trimmed === "") return { args: {}, jsonError: null };
  try {
    return { args: JSON.parse(trimmed), jsonError: null };
  } catch (error) {
    return { args: null, jsonError: error instanceof Error ? error.message : String(error) };
  }
}

// F6: redacts the key in every string of the DECODED arguments object
// (recursively). Raw-text redaction alone misses values whose characters are
// JSON-escaped (e.g. the first character as a \uXXXX escape): the raw wire
// text does not contain the literal key, but the parsed object does.
function redactDeep(value: unknown, secret: string): unknown {
  if (typeof value === "string") return redactSecret(value, secret);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secret));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    // Property names are redacted too: the appliance can echo the key as a
    // JSON property name (escaped or literal), and the name would survive a
    // values-only pass into diagnostics and the replayed arguments.
    for (const [key, item] of Object.entries(value)) out[redactSecret(key, secret)] = redactDeep(item, secret);
    return out;
  }
  return value;
}

interface Delta {
  content?: unknown;
  reasoning_content?: unknown;
  tool_calls?: unknown;
}

interface Choice {
  delta?: Delta;
  finish_reason?: unknown;
}

interface StreamEvent {
  choices?: Choice[];
  usage?: unknown;
}

async function consumeResponse(response: Response, startedAt: number, attempts: number, apiKey: string): Promise<ChatStreamResult> {
  if (response.status < 200 || response.status >= 300) {
    const detail = await extractErrorDetail(response, apiKey);
    await response.body?.cancel().catch(() => {});
    throw new BenchHttpError(response.status, detail);
  }
  const reader = response.body ? response.body.getReader() : null;
  if (!reader) throw new BenchProtocolError("streaming response has no body");
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let explicitEnd = false;
  let doneMarker = false;
  let finishReason: string | null = null;
  let text = "";
  let ttftAny: number | null = null;
  let ttftVisible: number | null = null;
  let usage: UsageInfo | null = null;
  const slots = new Map<number, { argsRaw: string; id: string | null; name: string }>();
  try {
    for (;;) {
      let read;
      try {
        read = await reader.read();
      } catch {
        // Mid-stream transport failure: sanitized, no retry (the stream
        // already started answering). Unreachable after [DONE]: the reader
        // is cancelled at the marker (F7).
        throw new BenchTransportError("transport failure while reading the stream");
      }
      if (read.done) break;
      buffer += decoder.decode(read.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "") continue;
        if (payload === "[DONE]") {
          // F7: the marker ends the stream. Stop reading and cancel the
          // reader: content that never arrives (an open connection, a late
          // transport error) cannot hang or fail an already-completed case.
          explicitEnd = true;
          doneMarker = true;
          break;
        }
        let event: StreamEvent;
        try {
          event = JSON.parse(payload) as StreamEvent;
        } catch {
          // Invalid JSON event: sanitized protocol error, no payload text.
          throw new BenchProtocolError("stream event is not valid JSON");
        }
        const now = Date.now() - startedAt;
        const choice = Array.isArray(event.choices) ? event.choices[0] : undefined;
        const delta = choice?.delta;
        if (delta) {
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
            // Reasoning is model output, never visible: it only arms ttftAny.
            if (ttftAny === null) ttftAny = now;
          }
          if (typeof delta.content === "string" && delta.content.length > 0) {
            text += delta.content;
            if (ttftAny === null) ttftAny = now;
            if (ttftVisible === null) ttftVisible = now;
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const rawCall of delta.tool_calls) {
              if (!isRecord(rawCall)) continue;
              const index = typeof rawCall["index"] === "number" ? rawCall["index"] : 0;
              const slot = slots.get(index) ?? { argsRaw: "", id: null, name: "" };
              if (typeof rawCall["id"] === "string" && rawCall["id"].length > 0) slot.id = rawCall["id"];
              const fn = rawCall["function"];
              if (isRecord(fn)) {
                if (typeof fn["name"] === "string") slot.name += fn["name"];
                if (typeof fn["arguments"] === "string") slot.argsRaw += fn["arguments"];
              }
              slots.set(index, slot);
              if (ttftAny === null) ttftAny = now;
              if (ttftVisible === null) ttftVisible = now;
            }
          }
        }
        if (choice && typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
        if (isRecord(event.usage)) {
          usage = {
            completionTokens: typeof event.usage["completion_tokens"] === "number" ? event.usage["completion_tokens"] : 0,
            promptTokens: typeof event.usage["prompt_tokens"] === "number" ? event.usage["prompt_tokens"] : 0,
            reasoningTokens:
              isRecord(event.usage["completion_tokens_details"]) &&
              typeof event.usage["completion_tokens_details"]["reasoning_tokens"] === "number"
                ? event.usage["completion_tokens_details"]["reasoning_tokens"]
                : null,
          };
        }
      }
      if (doneMarker) break;
    }
  } finally {
    if (doneMarker) {
      // F7: release the transport as soon as the marker arrives. Errors
      // after [DONE] (a dropped socket, a hung connection) must not reach
      // the case: the answer is already complete.
      await reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }
  if (!explicitEnd && finishReason === null) {
    // Truncated stream: a late connection drop must not become a final answer.
    throw new BenchProtocolError("stream ended without an explicit end marker");
  }
  const toolCalls: ParsedToolCall[] = [...slots.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, slot]) => {
      // Redact before parsing (raw wire text) and after (decoded object,
      // values AND property names): an appliance echoing the key into the
      // call id or into JSON-escaped arguments must not feed it back into
      // the conversation.
      const argsRaw = redactSecret(slot.argsRaw, apiKey);
      const parsed = parseArgs(argsRaw);
      const args = parsed.args === null ? null : redactDeep(parsed.args, apiKey);
      // The replayed arguments are the serialization of the sanitized
      // object, never the raw wire text: raw JSON escapes (\uXXXX) could
      // still decode to the key even after the raw-text redaction. Invalid
      // JSON keeps the redacted raw so the model sees its own mistake.
      const argsOut = args === null ? argsRaw : JSON.stringify(args);
      return {
        args,
        argsRaw: argsOut,
        id: slot.id === null ? `bench_call_${index + 1}` : redactSecret(slot.id, apiKey),
        jsonError: parsed.jsonError,
        name: redactSecret(slot.name, apiKey),
      };
    });
  return {
    attempts,
    finishReason,
    text: redactSecret(text, apiKey),
    toolCalls,
    totalMs: Date.now() - startedAt,
    ttftAnyMs: ttftAny,
    ttftVisibleMs: ttftVisible,
    usage,
  };
}

export async function chatStream(options: BenchClientOptions): Promise<ChatStreamResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayImpl = options.delayImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? 3;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  if (!/^https:\/\//i.test(baseUrl)) {
    // The CLI checks too; the exported client must not trust its caller.
    throw new BenchProtocolError("baseUrl must use HTTPS");
  }
  const body = buildChatBody(options);
  const bodyText = JSON.stringify(body);
  const byteLength = new TextEncoder().encode(bodyText).length;
  // Strictly below the appliance limit: the boundary itself is rejected.
  if (byteLength >= MAX_BODY_BYTES) {
    throw new BenchProtocolError(`request body is ${byteLength} bytes; the appliance limit is ${MAX_BODY_BYTES}`);
  }
  const startedAt = Date.now();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const requestId = options.requestIdFactory?.() ?? randomUUID();
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        body: bodyText,
        headers: {
          "Authorization": `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "X-Conversation-Id": options.conversationId,
          "X-Request-Id": requestId,
        },
        method: "POST",
        redirect: "error",
      });
    } catch {
      // Normalized transport error: the original message may carry the key.
      throw new BenchTransportError("transport failure while contacting the chat endpoint");
    }
    // Retry window: 503 and nothing of the stream has arrived. A 503 has no
    // stream payload; anything already consumed in consumeResponse never
    // returns here, so a POST that started answering is never repeated.
    if (response.status === 503 && attempts <= maxRetries) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      await response.body?.cancel().catch(() => {});
      await delayImpl(retryAfterMs);
      continue;
    }
    return consumeResponse(response, startedAt, attempts, options.apiKey);
  }
}
