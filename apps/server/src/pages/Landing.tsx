import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ScrollArea,
} from "@pinar/ui";
import { Link } from "@tanstack/react-router";
import { ServerShell } from "@/components/ServerShell";
import { ServerFooter } from "@/components/ServerFooter";
import { CHROME_EXTENSION_URL } from "@/lib/chrome-extension";
import { useDocumentMeta } from "@/lib/document-meta";
import { pinarRuntime } from "@/lib/server-header";
import { useServerI18n } from "@/lib/i18n";
import BotIcon from "~icons/lucide/bot";
import CloudIcon from "~icons/lucide/cloud";
import CodeIcon from "~icons/lucide/code-xml";
import DownloadIcon from "~icons/lucide/download";
import MapPinIcon from "~icons/lucide/map-pin";
import ShieldCheckIcon from "~icons/lucide/shield-check";
import SparklesIcon from "~icons/lucide/sparkles";

export { CHROME_EXTENSION_URL };

export function LandingPage() {
  const { t } = useServerI18n();
  const isLocal = pinarRuntime() === "local";
  useDocumentMeta(t("landing.title"), t("landing.description"));
  const features = [
    { description: t("landing.pinDescription"), icon: MapPinIcon, title: t("landing.pinTitle") },
    { description: t("landing.contextDescription"), icon: CodeIcon, title: t("landing.contextTitle") },
    { description: t("landing.aiDescription"), icon: BotIcon, title: t("landing.aiTitle") },
  ];

  return (
    <ServerShell activePage="home">
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-14">
          <section className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <Badge variant="proSoft">
              <SparklesIcon data-icon="inline-start" />
              {t("landing.badge")}
            </Badge>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              {t("landing.title")}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("landing.description")}
            </p>
            {isLocal ? null : (
              <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
                <Button className="text-xs" render={<a href={CHROME_EXTENSION_URL} rel="noopener noreferrer" target="_blank" />} size="lg">
                  <DownloadIcon data-icon="inline-start" />
                  {t("landing.installExtension")}
                </Button>
              </div>
            )}
          </section>

          <section aria-label={t("landing.howItWorks")} className="mt-14 grid gap-4 md:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title}>
                <CardHeader>
                  <div className="flex items-center gap-2 text-card-foreground">
                    <feature.icon className="size-4 shrink-0 text-current" />
                    <CardTitle>{feature.title}</CardTitle>
                  </div>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </section>

          <section className={`mt-8 grid gap-4 ${isLocal ? "" : "md:grid-cols-2"}`}>
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center gap-2 text-card-foreground">
                  <ShieldCheckIcon className="size-4 shrink-0 text-current" />
                  <CardTitle>{t("landing.privateTitle")}</CardTitle>
                </div>
                <CardDescription>
                  {t("landing.privateDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">{t("landing.privateNote")}</p>
              </CardContent>
              <CardFooter className="mt-auto">
                <Button render={<Link preload="intent" search={{ session: undefined }} to="/app" />} size="sm" variant="outline">{t("landing.openLocalDashboard")}</Button>
              </CardFooter>
            </Card>
            {isLocal ? null : (
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center gap-2 text-card-foreground">
                    <CloudIcon className="size-4 shrink-0 text-current" />
                    <CardTitle>{t("landing.shareTitle")}</CardTitle>
                  </div>
                  <CardDescription>
                    {t("landing.shareDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">{t("landing.sameExperience")}</p>
                </CardContent>
                <CardFooter className="mt-auto">
                  <Button render={<Link preload="intent" to="/pricing" />} size="sm" variant="outline">{t("landing.comparePlans")}</Button>
                </CardFooter>
              </Card>
            )}
          </section>

          <ServerFooter className="pt-12" />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}
