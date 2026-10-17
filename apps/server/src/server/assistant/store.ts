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

// Code points that never start a perceived character: combining marks,
// variation selectors, emoji skin-tone modifiers, tags and the zero-width
// joiner.
const GRAPHEME_EXTEND = /^(?:\p{M}|[‍︀-️\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}])$/u;
const REGIONAL_INDICATOR = /^[\u{1f1e6}-\u{1f1ff}]$/u;

/**
 * Splits text into graphemes via `Intl.Segmenter` when available. The
 * fallback groups code points itself: extending code points join the
 * previous one, a code point after a zero-width joiner joins it, and
 * regional indicators pair into flags. It covers the clusters a title cut
 * can meet (accents, ZWJ emoji, flags) without the full Unicode rules.
 */
function graphemePieces(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  const pieces: string[] = [];
  let previous = "";
  let openFlag = false;
  for (const point of text) {
    const joins = pieces.length > 0
      && (GRAPHEME_EXTEND.test(point) || previous === "‍" || (openFlag && REGIONAL_INDICATOR.test(point)));
    if (joins) {
      pieces[pieces.length - 1] += point;
      openFlag = false;
    } else {
      pieces.push(point);
      openFlag = REGIONAL_INDICATOR.test(point);
    }
    previous = point;
  }
  return pieces;
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
