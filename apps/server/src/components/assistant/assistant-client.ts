// Read-only HTTP client for the assistant contract (sections 1 and 2 of
// ai-assistant-f1-contract.md). No React here. Local types mirror the store
// contract; the server routes arrive in a parallel slice, so every fetch
// degrades to null (hidden/empty UI) instead of throwing on non-2xx answers,
// while genuine network failures reject.
import { isRecord, readResponseRecord } from "@/lib/api-data";
import type { TextUIPart, UIMessage } from "ai";

export type AssistantReason = "disabled" | "not_configured" | "requires_pro" | null;

export interface AssistantStatus {
  available: boolean;
  reason: AssistantReason;
  surface: "cloud" | "local";
}

export interface AssistantThread {
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
}

export type AssistantRole = "assistant" | "user";
export type AssistantMessageStatus = "error" | "final";

export interface AssistantMessage {
  createdAt: string;
  errorCode: string | null;
  id: string;
  role: AssistantRole;
  status: AssistantMessageStatus;
  text: string;
  threadId: string;
}

/**
 * UIMessage with the assistant metadata the panel uses: a stored error
 * message carries `{ errorCode }` (the AssistantErrorCode from the stream).
 */
export interface AssistantUIMessage extends UIMessage {
  metadata?: { errorCode?: string } | null;
}

export type AssistantErrorKey =
  | "assistant.errorIncomplete"
  | "assistant.errorFailed"
  | "assistant.errorNetwork"
  | "assistant.errorRateLimited"
  | "assistant.errorTimeout"
  | "assistant.requiresPro";

function isAssistantThread(value: unknown): value is AssistantThread {
  return isRecord(value)
    && typeof value.createdAt === "string"
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.updatedAt === "string";
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  return isRecord(value)
    && typeof value.createdAt === "string"
    && (value.errorCode === null || typeof value.errorCode === "string")
    && typeof value.id === "string"
    && (value.role === "assistant" || value.role === "user")
    && (value.status === "error" || value.status === "final")
    && typeof value.text === "string"
    && typeof value.threadId === "string";
}

function isAssistantStatus(value: unknown): value is AssistantStatus {
  return isRecord(value)
    && typeof value.available === "boolean"
    && (value.reason === "disabled"
      || value.reason === "not_configured"
      || value.reason === "requires_pro"
      || value.reason === null)
    && (value.surface === "cloud" || value.surface === "local");
}

/**
 * `GET /api/assistant/status`. Returns the parsed status on a valid 2xx
 * answer and null on an error answer (404 before the route lands, 401, ...)
 * or an invalid body. Network failures reject.
 */
export async function fetchAssistantStatus(): Promise<AssistantStatus | null> {
  const response = await fetch("/api/assistant/status");
  const data = await readResponseRecord(response);
  if (!response.ok || data === null || !isAssistantStatus(data)) return null;
  return { available: data.available, reason: data.reason, surface: data.surface };
}

/** `GET /api/assistant/threads`. null on error answers or an invalid list. */
export async function fetchAssistantThreads(): Promise<AssistantThread[] | null> {
  const response = await fetch("/api/assistant/threads");
  const data = await readResponseRecord(response);
  if (!response.ok || data === null || !Array.isArray(data.threads)) return null;
  if (!data.threads.every(isAssistantThread)) return null;
  return data.threads;
}

export interface AssistantThreadDetail {
  messages: AssistantMessage[];
  thread: AssistantThread;
}

/** `GET /api/assistant/threads/:id`. null on 404 or an invalid body. */
export async function fetchAssistantThread(id: string): Promise<AssistantThreadDetail | null> {
  const response = await fetch(`/api/assistant/threads/${encodeURIComponent(id)}`);
  const data = await readResponseRecord(response);
  if (!response.ok || data === null || !isAssistantThread(data.thread)) return null;
  if (!Array.isArray(data.messages) || !data.messages.every(isAssistantMessage)) return null;
  return { messages: data.messages, thread: data.thread };
}

/** `DELETE /api/assistant/threads/:id`. false when the thread is gone or the answer is not `ok`. */
export async function deleteAssistantThread(id: string): Promise<boolean> {
  const response = await fetch(`/api/assistant/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) return false;
  const data = await readResponseRecord(response);
  return data !== null && data.ok === true;
}

/**
 * Body for `POST /api/assistant/turn`: the text of the last user message
 * (its text parts joined) plus the threadId of an existing conversation.
 */
export function buildTurnRequestBody(
  threadId: string | null | undefined,
  messages: readonly AssistantUIMessage[],
): { threadId?: string; text: string } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const body: { threadId?: string; text: string } = {
      text: message.parts
        .filter((part): part is TextUIPart => part.type === "text")
        .map((part) => part.text)
        .join(""),
    };
    if (threadId) body.threadId = threadId;
    return body;
  }
  return { text: "" };
}

/**
 * Error code → i18n key (contract section 4). Stream failures deliver only
 * the AssistantErrorCode as the error text; out-of-stream JSON errors use
 * the snake_case codes. Unknown codes and `ASSISTANT_STREAM_FAILED` /
 * `assistant_unavailable` fall back to the generic failure note; a network
 * failure uses `assistant.errorNetwork` at the call site.
 */
export function assistantErrorMessageKey(code: string | null | undefined): AssistantErrorKey {
  switch (code) {
    case "ASSISTANT_TURN_INCOMPLETE":
      return "assistant.errorIncomplete";
    case "ASSISTANT_TURN_TIMEOUT":
      return "assistant.errorTimeout";
    case "assistant_rate_limited":
      return "assistant.errorRateLimited";
    case "assistant_requires_pro":
      return "assistant.requiresPro";
    default:
      return "assistant.errorFailed";
  }
}

/**
 * Stored messages → UI messages. A message with `status: "error"` becomes an
 * assistant message without text and with `{ errorCode }` metadata, so the
 * panel renders the translated error note and the retry action.
 */
export function threadMessagesToUiMessages(
  messages: readonly AssistantMessage[],
): AssistantUIMessage[] {
  return messages.map((message) => {
    if (message.status === "error") {
      return {
        id: message.id,
        metadata: { errorCode: message.errorCode ?? undefined },
        parts: [],
        role: "assistant",
      };
    }
    return {
      id: message.id,
      parts: [{ text: message.text, type: "text" }],
      role: message.role,
    };
  });
}
