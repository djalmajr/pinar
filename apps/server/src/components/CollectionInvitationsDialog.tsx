import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pinar/ui";
import { useServerI18n } from "@/lib/i18n";
import type { CollectionInvitationRecord } from "@/lib/collection-collaborators";
import CheckIcon from "~icons/lucide/check";
import FolderIcon from "~icons/lucide/folder";
import IconLoaderCircle from "~icons/lucide/loader-circle";
import MailIcon from "~icons/lucide/mail";

interface CollectionInvitationsDialogProps {
  invitations: CollectionInvitationRecord[];
  onAccept: (invitationId: string) => Promise<string | undefined>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function CollectionInvitationsDialog({
  invitations,
  onAccept,
  onOpenChange,
  open,
}: CollectionInvitationsDialogProps) {
  const { t } = useServerI18n();
  const navigate = useNavigate();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptedMap, setAcceptedMap] = useState<Record<string, string>>({}); // invitationId -> collectionId
  const [errorId, setErrorId] = useState<string | null>(null);

  async function handleAccept(invitation: CollectionInvitationRecord) {
    if (acceptingId) return;
    setAcceptingId(invitation.id);
    setErrorId(null);
    try {
      const collectionId = await onAccept(invitation.id);
      setAcceptedMap((current) => ({
        ...current,
        [invitation.id]: collectionId || invitation.collectionId,
      }));
    } catch {
      setErrorId(invitation.id);
    } finally {
      setAcceptingId(null);
    }
  }

  function handleOpenCollection(collectionId: string) {
    onOpenChange(false);
    void navigate({ to: `/c/${encodeURIComponent(collectionId)}` });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailIcon aria-hidden="true" className="size-5 text-primary" />
            <span>{t("dashboard.pendingInvitationsTitle")}</span>
          </DialogTitle>
          <DialogDescription>
            {t("dashboard.pendingInvitationsDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {invitations.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("dashboard.noInvitations")}
            </p>
          ) : (
            <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
              {invitations.map((invitation) => {
                const isAccepting = acceptingId === invitation.id;
                const acceptedCollectionId = acceptedMap[invitation.id];
                const isAccepted = Boolean(acceptedCollectionId);
                const hasError = errorId === invitation.id;

                return (
                  <div
                    key={invitation.id}
                    className="flex flex-col gap-2 rounded-lg border bg-card/60 p-3 text-sm transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <FolderIcon aria-hidden="true" className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-foreground">
                            {invitation.collectionName}
                          </p>
                          {invitation.ownerEmail ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {t("dashboard.sharedBy", { owner: invitation.ownerEmail })}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {isAccepted ? (
                          <Button
                            size="sm"
                            type="button"
                            variant="default"
                            onClick={() => handleOpenCollection(acceptedCollectionId)}
                          >
                            <CheckIcon aria-hidden="true" className="size-3.5" data-icon="inline-start" />
                            {t("dashboard.openCollection")}
                          </Button>
                        ) : (
                          <Button
                            aria-busy={isAccepting || undefined}
                            disabled={isAccepting}
                            size="sm"
                            type="button"
                            onClick={() => void handleAccept(invitation)}
                          >
                            {isAccepting ? (
                              <IconLoaderCircle aria-hidden="true" className="size-3.5 animate-spin" data-icon="inline-start" />
                            ) : null}
                            {t(isAccepting ? "dashboard.acceptingInvitation" : "dashboard.acceptInvitation")}
                          </Button>
                        )}
                      </div>
                    </div>

                    {hasError ? (
                      <p className="text-xs text-destructive" role="alert">
                        {t("dashboard.acceptFailed")}
                      </p>
                    ) : null}

                    {isAccepted ? (
                      <p className="text-xs text-green-600 dark:text-green-400" role="status">
                        {t("dashboard.invitationAccepted")}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
