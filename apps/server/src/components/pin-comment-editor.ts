import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

// Shared rules for the pin comment editor. The body limit mirrors the server
// contract (packages/shared pin-review, PIN_COMMENT_MAX_BODY_LENGTH): the
// trimmed body must be non-empty and at most 2000 characters.
export const COMMENT_BODY_MAX_LENGTH = 2000;

/**
 * Client-side validation for a comment draft, mirroring `parsePinCommentBody`
 * from @pinar/shared: trim, non-empty, and at most COMMENT_BODY_MAX_LENGTH.
 */
export function commentBodyWithinLimit(draft: string): boolean {
  const body = draft.trim();
  return body.length > 0 && body.length <= COMMENT_BODY_MAX_LENGTH;
}

/** Per-pin drafts: editing one pin never touches the other pins' drafts. */
export function setCommentDraft(
  drafts: Record<string, string>,
  pinId: string,
  value: string,
): Record<string, string> {
  return { ...drafts, [pinId]: value };
}

/** After a successful send, only the just-sent pin's draft is cleared. */
export function clearCommentDraft(
  drafts: Record<string, string>,
  pinId: string,
): Record<string, string> {
  return { ...drafts, [pinId]: "" };
}

/**
 * Inline edit of an existing thread message (original note or a stored
 * comment). The draft is separate from the new-comment drafts: one message
 * at a time, and switching pins always discards the in-progress edit so its
 * text never carries to another pin's conversation.
 */
export interface CommentEditState {
  /** "pin" for the original note, "comment" for stored comments. */
  target: "pin" | "comment";
  /** Thread message id being edited (the key of the PinDiscussion row). */
  messageId: string;
  draft: string;
}

/** Starts (or replaces) the in-progress edit; the previous edit is dropped. */
export function startCommentEdit(target: "pin" | "comment", messageId: string, text: string): CommentEditState {
  return { draft: text, messageId, target };
}

/** Keeps the same message while the draft changes (immutably). */
export function updateCommentEditDraft(state: CommentEditState, value: string): CommentEditState {
  return { ...state, draft: value };
}

export type CommentEditOutcome = "success" | "failure";

/**
 * Success leaves the edit (the conversation reloads with the saved text);
 * failure keeps the draft so the user can retry without re-typing.
 */
export function applyCommentEditOutcome(
  state: CommentEditState,
  outcome: CommentEditOutcome,
): CommentEditState | null {
  return outcome === "success" ? null : state;
}

/** Switching pins never carries the in-progress edit text to another pin. */
export function discardCommentEditOnPinSwitch(state: CommentEditState | null): CommentEditState | null {
  return state === null ? state : null;
}

/**
 * Editor extensions for the pin comment editor. The starter kit keeps only
 * the basic controls (bold, italic, lists, blockquote, inline code); the
 * unnecessary defaults (heading, horizontal rule, underline, strike,
 * code block) are disabled. Links keep their default validation, which
 * accepts only safe protocols (http/https/mailto, ...); there is no extra
 * link control in the toolbar.
 */
export function commentEditorExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      strike: false,
      underline: false,
    }),
    Markdown,
  ];
}
