import type { ReactNode } from "react";
import { Button, cn, PinarMark } from "@pinar/ui";
import { Link } from "@tanstack/react-router";
import { isPaidAuthSession, useAuthSession } from "@/lib/auth-session";
import { useServerI18n } from "@/lib/i18n";
import { legalDocumentTitle } from "@/lib/legal-documents";
import { footerYear } from "@/lib/server-footer";
import { SERVER_VERSION_LABEL } from "@/lib/version";
import CoffeeIcon from "~icons/lucide/coffee";
import HeartIcon from "~icons/lucide/heart";

interface FairSourceSupportCardProps {
  className?: string;
  compact?: boolean;
}

interface ServerFooterProps extends FairSourceSupportCardProps {
  note?: ReactNode;
}

const FooterLegalDocumentIds = ["terms", "privacy"] as const;

export function FairSourceSupportCard({ className }: FairSourceSupportCardProps) {
  const { t } = useServerI18n();
  const session = useAuthSession();
  const isPaidAccount = isPaidAuthSession(session);
  if (isPaidAccount) return null;
  const description = t("pricing.supportDescription");
  const title = t("pricing.supportTitle");

  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-h-24 w-full flex-col items-stretch gap-4 rounded-xl border bg-card p-5",
        className,
      )}
    >
      <div className="text-left">
        <div className="flex items-center justify-start gap-2 text-sm font-semibold">
          <HeartIcon className="size-4 fill-pink-500 text-pink-500" />
          {title}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-start gap-2.5">
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
  const { language, t } = useServerI18n();
  const currentYear = footerYear();

  return (
    <footer className={cn("mt-auto w-full pt-8", className)} role="contentinfo">
      <FairSourceSupportCard compact={compact} />
      {note ? (
        <div className="mx-auto mt-6 flex min-h-9 w-full max-w-6xl items-center justify-center px-1 py-2 text-center text-[11px] font-normal leading-4 text-muted-foreground">
          {note}
        </div>
      ) : null}
      <div
        className={cn("mx-auto w-full max-w-6xl border-t border-border/60 text-[11px] font-normal leading-4 text-muted-foreground", note ? "mt-8" : "mt-6")}
      >
        <div
          className={cn(
            "flex flex-col gap-2 px-1 py-3",
            !compact && "sm:flex-row sm:items-center sm:justify-between",
          )}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              aria-label={t("common.pinarHome")}
              className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              preload="intent"
              to="/"
            >
              <PinarMark className="size-4 opacity-80" />
              <span className="font-medium text-foreground/80">Pinar</span>
            </Link>
            <span aria-hidden="true">·</span>
            <span>© {currentYear}</span>
            <span aria-hidden="true">·</span>
            <span>{t("common.serverVersion", { version: SERVER_VERSION_LABEL })}</span>
          </div>
          <nav
            aria-label={language === "pt" ? "Documentos legais" : "Legal documents"}
            className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", !compact && "sm:justify-end")}
          >
            {FooterLegalDocumentIds.map((document) => (
              <Link
                className="underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                key={document}
                params={{ document }}
                preload="intent"
                to="/legal/$document"
              >
                {legalDocumentTitle(document, language)}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
