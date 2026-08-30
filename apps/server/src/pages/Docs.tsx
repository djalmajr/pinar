import {
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ScrollArea,
} from "@pinar/ui";
import { Link } from "@tanstack/react-router";
import { ServerFooter } from "@/components/ServerFooter";
import { ServerShell } from "@/components/ServerShell";
import { CHROME_EXTENSION_URL } from "@/lib/chrome-extension";
import { useDocumentMeta } from "@/lib/document-meta";
import { useServerI18n } from "@/lib/i18n";
import { pinarRuntime } from "@/lib/server-header";
import DownloadIcon from "~icons/lucide/download";
import MapPinIcon from "~icons/lucide/map-pin";
import PanelsTopLeftIcon from "~icons/lucide/panels-top-left";

export function DocsPage() {
  const { t } = useServerI18n();
  const isLocal = pinarRuntime() === "local";
  useDocumentMeta(t("docs.title"), t("docs.description"));

  return (
    <ServerShell>
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-10">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
            <header className="border-b pb-6">
              <h1 className="text-3xl font-bold tracking-tight">{t("docs.title")}</h1>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{t("docs.description")}</p>
            </header>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2 text-card-foreground">
                  <DownloadIcon className="size-4 shrink-0 text-current" />
                  <CardTitle>{t("docs.extensionTitle")}</CardTitle>
                </div>
                <CardDescription>{t("docs.extensionDescription")}</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button
                  render={<a href={CHROME_EXTENSION_URL} rel="noopener noreferrer" target="_blank" />}
                >
                  <DownloadIcon data-icon="inline-start" />
                  {t("landing.installExtension")}
                </Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2 text-card-foreground">
                  <MapPinIcon className="size-4 shrink-0 text-current" />
                  <CardTitle>{t("docs.captureTitle")}</CardTitle>
                </div>
                <CardDescription>{t("docs.captureDescription")}</CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2 text-card-foreground">
                  <PanelsTopLeftIcon className="size-4 shrink-0 text-current" />
                  <CardTitle>{t("docs.workspaceTitle")}</CardTitle>
                </div>
                <CardDescription>{t("docs.workspaceDescription")}</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button render={<Link preload="intent" search={{ session: undefined }} to="/app" />} variant="outline">
                  {isLocal ? t("landing.openLocalDashboard") : t("common.dashboard")}
                </Button>
              </CardFooter>
            </Card>
          </div>
          <ServerFooter className="pt-12" />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}
