import { useEffect, useState } from "react";
import { getPinColor, type Pin, type Session } from "@pinar/shared";
import {
  Badge,
  Button,
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
  PinBadge,
  ScrollArea,
  ScrollBar,
} from "@pinar/ui";
import ArrowLeftIcon from "~icons/lucide/arrow-left";
import ExternalLinkIcon from "~icons/lucide/external-link";
import MoonIcon from "~icons/lucide/moon";
import SunIcon from "~icons/lucide/sun";

interface WebViewerProps {
  sessionId: string;
}

interface DetailRowProps {
  label: string;
  value?: string | null;
}

function DetailRow({ label, value }: DetailRowProps) {
  if (!value) return null;
  return (
    <div className="grid gap-1 border-b py-3 last:border-b-0 sm:grid-cols-[8rem_1fr]">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

function isLocalServer() {
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

function pinNumber(pin: Pin, index: number) {
  return pin.number || index + 1;
}

export function WebViewer({ sessionId }: WebViewerProps) {
  const localServer = isLocalServer();
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [loading, setLoading] = useState(true);
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    async function loadSession() {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
        const data = await response.json();
        if (response.ok && data.session) setSession(data.session);
      } finally {
        setLoading(false);
      }
    }
    void loadSession();
  }, [sessionId]);

  function toggleTheme() {
    const nextDark = !isDark;
    setIsDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.setAttribute("data-theme", nextDark ? "dark" : "light");
    localStorage.setItem("pinar-theme", nextDark ? "dark" : "light");
  }

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading viewer…</div>;
  }

  if (!session) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-muted/40">
        <h1 className="text-lg font-semibold">Annotation session not found</h1>
        <Button render={<a href="/history" />} variant="outline">
          <ArrowLeftIcon data-icon="inline-start" />
          Back to history
        </Button>
      </div>
    );
  }

  const selectedIndex = selectedPin ? session.pins.indexOf(selectedPin) : -1;
  const selectedNumber = selectedPin ? pinNumber(selectedPin, Math.max(0, selectedIndex)) : 0;
  const selectedColor = selectedPin?.color || getPinColor(selectedNumber);
  const selectedCoordinates = selectedPin?.coords || selectedPin?.anchor;
  const selectedBox = selectedPin?.areaBox || selectedPin?.box;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="z-20 flex shrink-0 items-center justify-between border-b bg-card px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button aria-label="Back to history" render={<a href="/history" />} size="icon" title="Back to history" variant="outline">
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{session.page?.title || "Annotation"}</h1>
              <Badge variant={localServer ? "secondary" : session.isPermanent || session.plan === "pro" ? "pro" : "outline"}>
                {localServer ? "Local" : session.isPermanent || session.plan === "pro" ? "Pro" : "7-day retention"}
              </Badge>
            </div>
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
        <div className="flex shrink-0 items-center gap-2">
          <Button render={<a href={`/v/${session.id}.md`} target="_blank" />} variant="outline">Markdown</Button>
          <Button aria-label="Toggle theme" size="icon" title="Toggle theme" variant="outline" onClick={toggleTheme}>
            {isDark ? <SunIcon /> : <MoonIcon />}
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem]">
        <ScrollArea className="min-h-0 min-w-0 bg-muted/40">
          <div className="flex min-h-full min-w-max items-start justify-center p-6">
            <Card className="w-fit max-w-none p-0 shadow-lg">
              {session.shotUrl ? (
                <img alt="Annotated page screenshot" className="block h-auto max-w-none" src={session.shotUrl} />
              ) : (
                <CardContent className="flex min-h-80 min-w-96 items-center justify-center text-sm text-muted-foreground">
                  Screenshot unavailable
                </CardContent>
              )}
            </Card>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <aside className="flex min-h-0 flex-col border-l bg-card">
          <div className="shrink-0 border-b px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {session.pins?.length || 0} {(session.pins?.length || 0) === 1 ? "pin" : "pins"}
            </h2>
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
                    title={`Open pin ${number}`}
                    variant="ghost"
                    onClick={() => setSelectedPin(pin)}
                  >
                    <Card className="w-full gap-3 py-3 transition-colors hover:ring-primary/35">
                      <CardHeader className="grid grid-cols-[auto_1fr] items-start gap-x-2 px-3">
                        <PinBadge color={color} number={number} />
                        <div className="min-w-0">
                          <CardTitle className="text-sm">{isArea ? "Area selection" : pin.tag || pin.label || "Element"}</CardTitle>
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
      </div>
      <Dialog open={Boolean(selectedPin)} onOpenChange={(open) => !open && setSelectedPin(null)}>
        <DialogContent className="max-w-2xl" showCloseButton>
          {selectedPin && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <PinBadge color={selectedColor} number={selectedNumber} />
                  <div>
                    <DialogTitle>Pin {selectedNumber}</DialogTitle>
                    <DialogDescription>Complete annotation context</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <ScrollArea className="max-h-[65vh] pr-3">
                <div className="space-y-4">
                  <section className="rounded-lg border bg-muted/40 p-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comment</h3>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{selectedPin.comment}</p>
                  </section>
                  <dl className="rounded-lg border px-4">
                    <DetailRow label="Type" value={selectedPin.type === "area" || selectedPin.kind === "area" ? "Area selection" : "Element"} />
                    <DetailRow label="Element" value={selectedPin.tag || selectedPin.label} />
                    <DetailRow label="Selector" value={selectedPin.selector} />
                    <DetailRow label="DOM path" value={selectedPin.domPath || selectedPin.path} />
                    <DetailRow label="Visible text" value={selectedPin.innerText || selectedPin.text} />
                    <DetailRow
                      label="Coordinates"
                      value={selectedCoordinates ? `x=${selectedCoordinates.x}, y=${selectedCoordinates.y}` : null}
                    />
                    <DetailRow
                      label="Area"
                      value={selectedBox ? `${selectedBox.width} × ${selectedBox.height}px at x=${selectedBox.x}, y=${selectedBox.y}` : null}
                    />
                  </dl>
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
