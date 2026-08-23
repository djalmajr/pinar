import type { ReactNode } from "react";
import { Button, cn, PinarMark } from "@pinar/ui";
import { Link } from "@tanstack/react-router";
import { isPaidAuthSession, useAuthSession } from "@/lib/auth-session";
import { useServerI18n } from "@/lib/i18n";
import { legalDocumentTitle } from "@/lib/legal-documents";
import { footerYear } from "@/lib/server-footer";
import { SERVER_VERSION } from "@/lib/version";
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

export function FairSourceSupportCard({ className, compact = false }: FairSourceSupportCardProps) {
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
        "mx-auto flex min-h-24 w-full max-w-4xl items-center justify-between gap-4 rounded-xl border bg-card p-5",
        compact ? "flex-col items-stretch" : "flex-col sm:flex-row",
        className,
      )}
    >
      <div className={cn("text-center sm:text-left", compact && "text-left")}>
        <div className={cn("flex items-center justify-center gap-2 text-sm font-semibold sm:justify-start", compact && "justify-start")}>
          <HeartIcon className="size-4 fill-pink-500 text-pink-500" />
          {title}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
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
  const { language, t } = useServerI18n();
  const currentYear = footerYear();

  return (
    <div className={cn("mt-auto w-full pt-8", className)}>
      <FairSourceSupportCard compact={compact} />
      <footer className="mx-auto mt-8 w-full max-w-4xl overflow-hidden rounded-xl border bg-card/70 text-xs font-normal leading-4 text-muted-foreground shadow-xs">
        <div
          className={cn(
            "grid gap-6 px-5 py-5",
            !compact && "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start",
          )}
        >
          <div className="max-w-sm">
            <Link
              aria-label={t("common.pinarHome")}
              className="inline-flex items-center gap-2 text-foreground"
              preload="intent"
              to="/"
            >
              <PinarMark className="size-5" />
              <span className="text-sm font-bold">Pinar</span>
            </Link>
            <p className="mt-2 max-w-xs text-sm leading-5">{t("landing.badge")}</p>
          </div>
          <div className={cn("flex flex-col items-start gap-2", !compact && "sm:min-w-48")}>
            <p className="font-semibold uppercase tracking-[0.12em] text-foreground">{t("footer.legal")}</p>
            <nav
              aria-label={language === "pt" ? "Documentos legais" : "Legal documents"}
              className="flex flex-col items-start gap-1"
            >
              {FooterLegalDocumentIds.map((document) => (
                <Link
                  className="rounded-md py-1 text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <div className="border-t bg-muted/20">
          {note ? <div className="flex min-h-10 items-center justify-center border-b px-5 py-3 text-center">{note}</div> : null}
          <div
            className={cn(
              "flex flex-col gap-2 px-5 py-3",
              !compact && "sm:flex-row sm:items-center sm:justify-between",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>© {currentYear} Pinar</span>
              <span aria-hidden="true">·</span>
              <span>{t("common.serverVersion", { version: SERVER_VERSION })}</span>
            </div>
            <span className={cn(!compact && "sm:text-right")}>{t("landing.footer")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
