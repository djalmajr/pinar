import type { Session } from "@pinar/shared";
import ArrowDownIcon from "~icons/lucide/arrow-down";
import ArrowUpIcon from "~icons/lucide/arrow-up";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@pinar/ui";
import type { Translate } from "../lib/i18n";

export type SessionOrderDirection = "earlier" | "later";

/**
 * The listing card and the viewer header offer the same actions, so they share
 * one menu: a session should not be reachable differently depending on which
 * surface you opened it from. Each item renders only when its handler is
 * supplied, which is how a surface opts out - the viewer omits "view", "review"
 * and "copy prompt" because its header already carries those as buttons, and
 * the standalone /v/ route has no list to move within or return to after a delete.
 * "Copy batch" appears only for a session that belongs to one.
 */
export interface SessionActionsMenuProps {
  batchCopied?: boolean;
  canMoveEarlier?: boolean;
  canMoveLater?: boolean;
  copied?: boolean;
  session: Session;
  t: Translate;
  onCopy?: (session: Session) => void;
  onCopyBatch?: (batchId: string) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string) => void;
  onReorder?: (sessionId: string, direction: SessionOrderDirection) => void;
  onReview?: (id: string) => void;
  onView?: (id: string) => void;
}

// Width comes from the primitive, which sizes every menu to its own content.
export const SESSION_MENU_WIDTH = "max-h-96 overflow-y-auto";

export function SessionActionsMenu({
  batchCopied = false,
  canMoveEarlier = false,
  canMoveLater = false,
  copied = false,
  session,
  t,
  onCopy,
  onCopyBatch,
  onDelete,
  onMove,
  onReorder,
  onReview,
  onView,
}: SessionActionsMenuProps) {
  const showOrder = Boolean(onReorder) && (canMoveEarlier || canMoveLater);
  const batchId = session.batchId ?? null;
  return (
    <DropdownMenuContent align="end" className={SESSION_MENU_WIDTH}>
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
      <DropdownMenuSeparator />
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
      {showOrder ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("dashboard.order")}</DropdownMenuLabel>
            {canMoveEarlier ? (
              <DropdownMenuItem onClick={() => onReorder?.(session.id, "earlier")}>
                <ArrowUpIcon />
                {t("dashboard.moveEarlier")}
              </DropdownMenuItem>
            ) : null}
            {canMoveLater ? (
              <DropdownMenuItem onClick={() => onReorder?.(session.id, "later")}>
                <ArrowDownIcon />
                {t("dashboard.moveLater")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
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
