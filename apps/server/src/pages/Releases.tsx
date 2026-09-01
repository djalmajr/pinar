import { type ReactNode, createContext, useContext } from "react";
import { Badge, Button, ScrollArea } from "@pinar/ui";
import { Link } from "@tanstack/react-router";
import { ServerFooter } from "@/components/ServerFooter";
import { ServerShell } from "@/components/ServerShell";
import { useDocumentMeta } from "@/lib/document-meta";
import {
  defaultReleaseContent,
  findProductRelease,
  loadReleaseContent,
  type ReleaseContent,
} from "@/lib/release-content";
import { useServerI18n } from "@/lib/i18n";
import { useLocalizedContent } from "@/lib/use-localized-content";
import ArrowLeftIcon from "~icons/lucide/arrow-left";
import ArrowRightIcon from "~icons/lucide/arrow-right";
import CalendarIcon from "~icons/lucide/calendar-days";
import CheckIcon from "~icons/lucide/check";

const ReleaseContentContext = createContext<ReleaseContent | null>(null);

function useActiveReleaseContent() {
  const content = useContext(ReleaseContentContext);
  if (!content)
    throw new Error("Release content must be loaded before rendering");
  return content;
}

function ReleaseContentBoundary({ children }: { children: ReactNode }) {
  const { language } = useServerI18n();
  const content = useLocalizedContent(
    "releases",
    language,
    loadReleaseContent,
    defaultReleaseContent,
  );
  return (
    <ReleaseContentContext.Provider value={content}>
      {children}
    </ReleaseContentContext.Provider>
  );
}

function ReleasesPageContent() {
  const content = useActiveReleaseContent();
  const { language, releases, ui } = content;
  useDocumentMeta(ui.pageTitle, ui.metaDescription);

  return (
    <ServerShell activePage="releases">
      <ScrollArea className="min-h-0 flex-1">
        <main
          className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-12 sm:py-16"
          data-content-language={content.language}
        >
          <section className="mx-auto w-full max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              {ui.pageTitle}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              {ui.pageDescription}
            </p>
          </section>

          <div className="mt-14 w-full border-t">
            {releases.map((release) => (
              <article
                className="grid gap-5 border-b py-8 last:border-b-0 md:grid-cols-[9rem_minmax(0,1fr)_auto] md:items-start"
                key={release.tag}
              >
                <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-2">
                  <Badge>{release.tag}</Badge>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarIcon className="size-3.5" />
                    {new Intl.DateTimeFormat(language, {
                      day: "numeric",
                      month: "short",
                      timeZone: "UTC",
                      year: "numeric",
                    }).format(new Date(`${release.date}T00:00:00Z`))}
                  </span>
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">
                    {release.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {release.summary}
                  </p>
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {release.changes.slice(0, 4).map((change) => (
                      <li
                        className="flex items-start gap-2 text-sm"
                        key={change.id}
                      >
                        <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span>{change.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button
                  className="justify-self-start md:justify-self-end"
                  render={
                    <Link
                      params={{ version: release.tag.slice(1) }}
                      preload="intent"
                      to="/releases/$version"
                    />
                  }
                  size="sm"
                  variant="ghost"
                >
                  {ui.viewDetails}
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </article>
            ))}
          </div>
          <ServerFooter className="pt-12" />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}

export function ReleasesPage() {
  return (
    <ReleaseContentBoundary>
      <ReleasesPageContent />
    </ReleaseContentBoundary>
  );
}

function ReleaseDetailPageContent({ version }: { version: string }) {
  const content = useActiveReleaseContent();
  const { language, releases, ui } = content;
  const release = findProductRelease(content, version);
  useDocumentMeta(
    release ? `${release.tag} — ${release.title}` : ui.releaseNotFound,
    release ? release.summary : ui.releaseNotFoundDescription,
  );

  if (!release) {
    return (
      <ServerShell activePage="releases">
        <main
          className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-4 px-5 text-center"
          data-content-language={content.language}
        >
          <Badge variant="outline">404</Badge>
          <h1 className="text-2xl font-bold">{ui.releaseNotFound}</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            {ui.historyDescription}
          </p>
          <Button
            render={
              <Link
                activeOptions={{ exact: true }}
                preload="intent"
                to="/releases"
              />
            }
            variant="outline"
          >
            <ArrowLeftIcon data-icon="inline-start" />
            {ui.backToReleases}
          </Button>
        </main>
      </ServerShell>
    );
  }
  const releaseIndex = releases.indexOf(release);
  const previousRelease = releases[releaseIndex + 1] ?? null;
  const nextRelease = releaseIndex > 0 ? releases[releaseIndex - 1] : null;

  return (
    <ServerShell activePage="releases">
      <ScrollArea className="min-h-0 flex-1">
        <main
          className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-10"
          data-content-language={content.language}
        >
          <div className="w-full">
            <Link
              activeOptions={{ exact: true }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline"
              preload="intent"
              to="/releases"
            >
              <ArrowLeftIcon className="size-4" />
              {ui.allReleases}
            </Link>

            <header className="mt-8">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <CalendarIcon className="size-4" />
                  {new Intl.DateTimeFormat(language, {
                    dateStyle: "long",
                    timeZone: "UTC",
                  }).format(new Date(`${release.date}T00:00:00Z`))}
                </span>
                <Badge variant="secondary">{release.tag}</Badge>
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                {release.title}
              </h1>
              <p className="mt-4 text-base leading-7 text-muted-foreground">
                {release.summary}
              </p>
            </header>

            <section aria-labelledby="release-changes" className="mt-10">
              <Badge id="release-changes" variant="secondary">
                {ui.whatChanged}
              </Badge>
              <ul className="mt-5 flex flex-col gap-5">
                {release.changes.map((change) => (
                  <li className="flex items-start gap-3" key={change.id}>
                    <span
                      aria-hidden="true"
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground"
                    />
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold">
                        {change.title}
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {change.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <nav
              aria-label={ui.releaseNavigation}
              className="mt-12 grid gap-8 border-t pt-10 sm:grid-cols-2"
            >
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {ui.previous}
                </span>
                {previousRelease ? (
                  <Link
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                    params={{ version: previousRelease.tag.slice(1) }}
                    preload="intent"
                    to="/releases/$version"
                  >
                    {previousRelease.title}
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {ui.firstRelease}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1 sm:items-end sm:text-right">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {ui.next}
                </span>
                {nextRelease ? (
                  <Link
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                    params={{ version: nextRelease.tag.slice(1) }}
                    preload="intent"
                    to="/releases/$version"
                  >
                    {nextRelease.title}
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {ui.latestRelease}
                  </span>
                )}
              </div>
            </nav>
          </div>
          <ServerFooter className="pt-4" />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}

export function ReleaseDetailPage({ version }: { version: string }) {
  return (
    <ReleaseContentBoundary>
      <ReleaseDetailPageContent version={version} />
    </ReleaseContentBoundary>
  );
}
