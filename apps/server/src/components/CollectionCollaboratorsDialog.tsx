import { useCallback, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@pinar/ui";
import { useServerI18n, type ServerMessageKey } from "@/lib/i18n";
import {
  type CollaboratorInviteFailure,
  fetchCollectionCollaborators,
  inviteCollectionCollaborator,
  revokeCollectionCollaborator,
  type CollaboratorRecord,
} from "@/lib/collection-collaborators";
import IconLoaderCircle from "~icons/lucide/loader-circle";
import TrashIcon from "~icons/lucide/trash-2";
import UserPlusIcon from "~icons/lucide/user-plus";
import UsersIcon from "~icons/lucide/users";
import RefreshCwIcon from "~icons/lucide/refresh-cw";

const COLLABORATOR_INVITE_MESSAGE_KEYS = {
  invite_collaborator_failed: "dashboard.collaboratorInviteFailed",
  invite_exists: "dashboard.collaboratorInviteExists",
  invite_pro_required: "dashboard.collaboratorInviteProRequired",
  invite_self: "dashboard.collaboratorInviteSelf",
} as const satisfies Record<CollaboratorInviteFailure, ServerMessageKey>;

function collaboratorInviteMessageKey(cause: unknown): ServerMessageKey {
  const code = cause instanceof Error ? cause.message : "";
  if (code in COLLABORATOR_INVITE_MESSAGE_KEYS) {
    return COLLABORATOR_INVITE_MESSAGE_KEYS[code as CollaboratorInviteFailure];
  }
  return "dashboard.collaboratorInviteFailed";
}

interface CollectionCollaboratorsDialogProps {
  collection: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function CollectionCollaboratorsDialog({
  collection,
  onOpenChange,
  open,
}: CollectionCollaboratorsDialogProps) {
  const { t } = useServerI18n();
  const [collaborators, setCollaborators] = useState<CollaboratorRecord[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<CollaboratorRecord | null>(null);
  const [revoking, setRevoking] = useState(false);

  const collectionId = collection?.id;

  const loadList = useCallback(async () => {
    if (!collectionId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const list = await fetchCollectionCollaborators(collectionId);
      setCollaborators(list);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    if (open && collectionId) {
      setEmailInput("");
      setInviteError(null);
      setInviteSuccess(null);
      setRevokeError(null);
      setRevokeTarget(null);
      void loadList();
    }
  }, [collectionId, loadList, open]);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    const email = emailInput.trim();
    if (!collectionId || !email || inviting) return;

    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);

    try {
      await inviteCollectionCollaborator(collectionId, email);
      setEmailInput("");
      setInviteSuccess(t("dashboard.collaboratorInvitedSuccess"));
      await loadList();
    } catch (cause) {
      setInviteError(t(collaboratorInviteMessageKey(cause)));
    } finally {
      setInviting(false);
    }
  }

  async function handleConfirmRevoke() {
    if (!collectionId || !revokeTarget || revoking) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeCollectionCollaborator(collectionId, revokeTarget.id);
      setCollaborators((current) => current.filter((item) => item.id !== revokeTarget.id));
      setRevokeTarget(null);
    } catch {
      setRevokeError(t("dashboard.revokeFailed"));
    } finally {
      setRevoking(false);
    }
  }

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim());

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UsersIcon aria-hidden="true" className="size-5 text-primary" />
              <span>{t("dashboard.collaboratorsTitle", { name: collection?.name ?? "" })}</span>
            </DialogTitle>
            <DialogDescription>
              {t("dashboard.collaboratorsDescription")}
            </DialogDescription>
          </DialogHeader>

          <form className="grid gap-2" onSubmit={handleInvite}>
            <div className="flex gap-2">
              <Input
                aria-label={t("dashboard.collaboratorEmailPlaceholder")}
                disabled={inviting || loading}
                placeholder={t("dashboard.collaboratorEmailPlaceholder")}
                type="email"
                value={emailInput}
                onChange={(event) => {
                  setEmailInput(event.target.value);
                  setInviteError(null);
                  setInviteSuccess(null);
                }}
              />
              <Button
                aria-busy={inviting || undefined}
                disabled={!isValidEmail || inviting || loading}
                type="submit"
              >
                {inviting ? (
                  <IconLoaderCircle aria-hidden="true" className="size-4 animate-spin" data-icon="inline-start" />
                ) : (
                  <UserPlusIcon aria-hidden="true" className="size-4" data-icon="inline-start" />
                )}
                {t(inviting ? "dashboard.inviting" : "dashboard.invite")}
              </Button>
            </div>
            {inviteError ? (
              <p className="text-xs text-destructive" role="alert">
                {inviteError}
              </p>
            ) : null}
            {inviteSuccess ? (
              <p className="text-xs text-green-600 dark:text-green-400" role="status">
                {inviteSuccess}
              </p>
            ) : null}
          </form>

          <div className="mt-2 space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("dashboard.collaborators")}
            </h4>

            {revokeError ? (
              <p className="text-xs text-destructive" role="alert">
                {revokeError}
              </p>
            ) : null}

            {loading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <IconLoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />
                <span>{t("common.loading")}</span>
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground">
                <p>{t("dashboard.collaboratorsLoadFailed")}</p>
                <Button size="sm" variant="outline" onClick={loadList}>
                  <RefreshCwIcon aria-hidden="true" className="size-3.5" data-icon="inline-start" />
                  {t("dashboard.retry")}
                </Button>
              </div>
            ) : collaborators.length === 0 ? (
              <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                {t("dashboard.noCollaborators")}
              </div>
            ) : (
              <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                {collaborators.map((collaborator) => (
                  <div
                    key={collaborator.id}
                    className="flex items-center justify-between rounded-md border bg-card/60 p-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{collaborator.email}</span>
                      <div className="flex items-center gap-2">
                        <Badge
                          className="h-4 px-1.5 text-[10px]"
                          variant={collaborator.status === "accepted" ? "outline" : "secondary"}
                        >
                          {t(collaborator.status === "accepted" ? "dashboard.statusAccepted" : "dashboard.statusPending")}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      aria-label={t("dashboard.revokeCollaborator")}
                      className="text-muted-foreground hover:text-destructive"
                      size="icon"
                      title={t("dashboard.revokeCollaborator")}
                      type="button"
                      variant="ghost"
                      onClick={() => setRevokeTarget(collaborator)}
                    >
                      <TrashIcon aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                ))}
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

      <AlertDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(next) => {
          if (!next && !revoking) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dashboard.revokeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dashboard.revokeConfirmDescription", { email: revokeTarget?.email ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              aria-busy={revoking || undefined}
              disabled={revoking}
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmRevoke();
              }}
            >
              {revoking ? (
                <IconLoaderCircle aria-hidden="true" className="size-4 animate-spin" data-icon="inline-start" />
              ) : null}
              {t(revoking ? "dashboard.revokingCollaborator" : "dashboard.revokeCollaborator")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
