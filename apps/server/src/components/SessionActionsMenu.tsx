import type { Session } from "@pinar/shared";
import CheckIcon from "~icons/lucide/check";
import CopyIcon from "~icons/lucide/copy";
import FileTextIcon from "~icons/lucide/file-text";
import FolderInputIcon from "~icons/lucide/folder-input";
import LayersIcon from "~icons/lucide/layers";
import Maximize2Icon from "~icons/lucide/maximize-2";
import ScanSearchIcon from "~icons/lucide/scan-search";
import TrashIcon from "~icons/lucide/trash-2";
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@pinar/ui";
import type { Translate } from "../lib/i18n";

/**
 * Listing cards and the workspace viewer share this menu so a session is not
 * reachable differently from either surface. Each item renders only when its
 * handler is supplied: the public /v/ route omits move and delete (no list to
 * return to), and "view" stays off the viewer because that surface is already
 * open. Empty groups must not render, or a stray separator sits above Open prompt *.md.
 * "Copy prompt (batch)" appears only for a session that belongs to one.
 */
export interface SessionActionsMenuProps {
  batchCopied?: boolean;
  copied?: boolean;
  session: Session;
  t: Translate;
  onCopy?: (session: Session) => void;
  onCopyBatch?: (batchId: string) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string) => void;
  onReview?: (id: string) => void;
  onView?: (id: string) => void;
}

// Width comes from the primitive, which sizes every menu to its own content.
export const SESSION_MENU_WIDTH = "max-h-96 overflow-y-auto";

export function SessionActionsMenu({
  batchCopied = false,
  copied = false,
  session,
  t,
  onCopy,
  onCopyBatch,
  onDelete,
  onMove,
  onReview,
  onView,
}: SessionActionsMenuProps) {
  const batchId = session.batchId ?? null;
  const hasOpenGroup = Boolean(onView || onReview);
  return (
    <DropdownMenuContent align="end" className={SESSION_MENU_WIDTH}>
      {hasOpenGroup ? (
        <DropdownMenuGroup>
          {onView ? (
            <DropdownMenuItem onClick={() => onView(session.id)}>
              <Maximize2Icon />
              {t("dashboard.view")}
            </DropdownMenuItem>
          ) : null}
          {onReview ? (
            <DropdownMenuItem onClick={() => onReview(session.id)}>
              <ScanSearchIcon />
              {t("dashboard.reviewOnPage")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      ) : null}
      {hasOpenGroup ? <DropdownMenuSeparator /> : null}
      <DropdownMenuGroup>
        {onCopy ? (
          <DropdownMenuItem closeOnClick={false} onClick={() => onCopy(session)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? t("common.copied") : t("dashboard.copyPrompt")}
          </DropdownMenuItem>
        ) : null}
        {onCopyBatch && batchId ? (
          <DropdownMenuItem closeOnClick={false} onClick={() => onCopyBatch(batchId)}>
            {batchCopied ? <CheckIcon /> : <LayersIcon />}
            {batchCopied ? t("common.copied") : t("dashboard.copyBatch")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem render={<a href={`/v/${session.id}.md`} rel="noopener noreferrer" target="_blank" />}>
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
