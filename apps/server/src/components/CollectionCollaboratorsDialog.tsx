import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@pinar/ui";
import { useServerI18n, type ServerMessageKey } from "@/lib/i18n";
import {
  type CollaboratorInviteFailure,
  fetchCollectionCollaborators,
  inviteCollectionCollaborator,
  revokeCollectionCollaborator,
  type CollaboratorRecord,
} from "@/lib/collection-collaborators";
import {
  fetchActiveShare,
  publishShare,
  revokeShare,
  shareViewerPath,
} from "@/lib/share-links";
import CheckIcon from "~icons/lucide/check";
import CopyIcon from "~icons/lucide/copy";
import IconLoaderCircle from "~icons/lucide/loader-circle";
import ShareIcon from "~icons/lucide/share-2";
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

export type CollectionAccessTab = "collaborators" | "share";

interface CollectionCollaboratorsDialogProps {
  canManageCollaborators: boolean;
  collection: { id: string; name: string } | null;
  initialTab?: CollectionAccessTab;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function CollectionCollaboratorsDialog({
  canManageCollaborators,
  collection,
  initialTab = "collaborators",
  onOpenChange,
  open,
}: CollectionCollaboratorsDialogProps) {
  const { t } = useServerI18n();
  const [activeTab, setActiveTab] = useState<CollectionAccessTab>(canManageCollaborators ? initialTab : "share");
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
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareOperation, setShareOperation] = useState<"publish" | "revoke" | null>(null);
  const [shareError, setShareError] = useState(false);
  const [shareLoadError, setShareLoadError] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const scopeGenerationRef = useRef(0);

  const collectionId = collection?.id;
  const shareUrl = useMemo(() => {
    if (!collectionId || !shareToken || typeof window === "undefined") return "";
    return new URL(
      shareViewerPath("collection", collectionId, shareToken),
      window.location.origin,
    ).toString();
  }, [collectionId, shareToken]);

  const loadList = useCallback(async (generation = scopeGenerationRef.current) => {
    if (!collectionId || !canManageCollaborators) return;
    setLoading(true);
    setLoadError(false);
    try {
      const list = await fetchCollectionCollaborators(collectionId);
      if (scopeGenerationRef.current === generation) setCollaborators(list);
    } catch {
      if (scopeGenerationRef.current === generation) setLoadError(true);
    } finally {
      if (scopeGenerationRef.current === generation) setLoading(false);
    }
  }, [canManageCollaborators, collectionId]);

  const loadShare = useCallback(async (generation = scopeGenerationRef.current) => {
    if (!collectionId) return;
    setShareLoading(true);
    setShareLoadError(false);
    try {
      const token = await fetchActiveShare("collection", collectionId);
      if (scopeGenerationRef.current === generation) setShareToken(token);
    } catch {
      if (scopeGenerationRef.current === generation) setShareLoadError(true);
    } finally {
      if (scopeGenerationRef.current === generation) setShareLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    const generation = ++scopeGenerationRef.current;
    setShareOperation(null);
    setShareToken(null);
    setShareError(false);
    setShareLoadError(false);
    setShareCopied(false);
    setShareLoading(false);
    setLoading(false);
    setLoadError(false);
    setInviting(false);
    setRevoking(false);
    setCollaborators([]);
    setRevokeTarget(null);

    if (!open || !collectionId) {
      return () => {
        if (scopeGenerationRef.current === generation) scopeGenerationRef.current += 1;
      };
    }

    setActiveTab(canManageCollaborators ? initialTab : "share");
    setEmailInput("");
    setInviteError(null);
    setInviteSuccess(null);
    setRevokeError(null);
    if (canManageCollaborators) void loadList(generation);
    void loadShare(generation);

    return () => {
      if (scopeGenerationRef.current === generation) scopeGenerationRef.current += 1;
    };
  }, [canManageCollaborators, collectionId, initialTab, loadList, loadShare, open]);

  async function handlePublishShare() {
    if (!collectionId || shareOperation) return;
    const generation = scopeGenerationRef.current;
    setShareOperation("publish");
    setShareError(false);
    try {
      const token = await publishShare("collection", collectionId);
      if (scopeGenerationRef.current === generation) setShareToken(token);
    } catch {
      if (scopeGenerationRef.current === generation) setShareError(true);
    } finally {
      if (scopeGenerationRef.current === generation) setShareOperation(null);
    }
  }

  async function handleCopyShare() {
    if (!shareUrl) return;
    const generation = scopeGenerationRef.current;
    setShareError(false);
    try {
      await navigator.clipboard.writeText(shareUrl);
      if (scopeGenerationRef.current !== generation) return;
      setShareCopied(true);
      window.setTimeout(() => {
        if (scopeGenerationRef.current === generation) setShareCopied(false);
      }, 2_000);
    } catch {
      if (scopeGenerationRef.current === generation) setShareError(true);
    }
  }

  async function handleRevokeShare() {
    if (!collectionId || !shareToken || shareOperation) return;
    const generation = scopeGenerationRef.current;
    setShareOperation("revoke");
    setShareError(false);
    try {
      await revokeShare("collection", collectionId);
      if (scopeGenerationRef.current !== generation) return;
      setShareToken(null);
      setShareCopied(false);
    } catch {
      if (scopeGenerationRef.current === generation) setShareError(true);
    } finally {
      if (scopeGenerationRef.current === generation) setShareOperation(null);
    }
  }
  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    const email = emailInput.trim();
    if (!canManageCollaborators || !collectionId || !email || inviting) return;
    const generation = scopeGenerationRef.current;

    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);

