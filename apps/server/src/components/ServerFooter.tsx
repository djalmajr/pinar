import type { ReactNode } from "react";
import { Button, cn } from "@pinar/ui";
import { Link } from "@tanstack/react-router";
import { isPaidAuthSession, useAuthSession } from "@/lib/auth-session";
import { useServerI18n } from "@/lib/i18n";
import { LegalDocumentIds, legalDocumentTitle } from "@/lib/legal-documents";
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

  return (
    <div className={cn("mt-auto w-full pt-8", className)}>
      <FairSourceSupportCard compact={compact} />
      <footer className="mt-6 flex flex-col items-center gap-1.5 text-center text-xs font-normal leading-4 text-muted-foreground">
        {note ? <div className="flex h-4 items-center justify-center">{note}</div> : null}
        <nav aria-label={language === "pt" ? "Documentos legais" : "Legal documents"} className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {LegalDocumentIds.map((document) => (
            <Link className="hover:text-foreground hover:underline" key={document} params={{ document }} preload="intent" to="/legal/$document">
              {legalDocumentTitle(document, language)}
            </Link>
          ))}
        </nav>
        <span className="flex h-4 items-center justify-center">{t("landing.footer")}</span>
        <span className="flex h-4 items-center justify-center">
          {t("common.serverVersion", { version: SERVER_VERSION })}
        </span>
      </footer>
    </div>
  );
}
