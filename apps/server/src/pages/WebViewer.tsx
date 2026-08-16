import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { getPinColor, type Pin, type Session } from "@pinar/shared";
import { ImageZoomDialog } from "@/components/ImageZoomDialog";
import { ServerShell } from "@/components/ServerShell";
import { ServerFooter } from "@/components/ServerFooter";
import { isRecord, isSession } from "@/lib/api-data";
import { useServerI18n } from "@/lib/i18n";
import { formatPinMarkdown } from "@/lib/pin-markdown";
import { formatSessionDate } from "@/lib/session-date";
import {
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PinBadge,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@pinar/ui";
import ArrowLeftIcon from "~icons/lucide/arrow-left";
import BotIcon from "~icons/lucide/bot";
import CalendarIcon from "~icons/lucide/calendar-days";
import CheckIcon from "~icons/lucide/check";
import ChevronDownIcon from "~icons/lucide/chevron-down";
import CopyIcon from "~icons/lucide/copy";
import ExternalLinkIcon from "~icons/lucide/external-link";
import FileTextIcon from "~icons/lucide/file-text";
import MessageCircleIcon from "~icons/lucide/message-circle";
import PanelRightCloseIcon from "~icons/lucide/panel-right-close";
import PanelRightOpenIcon from "~icons/lucide/panel-right-open";
import SparklesIcon from "~icons/lucide/sparkles";

interface WebViewerProps {
  sessionId: string;
}

function pinNumber(pin: Pin, index: number) {
  return pin.number || index + 1;
}

export function WebViewer({ sessionId }: WebViewerProps) {
  const { language, t } = useServerI18n();
  const [imageZoomOpen, setImageZoomOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageCopied, setPageCopied] = useState(false);
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    async function loadSession() {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
        const data: unknown = await response.json();
        if (response.ok && isRecord(data) && isSession(data.session)) setSession(data.session);
      } finally {
        setLoading(false);
      }
    }
    void loadSession();
  }, [sessionId]);

  function markdownUrl() {
    return new URL(`/v/${sessionId}.md`, window.location.origin).toString();
  }

  async function copyPage() {
    const response = await fetch(markdownUrl());
    if (!response.ok) throw new Error(`Unable to load Markdown (${response.status})`);
    await navigator.clipboard.writeText(await response.text());
    setPageCopied(true);
    window.setTimeout(() => setPageCopied(false), 2_000);
  }

  function openInAssistant(assistant: "chatgpt" | "claude") {
    const prompt = t("viewer.reviewPrompt", { url: markdownUrl() });
    const url =
      assistant === "chatgpt"
        ? `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`
        : `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (loading) {
    return (
      <ServerShell activePage="history">
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("viewer.loading")}
        </div>
      </ServerShell>
    );
  }

  if (!session) {
    return (
      <ServerShell activePage="history" className="bg-muted/40">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
          <h1 className="text-lg font-semibold">{t("viewer.notFound")}</h1>
          <Button render={<Link preload="intent" to="/history" />} variant="outline">
            <ArrowLeftIcon data-icon="inline-start" />
            {t("viewer.backHistory")}
          </Button>
        </div>
      </ServerShell>
    );
  }

  const selectedIndex = selectedPin ? session.pins.indexOf(selectedPin) : -1;
  const selectedNumber = selectedPin ? pinNumber(selectedPin, Math.max(0, selectedIndex)) : 0;
  const selectedColor = selectedPin?.color || getPinColor(selectedNumber);
  const selectedMarkdown = selectedPin ? formatPinMarkdown(selectedPin, selectedNumber) : "";

  return (
    <ServerShell activePage="history">
      <header className="relative z-20 flex min-h-14 shrink-0 items-center gap-4 border-b bg-card px-5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            aria-label={t("viewer.backHistory")}
            render={<Link preload="intent" to="/history" />}
            size="icon-sm"
            title={t("viewer.backHistory")}
            variant="ghost"
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{session.page?.title || t("viewer.annotation")}</h1>
            <a
              className="mt-0.5 flex max-w-xl items-center gap-1 truncate text-xs text-muted-foreground hover:text-primary"
              href={session.page?.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <span className="truncate">{session.page?.url}</span>
              <ExternalLinkIcon className="size-3 shrink-0" />
            </a>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ButtonGroup aria-label={t("viewer.pageActions")}>
            <Button type="button" variant="outline" onClick={copyPage}>
              {pageCopied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
              {pageCopied ? t("common.copied") : t("viewer.copyPage")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={t("viewer.moreActions")}
                    size="icon"
                    title={t("viewer.moreActions")}
                    variant="outline"
                  />
                }
              >
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    render={<a href={`/v/${session.id}.md`} rel="noopener noreferrer" target="_blank" />}
                  >
                    <FileTextIcon />
                    {t("viewer.viewMarkdown")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openInAssistant("chatgpt")}>
                    <BotIcon />
                    {t("viewer.openChatGPT")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openInAssistant("claude")}>
                    <SparklesIcon />
                    {t("viewer.openClaude")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
          <Button
            aria-label={t(sidebarOpen ? "viewer.hidePins" : "viewer.showPins")}
            size="icon"
            title={t(sidebarOpen ? "viewer.hidePins" : "viewer.showPins")}
            type="button"
            variant="outline"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            {sidebarOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
          </Button>
        </div>
      </header>
      <div
        className={`grid min-h-0 flex-1 ${sidebarOpen ? "grid-cols-[minmax(0,1fr)_22rem]" : "grid-cols-1"}`}
      >
        <ScrollArea className="min-h-0 min-w-0 bg-card">
          <div className="flex min-h-full flex-col gap-8 p-6">
            <div className="flex items-start justify-center">
              {session.shotUrl ? (
                <Button
                  aria-label={t("viewer.openZoom")}
                  className="h-auto w-full max-w-[96rem] cursor-zoom-in overflow-hidden p-0 shadow-lg"
                  title={t("viewer.openZoom")}
                  type="button"
                  variant="outline"
                  onClick={() => setImageZoomOpen(true)}
                >
                  <img
                    alt={t("viewer.annotatedScreenshot")}
                    className="block h-auto w-full object-contain transition-opacity group-hover/button:opacity-90"
                    src={session.shotUrl}
                  />
                </Button>
              ) : (
                <Card className="w-full max-w-[96rem] p-0 shadow-lg">
                  <CardContent className="flex min-h-80 min-w-96 items-center justify-center text-sm text-muted-foreground">
                    {t("viewer.screenshotUnavailable")}
                  </CardContent>
                </Card>
              )}
            </div>
            <ServerFooter className="mt-0 pb-2 pt-0" />
          </div>
        </ScrollArea>
        {sidebarOpen ? (
          <aside className="flex min-h-0 flex-col border-l bg-card">
            <div className="shrink-0 border-b px-4 py-3">
              <div className="flex min-w-0 items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
                <time className="inline-flex min-w-0 items-center gap-1.5" dateTime={session.createdAt}>
                  <CalendarIcon className="shrink-0 text-primary" />
                  <span className="truncate">{formatSessionDate(session, language)}</span>
                </time>
                <h2 className="inline-flex shrink-0 items-center gap-1.5">
                  <MessageCircleIcon className="text-primary" />
                  {t("dashboard.pinCount", {
                    count: session.pins?.length || 0,
                    label: t((session.pins?.length || 0) === 1 ? "dashboard.pinSingular" : "dashboard.pinPlural"),
                  })}
                </h2>
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-3 p-4">
                {(session.pins || []).map((pin, index) => {
                  const number = pinNumber(pin, index);
                  const color = pin.color || getPinColor(number);
                  const isArea = pin.type === "area" || pin.kind === "area";
                  return (
                    <Button
                      className="h-auto w-full justify-start p-0 text-left whitespace-normal"
                      key={`${session.id}-${number}`}
                      title={t("viewer.openPin", { number })}
                      variant="ghost"
                      onClick={() => setSelectedPin(pin)}
                    >
                      <Card className="w-full gap-3 py-3 transition-colors hover:ring-primary/35">
                        <CardHeader className="grid grid-cols-[auto_1fr] items-start gap-x-2 px-3">
                          <PinBadge color={color} number={number} />
                          <div className="min-w-0">
                            <CardTitle className="text-sm">
                              {isArea ? t("viewer.areaSelection") : pin.tag || pin.label || t("viewer.element")}
                            </CardTitle>
                            <CardDescription className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-foreground">
                              {pin.comment}
                            </CardDescription>
                          </div>
                        </CardHeader>
                        {(pin.selector || pin.domPath || pin.path) && (
                          <CardContent className="px-3">
                            <code className="block truncate rounded-md bg-muted px-2 py-1.5 text-[10px] text-muted-foreground">
                              {pin.selector || pin.domPath || pin.path}
                            </code>
                          </CardContent>
                        )}
                      </Card>
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>
        ) : null}
      </div>
      {session.shotUrl && (
        <ImageZoomDialog
          alt={session.page?.title || t("viewer.annotatedScreenshot")}
          open={imageZoomOpen}
          src={session.shotUrl}
          onOpenChange={setImageZoomOpen}
        />
      )}
      <Dialog open={Boolean(selectedPin)} onOpenChange={(open) => !open && setSelectedPin(null)}>
        <DialogContent className="sm:max-w-5xl" outsideScroll showCloseButton>
          {selectedPin && (
            <Tabs defaultValue="preview">
              <div className="flex items-start justify-between gap-4 pr-9">
                <DialogHeader className="min-w-0">
                  <div className="flex items-center gap-3">
                    <PinBadge color={selectedColor} number={selectedNumber} />
                    <div>
                      <DialogTitle>{t("viewer.pinTitle", { number: selectedNumber })}</DialogTitle>
                      <DialogDescription>{t("viewer.completeContext")}</DialogDescription>
                    </div>
                  </div>
                </DialogHeader>
                <TabsList className="shrink-0" variant="segmented">
                  <TabsTrigger value="preview">{t("viewer.preview")}</TabsTrigger>
                  <TabsTrigger value="raw">{t("viewer.raw")}</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="preview">
                <div className="rounded-lg border bg-card">
                  <article className="flex flex-col gap-4 p-5 text-sm leading-relaxed">
                    <ReactMarkdown
                      components={{
                        h1: (props) => <h1 className="text-xl font-semibold tracking-tight" {...props} />,
                        h2: (props) => <h2 className="border-b pb-2 text-sm font-semibold" {...props} />,
                        p: (props) => <p className="whitespace-pre-wrap text-foreground" {...props} />,
                        ul: (props) => <ul className="flex list-disc flex-col gap-2 pl-5" {...props} />,
                        code: (props) => <code className="break-words font-mono text-xs [overflow-wrap:anywhere]" {...props} />,
                        pre: (props) => <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted p-3 text-xs [overflow-wrap:anywhere]" {...props} />,
                      }}
                    >
                      {selectedMarkdown}
                    </ReactMarkdown>
                  </article>
                </div>
              </TabsContent>
              <TabsContent value="raw">
                <div className="rounded-lg border bg-muted/40">
                  <pre className="whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
                    <code>{selectedMarkdown}</code>
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </ServerShell>
  );
}
