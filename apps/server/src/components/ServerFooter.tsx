import type { ReactNode } from "react";
import { Button, cn } from "@pinar/ui";
import { useServerI18n } from "@/lib/i18n";
import { SERVER_VERSION } from "@/lib/version";
import CoffeeIcon from "~icons/lucide/coffee";
import HeartIcon from "~icons/lucide/heart";

interface OpenSourceSupportCardProps {
  className?: string;
  compact?: boolean;
}

interface ServerFooterProps extends OpenSourceSupportCardProps {
  note?: ReactNode;
}

export function OpenSourceSupportCard({ className, compact = false }: OpenSourceSupportCardProps) {
  const { t } = useServerI18n();

  return (
    <section
      aria-label={t("pricing.supportTitle")}
      className={cn(
        "mx-auto flex w-full max-w-4xl items-center justify-between gap-4 rounded-xl border bg-card p-5",
        compact ? "flex-col items-stretch" : "flex-col sm:flex-row",
        className,
      )}
    >
      <div className={cn("text-center sm:text-left", compact && "text-left")}>
        <div className={cn("flex items-center justify-center gap-2 text-sm font-semibold sm:justify-start", compact && "justify-start")}>
          <HeartIcon className="size-4 fill-pink-500 text-pink-500" />
          {t("pricing.supportTitle")}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("pricing.supportDescription")}</p>
      </div>
      <div className={cn("flex shrink-0 flex-wrap items-center justify-center gap-2.5", compact && "justify-start")}>
        <Button
          render={<a href="https://buymeacoffee.com/djalmajr" rel="noopener noreferrer" target="_blank" />}
          size="sm"
          variant="coffee"
        >
          <CoffeeIcon data-icon="inline-start" />
          {t("pricing.buyCoffee")}
        </Button>
        <Button
          render={<a href="https://github.com/sponsors/djalmajr" rel="noopener noreferrer" target="_blank" />}
          size="sm"
          variant="sponsor"
        >
          <HeartIcon className="fill-current" data-icon="inline-start" />
          {t("pricing.sponsorGitHub")}
        </Button>
      </div>
    </section>
  );
}

export function ServerFooter({ className, compact = false, note }: ServerFooterProps) {
  const { t } = useServerI18n();

  return (
    <div className={cn("mt-auto w-full pt-8", className)}>
      <OpenSourceSupportCard compact={compact} />
      <footer className="mt-6 flex flex-col items-center gap-1.5 text-center text-xs font-normal leading-4 text-muted-foreground">
        {note ? <div className="flex h-4 items-center justify-center">{note}</div> : null}
        <span className="flex h-4 items-center justify-center">{t("landing.footer")}</span>
        <span className="flex h-4 items-center justify-center">
          {t("common.serverVersion", { version: SERVER_VERSION })}
        </span>
      </footer>
    </div>
  );
}
