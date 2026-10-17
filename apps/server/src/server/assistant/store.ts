import { generateNanoId } from "@pinar/shared";

export type AssistantRole = "user" | "assistant";
export type AssistantMessageStatus = "final" | "error";

export interface AssistantThread {
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
}

export interface AssistantMessage {
  createdAt: string;
  errorCode: string | null;
  id: string;
  role: AssistantRole;
  status: AssistantMessageStatus;
  text: string;
  threadId: string;
}

export interface AssistantStore {
  /** Inserts the message and stamps `thread.updatedAt = message.createdAt`. */
  appendMessage(message: AssistantMessage): Promise<void>;
  createThread(input: { id: string; now: string; title: string }): Promise<AssistantThread>;
  /** Deletes the messages with it; resolves to false when the thread did not exist. */
  deleteThread(id: string): Promise<boolean>;
  getThread(id: string): Promise<AssistantThread | null>;
  /** The N most recent messages, in chronological order. */
  listMessages(threadId: string, input: { limit: number }): Promise<AssistantMessage[]>;
  /** Newest first, by `updatedAt`. */
  listThreads(input: { limit: number; offset: number }): Promise<AssistantThread[]>;
}

export const ASSISTANT_THREAD_ID_PATTERN = /^ath_[0-9A-Za-z_-]{24}$/;
export const ASSISTANT_MESSAGE_ID_PATTERN = /^amg_[0-9A-Za-z_-]{24}$/;

export function newAssistantThreadId(): string {
  return `ath_${generateNanoId(24)}`;
}

export function newAssistantMessageId(): string {
  return `amg_${generateNanoId(24)}`;
}

/** Title ceiling, counted in graphemes (perceived characters), not UTF-16 units. */
export const ASSISTANT_TITLE_MAX = 80;

/**
 * Splits text into graphemes via `Intl.Segmenter` when available, falling
 * back to code points (which never split a surrogate pair) otherwise.
 */
function graphemePieces(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}

/**
 * Thread title derived from the first message: whitespace runs collapse to a
 * single space, the ends are trimmed, and text longer than
 * `ASSISTANT_TITLE_MAX` graphemes is cut to 79 graphemes plus an ellipsis
 * (80 total). Empty text becomes "…". The cut never splits a grapheme
 * (emoji, combining marks).
 */
export function assistantThreadTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "…";
  const pieces = graphemePieces(collapsed);
  if (pieces.length <= ASSISTANT_TITLE_MAX) return collapsed;
  return `${pieces.slice(0, ASSISTANT_TITLE_MAX - 1).join("")}…`;
}
