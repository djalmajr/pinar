import type { ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import type { PinReviewHumanAction } from "@pinar/shared";
import { Badge } from "../../../../packages/ui/src/components/badge.tsx";
import { Button } from "../../../../packages/ui/src/components/button.tsx";
import type { Translate } from "@/lib/i18n";
import type { PinConversationMessage } from "@/pages/pin-conversation";
import { formatSessionDate } from "@/lib/session-date";
import { COMMENT_BODY_MAX_LENGTH, commentBodyWithinLimit, type CommentEditState } from "./pin-comment-editor";
import { PinCommentEditor } from "./PinCommentEditor";

// Lucide pencil, inlined so the component stays testable without the
// bundler's icon alias (same pattern as PinCommentEditor's control icon).
function PencilIcon() {
  return (
    <svg
      aria-hidden
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4" />
    </svg>
  );
}

// Real comments (human or agent) are rendered as Markdown (react-markdown
// never injects raw HTML) and every URL goes through defaultUrlTransform,
// which drops javascript:/data: and other unsafe protocols. The original
// note and legacy agent executions stay plain text on purpose.
const threadMarkdownComponents: Components = {
  blockquote: (props) => <blockquote className="my-2 border-l-4 pl-3 [overflow-wrap:anywhere]" {...props} />,
  code: (props) => <code className="break-words rounded border bg-muted px-1 font-mono text-xs [overflow-wrap:anywhere]" {...props} />,
  ol: (props) => <ol className="my-2 list-decimal pl-5" {...props} />,
  p: (props) => <p className="whitespace-pre-wrap [overflow-wrap:anywhere]" {...props} />,
  pre: (props) => <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted p-2 text-xs [overflow-wrap:anywhere] [&_code]:rounded-none [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0" {...props} />,
  ul: (props) => <ul className="my-2 list-disc pl-5" {...props} />,
};

export interface PinDiscussionProps {
  /** Busy loader shown inside the action buttons (the viewer's spinner). */
  busyLoader?: ReactNode;
  /** Existing permission: only editors can comment. */
  canEdit: boolean;
  /** Whether a thread row offers the Edit action (note: canEditPins; stored comments: viewer rules). */
  canEditMessage: (message: PinConversationMessage) => boolean;
  /** Existing review state: concluded pins offer Reopen instead of Conclude. */
  concluded: boolean;
  /** Markdown draft of the selected pin (the viewer's existing state). */
  draft: string;
  /** Save in flight for the in-progress thread edit. */
  editBusy: boolean;
  /** Inline edit of a thread message (original note or stored comment); null when idle. */
  editDraft: CommentEditState | null;
  /** Localized error of a failed save; the draft is kept for retry. */
  editError: string;
  /** Editor identity: pin + draft version; a new version re-creates it. */
  editorKey: string;
  language: string;
  onDraftChange: (value: string) => void;
  onEditCancel: () => void;
  onEditDraftChange: (value: string) => void;
  onEditSave: () => void;
  onEditStart: (message: PinConversationMessage) => void;
  onReview: (action: PinReviewHumanAction) => void;
  onSend: () => void;
  pinId: string;
  reviewBusy: boolean;
  reviewError: string;
  sendBusy: boolean;
  sendError: string;
  /** Screenshot anchor shown above the discussion, when the capture has one. */
  shot?: { alt: string; href: string } | null;
  thread: PinConversationMessage[];
  t: Translate;
}

/**
 * Discussion/actions section of the viewer pin dialog: the thread timeline,
 * the Tiptap comment editor, and the same-line actions (send comment on the
 * left, conclude/reopen on the right, wrapping on narrow screens). State and
 * persistence stay in WebViewer; this component only receives props and
 * reports back.
 */
export function PinDiscussion({
  busyLoader,
  canEdit,
  canEditMessage,
  concluded,
  draft,
  editBusy,
  editDraft,
  editError,
  editorKey,
  language,
  onDraftChange,
  onEditCancel,
  onEditDraftChange,
  onEditSave,
  onEditStart,
  onReview,
  onSend,
  pinId,
  reviewBusy,
  reviewError,
  sendBusy,
  sendError,
  shot,
  thread,
  t,
}: PinDiscussionProps) {
  const formId = `pin-comment-${pinId}`;
  const overLimit = draft.trim().length > COMMENT_BODY_MAX_LENGTH;
  const sendDisabled = sendBusy || !commentBodyWithinLimit(draft);

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      {shot ? (
        <a
          aria-label={t("viewer.openCapture")}
          className="block overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={shot.href}
          rel="noopener noreferrer"
          target="_blank"
        >
          <img
            alt={shot.alt}
            className="max-h-72 w-full object-contain"
            draggable={false}
            src={shot.href}
          />
        </a>
      ) : null}

      <section aria-label={t("viewer.comments")} className="flex min-w-0 flex-col gap-3">
        <h3 className="text-sm font-medium">{t("viewer.comments")}</h3>
        {thread.length > 0 ? (
          <ol className="flex min-w-0 flex-col gap-2">
            {thread.map((message) => {
              const editingDraft = editDraft && editDraft.messageId === message.id ? editDraft : null;
              return (
                <li className="min-w-0 rounded-md border bg-card px-3 py-2" key={message.id}>
                  <p className="flex min-w-0 items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
                    <span className="min-w-0 truncate">{message.author}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {!editingDraft && canEditMessage(message) ? (
                        <Button
                          aria-label={t("viewer.editComment")}
                          className="shrink-0"
                          size="icon-sm"
                          title={t("viewer.editComment")}
                          type="button"
                          variant="ghost"
                          onClick={() => onEditStart(message)}
                        >
                          <PencilIcon />
                        </Button>
                      ) : null}
                      <time className="font-normal" dateTime={message.at}>
                        {formatSessionDate({ createdAt: message.at }, language)}
                      </time>
                    </span>
                  </p>
                  {editingDraft ? (
                    <div className="mt-2 flex min-w-0 flex-col gap-2">
                      {editingDraft.target === "pin" ? (
                        // The original note is displayed as plain text (existing
                        // policy), so it is edited in a plain text field: no
                        // toolbar, no markdown serialization — snake_case, "*",
                        // "#" and line breaks are saved and cancelled literally.
                        <textarea
                          aria-label={t("viewer.editComment")}
                          className="min-h-20 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 dark:disabled:bg-input/80"
                          disabled={editBusy}
                          maxLength={COMMENT_BODY_MAX_LENGTH}
                          value={editingDraft.draft}
                          onChange={(event) => onEditDraftChange(event.target.value)}
                        />
                      ) : (
                        <PinCommentEditor
                          disabled={editBusy}
                          draft={editingDraft.draft}
                          editorKey={`edit:${message.id}`}
                          label={t("viewer.editComment")}
                          onChange={onEditDraftChange}
                          t={t}
                        />
                      )}
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Button
                          disabled={editBusy || !commentBodyWithinLimit(editingDraft.draft)}
                          size="sm"
                          type="button"
                          onClick={onEditSave}
                        >
                          {editBusy ? busyLoader : null}
                          {t("dashboard.save")}
                        </Button>
                        <Button
                          disabled={editBusy}
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={onEditCancel}
                        >
                          {t("common.cancel")}
                        </Button>
                      </div>
                      {editError ? (
                        <p className="text-sm text-destructive" role="alert">
                          {editError}
                        </p>
                      ) : null}
                    </div>
                  ) : message.commentId != null ? (
                    <div className="mt-1 min-w-0 text-sm text-foreground">
                      <ReactMarkdown components={threadMarkdownComponents} urlTransform={defaultUrlTransform}>
                        {message.text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground [overflow-wrap:anywhere]">{message.text}</p>
                  )}
                </li>
              );
            })}
          </ol>
        ) : null}

        {canEdit ? (
          <form
            className="flex min-w-0 flex-col gap-2"
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              if (!sendDisabled) onSend();
            }}
          >
            <PinCommentEditor
              disabled={sendBusy}
              draft={draft}
              editorKey={editorKey}
              label={t("viewer.commentLabel")}
              onChange={onDraftChange}
              t={t}
            />
          </form>
        ) : null}

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {canEdit ? (
            <Button disabled={sendDisabled} form={formId} size="sm" type="submit">
              {sendBusy ? busyLoader : null}
              {t("viewer.sendComment")}
            </Button>
          ) : null}
          <span aria-hidden className="min-w-2 flex-1" />
          {concluded ? <Badge variant="successSoft">{t("viewer.pinConcluded")}</Badge> : null}
          {concluded ? (
            <Button
              disabled={reviewBusy}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => onReview("reopen")}
            >
              {reviewBusy ? busyLoader : null}
              {t("viewer.reopenPin")}
            </Button>
          ) : (
            <Button
              disabled={reviewBusy}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => onReview("accept")}
            >
              {reviewBusy ? busyLoader : null}
              {t("viewer.concludePin")}
            </Button>
          )}
        </div>

        {canEdit && overLimit ? (
          <p className="text-sm text-destructive" role="alert">
            {t("commentTooLong")}
          </p>
        ) : null}
        {sendError ? (
          <p className="text-sm text-destructive" role="alert">
            {sendError}
          </p>
        ) : null}
        {reviewError ? (
          <p className="text-sm text-destructive" role="alert">
            {reviewError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
