import { useEffect, useMemo, useState } from "react";
import { formatClipboardText, type Session } from "@pinar/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  PinarMark,
  ScrollArea,
} from "@pinar/ui";
import CheckIcon from "~icons/lucide/check";
import CoffeeIcon from "~icons/lucide/coffee";
import CopyIcon from "~icons/lucide/copy";
import ExternalLinkIcon from "~icons/lucide/external-link";
import GithubIcon from "~icons/radix-icons/github-logo";
import HardDriveIcon from "~icons/lucide/hard-drive";
import HeartIcon from "~icons/lucide/heart";
import MessageCircleIcon from "~icons/lucide/message-circle";
import MoonIcon from "~icons/lucide/moon";
import SearchIcon from "~icons/lucide/search";
import SparklesIcon from "~icons/lucide/sparkles";
import SunIcon from "~icons/lucide/sun";
import TrashIcon from "~icons/lucide/trash-2";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function isLocalServer() {
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

function retentionLabel(session: Session, now: number) {
  if (session.isPermanent || session.plan === "pro") return "Pro · Permanent";
  const remainingMs = new Date(session.createdAt).getTime() + RETENTION_MS - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "Expired";
  const totalHours = Math.ceil(remainingMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0 && hours > 0) return `${days}d ${hours}h left`;
  if (days > 0) return `${days}d left`;
  return `${hours}h left`;
}

export function HistoryDashboard() {
  const localServer = isLocalServer();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => {
      const titleMatch = (session.page?.title || "").toLowerCase().includes(query);
      const urlMatch = (session.page?.url || "").toLowerCase().includes(query);
      const pinMatch = (session.pins || []).some((pin) => {
        return pin.comment.toLowerCase().includes(query) || (pin.selector || "").toLowerCase().includes(query);
      });
      return titleMatch || urlMatch || pinMatch;
    });
  }, [search, sessions]);

  useEffect(() => {
    void fetchSessions();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function copyPrompt(session: Session) {
    const text = formatClipboardText(
      session.page,
      session.pins,
      session.shotUrl,
      session.viewerUrl || `/v/${session.id}.md`,
    );
    await navigator.clipboard.writeText(text);
    setCopiedId(session.id);
    window.setTimeout(() => setCopiedId(null), 2_000);
  }

  async function deleteSession() {
    if (!deleteId) return;
    const response = await fetch(`/api/history/${deleteId}`, { method: "DELETE" });
    if (response.ok) setSessions((current) => current.filter((session) => session.id !== deleteId));
    setDeleteId(null);
  }

  async function fetchSessions() {
    setLoading(true);
    try {
      const response = await fetch("/api/history");
      const data = await response.json();
      if (response.ok && Array.isArray(data.sessions)) setSessions(data.sessions);
    } finally {
      setLoading(false);
    }
  }

  function toggleTheme() {
    const nextDark = !isDark;
    setIsDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.setAttribute("data-theme", nextDark ? "dark" : "light");
    localStorage.setItem("pinar-theme", nextDark ? "dark" : "light");
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/40 font-sans text-foreground dark:bg-background">
      <header className="z-30 flex shrink-0 items-center justify-between border-b bg-card/95 px-6 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <PinarMark />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-bold">Pinar History</h1>
              <Badge className="text-[10px]" variant="outline">v0.1.1</Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {localServer ? "Private annotation history stored on this device" : "Private annotation history for this installation"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button aria-label="Toggle theme" size="icon" title="Toggle theme" variant="outline" onClick={toggleTheme}>
            {isDark ? <SunIcon /> : <MoonIcon />}
          </Button>
          <Button
            aria-label="GitHub"
            render={<a href="https://github.com/djalmajr/pinar" rel="noopener noreferrer" target="_blank" />}
            size="icon"
            title="GitHub"
            variant="outline"
          >
            <GithubIcon />
          </Button>
          <Button
            render={<a href="https://buymeacoffee.com/djalmajr" rel="noopener noreferrer" target="_blank" />}
            size="sm"
            variant="outline"
          >
            <CoffeeIcon data-icon="inline-start" className="text-amber-500" />
            Coffee
          </Button>
          <Button
            render={<a href="https://github.com/sponsors/djalmajr" rel="noopener noreferrer" target="_blank" />}
            size="sm"
            variant="sponsor"
          >
            <HeartIcon data-icon="inline-start" className="fill-current" />
            Sponsor
          </Button>
          <Button render={<a href="/pricing" />} size="sm" variant="pro">
            <SparklesIcon data-icon="inline-start" />
            Upgrade to Pro
          </Button>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
          <section>
            <h2 className="text-xl font-semibold tracking-tight">Annotation history</h2>
            <p className="mt-1 text-sm text-muted-foreground">Browse and reopen visual feedback sessions.</p>
          </section>
          <div className="flex items-center gap-3">
            <div className="relative max-w-xl flex-1">
              <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 pl-9"
                placeholder="Search by title, URL, comments, or selectors…"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Badge className="h-8 px-3" variant="outline">
              {filteredSessions.length} {filteredSessions.length === 1 ? "session" : "sessions"}
            </Badge>
          </div>
          {loading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">Loading history…</div>
          ) : filteredSessions.length === 0 ? (
            <Card className="border-dashed py-16 text-center">
              <CardHeader>
                <CardTitle>No annotation sessions found</CardTitle>
                <CardDescription>Use the Pinar extension to annotate a page. New sessions will appear here.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {filteredSessions.map((session) => {
                const shotUrl = session.shotUrl || (session.shotId ? `/shots/${session.shotId}.png` : null);
                const pinCount = session.pinCount ?? session.pins?.length ?? 0;
                return (
                  <Card className="transition-colors hover:ring-primary/35" key={session.id}>
                    {shotUrl && (
                      <a className="group relative block aspect-video overflow-hidden border-b bg-muted" href={`/v/${session.id}`}>
                        <img
                          alt={session.page?.title || "Screenshot"}
                          className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.01]"
                          src={shotUrl}
                        />
                        <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                          <ExternalLinkIcon className="size-4" />
                          Open viewer
                        </span>
                      </a>
                    )}
                    <CardHeader>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        {localServer ? (
                          <Badge variant="secondary">
                            <HardDriveIcon data-icon="inline-start" />
                            Local
                          </Badge>
                        ) : (
                          <Badge variant={session.isPermanent || session.plan === "pro" ? "pro" : "outline"}>
                            {retentionLabel(session, now)}
                          </Badge>
                        )}
                        <time className="text-xs text-muted-foreground" dateTime={session.createdAt}>
                          {new Date(session.createdAt).toLocaleString(undefined, {
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            month: "short",
                          })}
                        </time>
                      </div>
                      <CardTitle className="line-clamp-1">{session.page?.title || "Untitled page"}</CardTitle>
                      <CardDescription className="line-clamp-1 font-mono text-xs">{session.page?.url}</CardDescription>
                    </CardHeader>
                    <CardFooter className="justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <MessageCircleIcon className="size-4 text-primary" />
                        {pinCount} {pinCount === 1 ? "pin" : "pins"}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button render={<a href={`/v/${session.id}.md`} target="_blank" />} size="sm" variant="outline">
                          Markdown
                        </Button>
                        <Button render={<a href={`/v/${session.id}`} />} size="sm">
                          View
                          <ExternalLinkIcon data-icon="inline-end" />
                        </Button>
                        <Button
                          aria-label="Copy prompt"
                          size="icon"
                          title="Copy prompt"
                          variant="outline"
                          onClick={() => void copyPrompt(session)}
                        >
                          {copiedId === session.id ? <CheckIcon className="text-emerald-500" /> : <CopyIcon />}
                        </Button>
                        <Button
                          aria-label="Delete session"
                          className="text-muted-foreground hover:text-destructive"
                          size="icon"
                          title="Delete session"
                          variant="ghost"
                          onClick={() => setDeleteId(session.id)}
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </main>
      </ScrollArea>
      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this annotation session?</AlertDialogTitle>
            <AlertDialogDescription>The screenshot and its pins will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void deleteSession()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
