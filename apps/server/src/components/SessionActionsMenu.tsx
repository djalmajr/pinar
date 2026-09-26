import type { Session } from "@pinar/shared";
import CheckIcon from "~icons/lucide/check";
import CopyIcon from "~icons/lucide/copy";
import FileTextIcon from "~icons/lucide/file-text";
import FolderInputIcon from "~icons/lucide/folder-input";
import LayersIcon from "~icons/lucide/layers";
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
  copied?: boolean;
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
  copied = false,
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
  const markdownHref = sessionMarkdownHref(session, { grouped, shareToken });
  return (
    <DropdownMenuContent align="end" className={SESSION_MENU_WIDTH}>
      <DropdownMenuGroup>
        {onCopy ? (
          <DropdownMenuItem closeOnClick={false} onClick={() => onCopy(session)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? t("common.copied") : t("dashboard.copyPrompt")}
          </DropdownMenuItem>
        ) : null}
        {onCopyBatch && batchId && !grouped ? (
          <DropdownMenuItem closeOnClick={false} onClick={() => onCopyBatch(batchId)}>
            {batchCopied ? <CheckIcon /> : <LayersIcon />}
            {batchCopied ? t("common.copied") : t("dashboard.copyBatch")}
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
