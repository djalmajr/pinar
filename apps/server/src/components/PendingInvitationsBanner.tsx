import { Button } from "@pinar/ui";
import { useServerI18n } from "@/lib/i18n";
import type { CollectionInvitationRecord } from "@/lib/collection-collaborators";
import MailIcon from "~icons/lucide/mail";

interface PendingInvitationsBannerProps {
  invitations: CollectionInvitationRecord[];
  onOpenInvitations: () => void;
}

export function PendingInvitationsBanner({
  invitations,
  onOpenInvitations,
}: PendingInvitationsBannerProps) {
  const { t } = useServerI18n();

  if (invitations.length === 0) return null;

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm"
      role="region"
      aria-label={t("dashboard.pendingInvitationsTitle")}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <MailIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <p className="truncate font-medium text-foreground">
          {t("dashboard.invitationsBannerText", { count: invitations.length })}
        </p>
      </div>
      <Button
        className="shrink-0"
        size="sm"
        type="button"
        variant="default"
        onClick={onOpenInvitations}
      >
        {t("dashboard.viewInvitations")}
      </Button>
    </div>
  );
}