    try {
      await inviteCollectionCollaborator(collectionId, email);
      if (scopeGenerationRef.current !== generation) return;
      setEmailInput("");
      setInviteSuccess(t("dashboard.collaboratorInvitedSuccess"));
      await loadList(generation);
    } catch (cause) {
      if (scopeGenerationRef.current === generation) {
        setInviteError(t(collaboratorInviteMessageKey(cause)));
      }
    } finally {
      if (scopeGenerationRef.current === generation) setInviting(false);
    }
  }

  async function handleConfirmRevoke() {
    if (!canManageCollaborators || !collectionId || !revokeTarget || revoking) return;
    const generation = scopeGenerationRef.current;
    const targetId = revokeTarget.id;
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeCollectionCollaborator(collectionId, targetId);
      if (scopeGenerationRef.current !== generation) return;
      setCollaborators((current) => current.filter((item) => item.id !== targetId));
      setRevokeTarget(null);
    } catch {
      if (scopeGenerationRef.current === generation) setRevokeError(t("dashboard.revokeFailed"));
    } finally {
      if (scopeGenerationRef.current === generation) setRevoking(false);
    }
  }
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim());

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShareIcon aria-hidden="true" className="size-5 text-primary" />
              <span>{t("dashboard.collectionAccessTitle", { name: collection?.name ?? "" })}</span>
            </DialogTitle>
            <DialogDescription>
              {t("dashboard.collectionAccessDescription")}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as CollectionAccessTab)}>
            <TabsList className="w-full" variant="segmented">
              <TabsTrigger className="flex-1" value="share">
                <ShareIcon aria-hidden="true" className="size-4" />
                {t("dashboard.share")}
              </TabsTrigger>
              {canManageCollaborators ? (
                <TabsTrigger className="flex-1" value="collaborators">
                  <UsersIcon aria-hidden="true" className="size-4" />
                  {t("dashboard.collaborators")}
                </TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent className="grid gap-4" value="share">
              {shareLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <IconLoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />
                  <span>{t("common.loading")}</span>
                </div>
              ) : shareLoadError ? (
                <div className="flex flex-col items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground">
                  <p role="alert">{t("share.error")}</p>
                  <Button size="sm" type="button" variant="outline" onClick={() => void loadShare()}>
                    <RefreshCwIcon aria-hidden="true" className="size-3.5" data-icon="inline-start" />
                    {t("dashboard.retry")}
                  </Button>
                </div>
              ) : shareToken ? (
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("share.published")}
                    </span>
                    <Input
                      aria-label={t("share.copyLink")}
                      readOnly
                      value={shareUrl}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => void handleCopyShare()}>
                      {shareCopied ? (
                        <CheckIcon aria-hidden="true" className="size-4" data-icon="inline-start" />
                      ) : (
                        <CopyIcon aria-hidden="true" className="size-4" data-icon="inline-start" />
                      )}
                      {t(shareCopied ? "share.linkCopied" : "share.copyLink")}
                    </Button>
                    <Button
                      disabled={Boolean(shareOperation)}
                      type="button"
                      variant="outline"
                      onClick={() => void handleRevokeShare()}
                    >
                      {shareOperation === "revoke" ? (
                        <IconLoaderCircle aria-hidden="true" className="size-4 animate-spin" data-icon="inline-start" />
                      ) : null}
                      {t(shareOperation === "revoke" ? "share.revoking" : "share.revoke")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid justify-items-start gap-3 rounded-md border border-dashed p-4">
                  <p className="text-sm text-muted-foreground">{t("share.notPublished")}</p>
                  <Button
                    disabled={Boolean(shareOperation)}
                    type="button"
                    onClick={() => void handlePublishShare()}
                  >
                    {shareOperation === "publish" ? (
                      <IconLoaderCircle aria-hidden="true" className="size-4 animate-spin" data-icon="inline-start" />
                    ) : (
                      <ShareIcon aria-hidden="true" className="size-4" data-icon="inline-start" />
                    )}
                    {t(shareOperation === "publish" ? "share.publishing" : "share.publish")}
                  </Button>
                </div>
              )}
              {shareError ? (
                <p className="text-xs text-destructive" role="alert">{t("share.error")}</p>
              ) : null}
            </TabsContent>

            {canManageCollaborators ? (
              <TabsContent className="grid gap-4" value="collaborators">
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
                <Button size="sm" variant="outline" onClick={() => void loadList()}>
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

              </TabsContent>
            ) : null}
          </Tabs>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={canManageCollaborators && Boolean(revokeTarget)}
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
