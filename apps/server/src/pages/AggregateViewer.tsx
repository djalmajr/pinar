import { useEffect, useState } from "react";
import type { ProjectTreeCollection, ProjectTreeProject } from "@pinar/shared";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ScrollArea } from "@pinar/ui";
import { ServerShell } from "@/components/ServerShell";
import { isProjectTreeCollection, isProjectTreeProject, isRecord } from "@/lib/api-data";
import { useServerI18n } from "@/lib/i18n";
import CheckIcon from "~icons/lucide/check";
import CopyIcon from "~icons/lucide/copy";
import FileTextIcon from "~icons/lucide/file-text";
import FolderIcon from "~icons/lucide/folder";
import FolderKanbanIcon from "~icons/lucide/folder-kanban";

type Aggregate = ProjectTreeCollection | ProjectTreeProject;

interface AggregateViewerProps {
  id: string;
  kind: "collection" | "project";
}

function isProjectAggregate(aggregate: Aggregate): aggregate is ProjectTreeProject {
  return "collections" in aggregate;
}

export function AggregateViewer({ id, kind }: AggregateViewerProps) {
  const { t } = useServerI18n();
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAggregate() {
      try {
        const plural = kind === "project" ? "projects" : "collections";
        const response = await fetch(`/api/public/${plural}/${encodeURIComponent(id)}`);
        const data: unknown = await response.json();
        if (!response.ok || !isRecord(data)) return;
        if (kind === "project" && isProjectTreeProject(data.project)) setAggregate(data.project);
        if (kind === "collection" && isProjectTreeCollection(data.collection)) setAggregate(data.collection);
      } finally {
        setLoading(false);
      }
    }
    void loadAggregate();
  }, [id, kind]);

  async function copyMarkdown() {
    const response = await fetch(`/${kind === "project" ? "p" : "c"}/${id}.md`);
    if (!response.ok) throw new Error(`Unable to load Markdown (${response.status})`);
    await navigator.clipboard.writeText(await response.text());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  if (loading) {
    return (
      <ServerShell activePage="history">
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("aggregate.loading")}
        </div>
      </ServerShell>
    );
  }

  if (!aggregate) {
    return (
      <ServerShell activePage="history">
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("aggregate.notFound", { kind: t(kind === "project" ? "dashboard.project" : "dashboard.collection") })}
        </div>
      </ServerShell>
    );
  }

  const collections = isProjectAggregate(aggregate) ? aggregate.collections : [aggregate];
  const sessionCount = collections.reduce((count, collection) => count + collection.sessions.length, 0);
  return (
    <ServerShell activePage="history">
      <header className="flex min-h-14 shrink-0 items-center gap-4 border-b bg-card px-5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {kind === "project" ? <FolderKanbanIcon className="size-5" /> : <FolderIcon className="size-5" />}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{aggregate.name}</h1>
            <p className="text-xs text-muted-foreground">
              {t("aggregate.sessionCount", { count: sessionCount, label: t(sessionCount === 1 ? "aggregate.sessionSingular" : "aggregate.sessionPlural") })}
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={copyMarkdown}>
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? t("common.copied") : t("aggregate.copyMarkdown")}
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1 bg-muted/30">
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-6">
          {collections.map((collection) => (
            <section className="space-y-3" key={collection.id}>
              {kind === "project" && (
                <div className="flex items-center gap-2">
                  <FolderIcon className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{collection.name}</h2>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {collection.sessions.map((session) => (
                  <Card key={session.id}>
                    <CardHeader>
                      <CardTitle className="truncate text-sm">{session.page.title || t("dashboard.untitled")}</CardTitle>
                      <CardDescription className="truncate">{session.page.url}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">
                        {t("dashboard.pinCount", { count: session.pins.length, label: t(session.pins.length === 1 ? "dashboard.pinSingular" : "dashboard.pinPlural") })}
                      </span>
                      <Button render={<a href={`/v/${session.id}`} />} size="sm" variant="outline">
                        <FileTextIcon data-icon="inline-start" />
                        {t("aggregate.open")}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
                {collection.sessions.length === 0 && (
                  <Card className="sm:col-span-2 xl:col-span-3">
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      {t("aggregate.noSessions")}
                    </CardContent>
                  </Card>
                )}
              </div>
            </section>
          ))}
        </main>
      </ScrollArea>
    </ServerShell>
  );
}
