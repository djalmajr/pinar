import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@pinar/ui";
import type { Translate } from "@/lib/i18n";
import { formatSessionDate } from "@/lib/session-date";
import IconTrash from "~icons/lucide/trash-2";
import type { AssistantThread } from "./assistant-client";

export interface AssistantThreadListProps {
  activeThreadId: string | null;
  language: string;
  t: Translate;
  /** null = the list has not been loaded yet. */
  threads: readonly AssistantThread[] | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function AssistantThreadList({
  activeThreadId,
  language,
  t,
  threads,
  onOpen,
  onDelete,
}: AssistantThreadListProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null);

  return (
    <>
      {threads === null || threads.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {threads === null ? null : t("assistant.noThreads")}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 px-2 py-1">
          {threads.map((thread) => (
            <li className="flex items-center gap-1" key={thread.id}>
              <button
                aria-current={thread.id === activeThreadId ? "true" : undefined}
                className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                type="button"
                onClick={() => onOpen(thread.id)}
              >
                <span className="block truncate font-medium">{thread.title}</span>
                <time className="block truncate text-xs text-muted-foreground" dateTime={thread.updatedAt}>
                  {formatSessionDate({ createdAt: thread.updatedAt }, language)}
                </time>
              </button>
              <Button
                aria-label={t("assistant.deleteThread")}
                className="shrink-0"
                size="icon-xs"
                title={t("assistant.deleteThread")}
                type="button"
                variant="ghost"
                onClick={() => setDeleteId(thread.id)}
              >
                <IconTrash aria-hidden="true" className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("assistant.deleteThread")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                // Keep the dialog state in this component: close it, then let
                // the panel run the delete (it refreshes on failure).
                event.preventDefault();
                const id = deleteId;
                setDeleteId(null);
                if (id) onDelete(id);
              }}
            >
              {t("assistant.deleteThread")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
