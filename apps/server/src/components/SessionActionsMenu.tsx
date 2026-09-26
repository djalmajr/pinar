import type { Session } from "@pinar/shared";
import CheckIcon from "~icons/lucide/check";
import CircleAlertIcon from "~icons/lucide/circle-alert";
import CopyIcon from "~icons/lucide/copy";
import FileTextIcon from "~icons/lucide/file-text";
import FolderInputIcon from "~icons/lucide/folder-input";
import LayersIcon from "~icons/lucide/layers";
import LoaderCircleIcon from "~icons/lucide/loader-circle";
import TrashIcon from "~icons/lucide/trash-2";
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@pinar/ui";
import type { Translate } from "../lib/i18n";
import { sessionMarkdownHref } from "../lib/share-links";
import type { SessionGroup } from "../lib/session-groups";

/**
 * Listing cards and the workspace viewer share this menu so a session is not
 * reachable differently from either surface. Each item renders only when its
 * handler is supplied: the public /v/ route omits move and delete (no list to
 * return to). Empty groups must not render, or a stray separator sits above
 * Open prompt *.md.
 * "Copy prompt (batch)" appears only for a session that belongs to one.
 */
export interface SessionActionsMenuProps {
  batchCopied?: boolean;
  batchCopyFailed?: boolean;
  batchCopying?: boolean;
  copied?: boolean;
  copyFailed?: boolean;
  copying?: boolean;
  privateMarkdown?: boolean;
  session: Session;
  shareToken?: string | null;
  t: Translate;
  onCopy?: (session: Session) => void;
  onCopyBatch?: (batchId: string) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string) => void;
}

// Same fit for session, project, and collection menus: content width, then a
// little padding past the longest label. The extra is only on the right.
export const MENU_LABEL_FIT = "w-max max-w-[min(40rem,calc(100vw-2rem))] whitespace-nowrap pr-3";
export const SESSION_MENU_WIDTH = `max-h-96 overflow-y-auto ${MENU_LABEL_FIT}`;

export function SessionActionsMenu({
  batchCopied = false,
  batchCopyFailed = false,
  batchCopying = false,
  copied = false,
  copyFailed = false,
  copying = false,
  privateMarkdown = false,
  session,
  shareToken,
  t,
  onCopy,
  onCopyBatch,
  onDelete,
  onMove,
}: SessionActionsMenuProps) {
  const batchId = session.batchId ?? null;
  const grouped = Boolean((session as SessionGroup).captures);
  const markdownHref = sessionMarkdownHref(session, { grouped, privateMarkdown, shareToken });
  const copyLabel = copying
    ? t("dashboard.copyPromptPreparing")
    : copyFailed
      ? t("dashboard.copyPromptFailed")
      : copied
        ? t("common.copied")
        : t("dashboard.copyPrompt");
  const batchCopyLabel = batchCopying
    ? t("dashboard.copyPromptPreparing")
    : batchCopyFailed
      ? t("dashboard.copyPromptFailed")
      : batchCopied
        ? t("common.copied")
        : t("dashboard.copyBatch");
  return (
    <DropdownMenuContent align="end" className={SESSION_MENU_WIDTH}>
      <DropdownMenuGroup>
        {onCopy ? (
          <DropdownMenuItem closeOnClick={false} onClick={() => onCopy(session)}>
            {copied ? <CheckIcon /> : copying ? <LoaderCircleIcon className="animate-spin" /> : copyFailed ? <CircleAlertIcon /> : <CopyIcon />}
            {copyLabel}
          </DropdownMenuItem>
        ) : null}
        {onCopyBatch && batchId && !grouped ? (
          <DropdownMenuItem closeOnClick={false} onClick={() => onCopyBatch(batchId)}>
            {batchCopied ? <CheckIcon /> : batchCopying ? <LoaderCircleIcon className="animate-spin" /> : batchCopyFailed ? <CircleAlertIcon /> : <LayersIcon />}
            {batchCopyLabel}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem render={<a href={markdownHref} rel="noopener noreferrer" target="_blank" />}>
          <FileTextIcon />
          {t("dashboard.markdown")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {onMove ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onMove(session.id)}>
            <FolderInputIcon />
            {t("dashboard.moveTo")}
          </DropdownMenuItem>
        </>
      ) : null}
      {onDelete ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(session.id)}>
            <TrashIcon />
            {t("dashboard.deleteSession")}
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  );
}
