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
  ask: { options: string[]; question: string } | null;
  createdAt: string;
  errorCode: string | null;
  id: string;
  role: AssistantRole;
  status: AssistantMessageStatus;
  text: string;
  threadId: string;
}

export type AssistantProposalStatus =
  | "proposed"
  | "executing"
  | "executed"
  | "failed"
  | "rejected"
  | "expired"
  | "undoing"
  | "undone";
export type AssistantProposalErrorCode =
  | "proposal_stale"
  | "proposal_failed"
  | "proposal_unknown_outcome"
  | "undo_stale"
  | "undo_failed";
export type AssistantProposalRisk = "reversible" | "irreversible" | "external";

export interface AssistantProposalDisplay {
  /** Key suffix: the UI shows t(`assistant.proposal.${action}`, params). */
  action: string;
  params: Record<string, string | number>;
}

/** What the store keeps. */
export interface AssistantProposalRecord {
  args: Record<string, unknown>;
  createdAt: string;
  display: AssistantProposalDisplay;
  errorCode: AssistantProposalErrorCode | null;
  executedAt: string | null;
  expiresAt: string;
  /** sha256 hex of the canonical JSON of the state read in prepare. */
  fingerprint: string;
  id: string; // apr_ + nanoid(24)
  messageId: string; // assistant message of the turn that proposed
  result: unknown | null; // only ids and counts, never raw text
  risk: AssistantProposalRisk;
  status: AssistantProposalStatus;
  summary: string; // English plain text for the model, without ids
  threadId: string;
  tool: string; // MCP name, e.g. "pinar.move_session" or "pinar.move_sessions"
  undo: AssistantUndoPlan | null;
  undoExpiresAt: string | null;
  updatedAt: string;
}

export interface AssistantUndoPlan {
  /** MCP calls in order. Ids created by the execution are filled after it. */
  calls: Array<{ args: Record<string, unknown>; tool: string }>;
  /** Fingerprint of the state right after the execution; undo refuses when the current state differs. */
  postFingerprint: string;
}

export type AssistantProposalPatch = Partial<
  Pick<AssistantProposalRecord, "errorCode" | "executedAt" | "result" | "undo" | "undoExpiresAt">
>;

export interface AssistantTransitionProposalInput {
  from: AssistantProposalStatus[];
  id: string;
  now: string;
  patch?: AssistantProposalPatch;
  /** The named column must be greater than `now`, or the transition returns null. */
  requireBefore?: "expiresAt" | "undoExpiresAt";
  to: AssistantProposalStatus;
}

export interface AssistantStore {
  /** Inserts the message (including its `ask`) and stamps `thread.updatedAt = message.createdAt`. */
  appendMessage(message: AssistantMessage): Promise<void>;
  createThread(input: { id: string; now: string; title: string }): Promise<AssistantThread>;
  /** Deletes the messages and proposals with it; resolves to false when the thread did not exist. */
  deleteThread(id: string): Promise<boolean>;
  getThread(id: string): Promise<AssistantThread | null>;
  /** The N most recent messages, in chronological order. */
  listMessages(threadId: string, input: { limit: number }): Promise<AssistantMessage[]>;
  /** Newest first, by `updatedAt`. */
  listThreads(input: { limit: number; offset: number }): Promise<AssistantThread[]>;
  createProposal(record: AssistantProposalRecord): Promise<void>;
  getProposal(id: string): Promise<AssistantProposalRecord | null>;
  /** Proposals of a thread, createdAt asc then id asc. */
  listProposals(threadId: string): Promise<AssistantProposalRecord[]>;
  /** Atomic compare-and-set. null when the id does not exist or the status is not in `from` (or the expiry guard fails). */
  transitionProposal(input: AssistantTransitionProposalInput): Promise<AssistantProposalRecord | null>;
}

export const ASSISTANT_THREAD_ID_PATTERN = /^ath_[0-9A-Za-z_-]{24}$/;
export const ASSISTANT_MESSAGE_ID_PATTERN = /^amg_[0-9A-Za-z_-]{24}$/;
export const ASSISTANT_PROPOSAL_ID_PATTERN = /^apr_[0-9A-Za-z_-]{24}$/;

export function newAssistantThreadId(): string {
  return `ath_${generateNanoId(24)}`;
}

export function newAssistantMessageId(): string {
  return `amg_${generateNanoId(24)}`;
}

export function newAssistantProposalId(): string {
  return `apr_${generateNanoId(24)}`;
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
