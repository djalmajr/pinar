import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { formatClipboardText, getPinColor, PINAR_REOPEN_SESSION_RESULT_EVENT, requestReopenSession, type AgentExecution, type Pin, type PinLocation, type PinReview, type PinReviewHumanAction, type PinReviewStatus, type Session } from "@pinar/shared";
import { ImageZoomControls, ImageZoomStage, useImageZoom } from "@/components/ImageZoomStage";
import { SessionActionsMenu } from "../components/SessionActionsMenu";
import { copyBatchHandoff } from "../lib/session-actions";
import { ServerShell } from "@/components/ServerShell";
import { WorkspaceChrome } from "@/components/WorkspaceChrome";
import { isRecord, isSession } from "@/lib/api-data";
import { useServerI18n, type ServerMessageKey } from "@/lib/i18n";
import { formatPinMarkdown } from "@/lib/pin-markdown";
import { pinarRuntime, shouldUseWorkspaceChrome } from "@/lib/server-header";
import { formatSessionDate } from "@/lib/session-date";
import { sessionListingCopy } from "@/lib/session-listing";
import {
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  DropdownMenuTrigger,
  PinBadge,
  ScrollArea,
  SidebarInset,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@pinar/ui";
import ArrowLeftIcon from "~icons/lucide/arrow-left";
import CalendarIcon from "~icons/lucide/calendar-days";
import CheckIcon from "~icons/lucide/check";
import ChevronDownIcon from "~icons/lucide/chevron-down";
import ChevronLeftIcon from "~icons/lucide/chevron-left";
import ChevronRightIcon from "~icons/lucide/chevron-right";
import CopyIcon from "~icons/lucide/copy";
import ExternalLinkIcon from "~icons/lucide/external-link";
import MessageCircleIcon from "~icons/lucide/message-circle";
import ScanSearchIcon from "~icons/lucide/scan-search";
import SparklesIcon from "~icons/lucide/sparkles";
import XIcon from "~icons/lucide/x";

interface WebViewerProps {
  onClose?: () => void;
  // Moving and deleting need a list to return to, so the standalone /v/ route
  // leaves them out rather than stranding the reader on a dead session.
  onDelete?: (sessionId: string) => void;
  onMove?: (sessionId: string) => void;
  // Walking captures needs the surrounding list; the standalone route has none,
  // so the arrows simply do not render there.
  onNavigate?: (sessionId: string) => void;
  presentation?: "modal" | "page";
  sessionId: string;
  siblingIds?: string[];
}

interface AiSummaryResult {
  highlights: string[];
  summary: string;
}

type AiRecovery = "pricing" | "retry" | "signIn" | null;

function aiSummaryResult(value: unknown): AiSummaryResult | null {
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.highlights)) return null;
  const highlights = value.highlights.filter((item): item is string => typeof item === "string");
  return { highlights, summary: value.summary };
}

function pinNumber(pin: Pin, index: number) {
  return pin.number || index + 1;
}

function OriginalPageAnchor({ className, url }: { className?: string; url: string }) {
  return (
    <a
      className={className}
      href={url}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span className="truncate">{url}</span>
      <ExternalLinkIcon className="size-3 shrink-0" />
    </a>
  );
}

function PrivacyBadges({ session, t }: { session: Session; t: (key: ServerMessageKey, values?: Record<string, string | number>) => string }) {
  if (!session.privacy?.unevaluated) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <Badge variant="destructive">{t("viewer.privacyUnevaluated")}</Badge>
    </div>
  );
}

function ViewerPageIdentity({
  isModal,
  reopenHint,
  session,
  t,
}: {
  isModal: boolean;
  reopenHint: "failed" | "missing" | null;
  session: Session;
  t: (key: ServerMessageKey, values?: Record<string, string | number>) => string;
}) {
  const copy = sessionListingCopy(session.page);
  const accessibleName = copy.title || copy.url || t("viewer.annotation");
  const titleClassName = "truncate text-sm font-medium";
  // No visible description here: the title and the URL already identify the page.
  const linkClassName = "inline-flex min-w-0 items-center gap-1 overflow-hidden text-sm text-muted-foreground hover:text-primary";
  return (
    <div className="min-w-0 flex-1 space-y-0.5">
      {copy.title ? (
        isModal ? (
          <DialogTitle className={titleClassName}>{copy.title}</DialogTitle>
        ) : (
          <h1 className={titleClassName}>{copy.title}</h1>
        )
      ) : isModal ? (
        <DialogTitle className="sr-only">{accessibleName}</DialogTitle>
      ) : (
        <h1 className="sr-only">{accessibleName}</h1>
      )}
      {isModal ? (
        // The dialog still needs an accessible description, just not a visible one.
        <DialogDescription className="sr-only">
          {copy.description || copy.url || t("viewer.annotation")}
        </DialogDescription>
      ) : null}
      {copy.url ? (
        <div className="flex min-w-0 items-center gap-2">
          <OriginalPageAnchor className={linkClassName} url={copy.url} />
          <PrivacyBadges session={session} t={t} />
        </div>
      ) : (
        <PrivacyBadges session={session} t={t} />
      )}
      {reopenHint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t(reopenHint === "missing" ? "viewer.reviewOnPageHint" : "viewer.reviewOnPageFailed")}
        </p>
      ) : null}
    </div>
  );
}

function locationStrategyLabel(
  t: (key: ServerMessageKey, vars?: Record<string, string | number>) => string,
  location: PinLocation,
) {
  if (location.strategy === "stable-selector") return t("viewer.strategyStableSelector");
  if (location.strategy === "structure") return t("viewer.strategyStructure");
  if (location.strategy === "semantic") return t("viewer.strategySemantic");
  if (location.strategy === "geometry") return t("viewer.strategyGeometry");
  return location.strategy;
}

function locationBadge(t: (key: ServerMessageKey, vars?: Record<string, string | number>) => string, location?: PinLocation) {
  if (!location) return null;
  if (location.confidence === "exact") {
    return {
      hint: t("viewer.locationExactHint"),
      label: t("viewer.locationExact"),
      variant: "successSoft" as const,
    };
  }
  if (location.confidence === "probable") {
    return {
      hint: t("viewer.locationProbableHint"),
      label: t("viewer.locationStrategy", { strategy: locationStrategyLabel(t, location) }),
      variant: "warning" as const,
    };
  }
  return {
    hint: t("viewer.locationNeedsReviewHint"),
    label: t("viewer.locationNeedsReview"),
    variant: "destructive" as const,
  };
}

function LocationConfidenceBadge({
  location,
  t,
}: {
  location?: PinLocation;
  t: (key: ServerMessageKey, vars?: Record<string, string | number>) => string;
}) {
  const badge = locationBadge(t, location);
  if (!badge || location?.confidence === "exact") return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
        <Badge title={badge.hint} variant={badge.variant}>
          {badge.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{badge.hint}</TooltipContent>
    </Tooltip>
  );
}

function pinLookupId(pin: Pin) {
  return pin.pinId || pin.id || "";
}

function reviewStatusLabel(
  t: (key: ServerMessageKey, vars?: Record<string, string | number>) => string,
  status: PinReviewStatus,
) {
  if (status === "correction_ready") return t("viewer.reviewCorrectionReady");
  if (status === "accepted") return t("viewer.reviewAccepted");
  if (status === "reopened") return t("viewer.reviewReopened");
  return t("viewer.reviewOpen");
}

function reviewStatusBadge(status: PinReviewStatus) {
  if (status === "correction_ready") return "warning" as const;
  if (status === "accepted") return "successSoft" as const;
  if (status === "reopened") return "secondary" as const;
  return "outline" as const;
}

function asReviews(value: unknown): PinReview[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PinReview => (
    isRecord(item)
    && typeof item.pinId === "string"
    && typeof item.status === "string"
    && Array.isArray(item.actions)
    && Array.isArray(item.timeline)
  ));
}

function asExecutions(value: unknown): AgentExecution[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AgentExecution => (
    isRecord(item)
    && typeof item.id === "string"
    && typeof item.agent === "string"
    && Array.isArray(item.results)
  ));
}

function reviewForPin(reviews: PinReview[], pin: Pin) {
  const pinId = pinLookupId(pin);
  return reviews.find((review) => review.pinId === pinId);
}

function lastAgentResult(executions: AgentExecution[], pin: Pin) {
  const pinId = pinLookupId(pin);
  for (let index = executions.length - 1; index >= 0; index -= 1) {
    const execution = executions[index];
    const result = execution?.results.find((item) => item.pinId === pinId);
    if (execution && result) return { agent: execution.agent, result };
  }
  return null;
}

function ViewerFrame({ children, className }: { children: ReactNode; className?: string }) {
  if (shouldUseWorkspaceChrome(pinarRuntime())) {
    return (
      <WorkspaceChrome className={className} navigateOnCollectionSelect>
        <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </SidebarInset>
      </WorkspaceChrome>
    );
  }
  return <ServerShell className={className}>{children}</ServerShell>;
}

export function WebViewer({
  onClose,
  onDelete,
  onMove,
  onNavigate,
  presentation = "page",
  sessionId,
  siblingIds = [],
}: WebViewerProps) {
  const { language, t } = useServerI18n();
  const showAiSummary = pinarRuntime() === "cloud";
  const aiRequestId = useRef<string | null>(null);
  const [aiCreditsRemaining, setAiCreditsRemaining] = useState<number | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRecovery, setAiRecovery] = useState<AiRecovery>(null);
  const [aiSummary, setAiSummary] = useState<AiSummaryResult | null>(null);
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageCopied, setPageCopied] = useState(false);
  const [batchCopied, setBatchCopied] = useState(false);
  const [reopenHint, setReopenHint] = useState<"failed" | "missing" | null>(null);
  const reopenWait = useRef<number | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviews, setReviews] = useState<PinReview[]>([]);
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const siblingIndex = siblingIds.indexOf(sessionId);
  const zoom = useImageZoom(session?.shotUrl || sessionId);
  const isModal = presentation === "modal";

  const stepCapture = useCallback((delta: number) => {
    const next = siblingIds[siblingIds.indexOf(sessionId) + delta];
    if (next) onNavigate?.(next);
  }, [onNavigate, sessionId, siblingIds]);

  useEffect(() => {
    if (siblingIds.length < 2) return;
    function onKey(event: KeyboardEvent) {
      // Let the pin dialog, the summary and any text field keep their arrows.
      if (selectedPin || aiSummaryOpen) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      // The target is not always an Element - a keydown aimed at the document
      // has no closest() - so narrow before asking about form fields.
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      stepCapture(event.key === "ArrowLeft" ? -1 : 1);
    }
    // Capture phase: the dialog stops keydown from bubbling, and focus lives
    // inside it, so a bubble listener on window would never see these keys.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [aiSummaryOpen, selectedPin, siblingIds, stepCapture]);

  async function loadSession() {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    const data: unknown = await response.json();
    if (response.ok && isRecord(data) && isSession(data.session)) {
      const nextSession = data.session;
      setSession(nextSession);
      setReviews(asReviews(data.reviews));
      setExecutions(asExecutions(data.executions));
      setSelectedPin((current) => {
        if (!current) return current;
        return nextSession.pins.find((pin) => pinLookupId(pin) === pinLookupId(current)) || current;
      });
    }
  }

  useEffect(() => {
    async function load() {
      try {
        await loadSession();
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [sessionId]);

  useEffect(() => {
    function onResult(event: Event) {
      const detail = (event as CustomEvent<{ error?: string; ok?: boolean }>).detail;
      if (reopenWait.current != null) window.clearTimeout(reopenWait.current);
      reopenWait.current = null;
      setReopenHint(detail?.ok ? null : "failed");
    }
    window.addEventListener(PINAR_REOPEN_SESSION_RESULT_EVENT, onResult);
    return () => {
      window.removeEventListener(PINAR_REOPEN_SESSION_RESULT_EVENT, onResult);
      if (reopenWait.current != null) window.clearTimeout(reopenWait.current);
    };
  }, []);

  function reopenOnPage() {
    if (!session) return;
    setReopenHint(null);
    if (reopenWait.current != null) window.clearTimeout(reopenWait.current);
    requestReopenSession(session.id);
    reopenWait.current = window.setTimeout(() => {
      setReopenHint("missing");
    }, 800);
  }

  async function submitReview(pin: Pin, action: PinReviewHumanAction) {
    const pinId = pinLookupId(pin);
    if (!pinId || reviewBusy) return;
    setReviewBusy(true);
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/pins/${encodeURIComponent(pinId)}/review`,
        {
          body: JSON.stringify({ action }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (response.ok) await loadSession();
    } finally {
      setReviewBusy(false);
    }
  }

  function markdownUrl() {
    return new URL(`/v/${sessionId}.md`, window.location.origin).toString();
  }

  async function copyBatch(batchId: string) {
    if (!await copyBatchHandoff(batchId)) return;
    setBatchCopied(true);
    window.setTimeout(() => setBatchCopied(false), 2_000);
  }

  async function copyPage() {
    if (!session) return;
    let handoffMode: "compact" | "full" = "compact";
    try {
      const response = await fetch("/api/preferences");
      const preferences: unknown = await response.json();
      if (response.ok && isRecord(preferences) && preferences.handoffMode === "full") handoffMode = "full";
    } catch {
      // Public viewers and older servers keep the compact default.
    }
    await navigator.clipboard.writeText(formatClipboardText(
      session.page,
      session.pins,
      session.shotUrl,
      markdownUrl(),
      session.captureId || session.id,
      session.includeScreenshot !== false,
      handoffMode,
    ));
    setPageCopied(true);
    window.setTimeout(() => setPageCopied(false), 2_000);
  }


  async function generateAiSummary() {
    setAiSummaryOpen(true);
    if (aiSummary || aiLoading) return;
    setAiError("");
    setAiRecovery(null);
    setAiLoading(true);
    aiRequestId.current ||= `ai_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      const response = await fetch("/api/ai/session-summary", {
        body: JSON.stringify({ language, requestId: aiRequestId.current, sessionId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const data: unknown = await response.json();
      const result = isRecord(data) ? aiSummaryResult(data.result) : null;
      if (!response.ok || !result) {
        const code = isRecord(data) && typeof data.code === "string" ? data.code : "";
        if (code !== "ai_request_in_progress" && code !== "ai_refund_pending") aiRequestId.current = null;
        if (response.status === 401) {
          setAiError(t("viewer.aiSignIn"));
          setAiRecovery("signIn");
        } else if (code === "insufficient_ai_credits") {
          setAiError(t("viewer.aiNoCredits"));
          setAiRecovery("pricing");
        } else if (code === "ai_rate_limited") {
          setAiError(t("viewer.aiRateLimited"));
          setAiRecovery("retry");
        } else if (code === "ai_refund_pending") {
          setAiError(t("viewer.aiRefundPending"));
          setAiRecovery("retry");
        } else {
          setAiError(t("viewer.aiUnavailable"));
          setAiRecovery("retry");
        }
        return;
      }
      if (isRecord(data) && isRecord(data.aiCredits) && typeof data.aiCredits.balance === "number") {
        setAiCreditsRemaining(data.aiCredits.balance);
      }
      setAiSummary(result);
      setAiRecovery(null);
    } catch {
      setAiError(t("viewer.aiNetworkError"));
      setAiRecovery("retry");
    } finally {
      setAiLoading(false);
    }
  }

  function wrapFrame(body: ReactNode, frameClassName?: string) {
    if (!isModal) {
      return <ViewerFrame className={frameClassName}>{body}</ViewerFrame>;
    }
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
        <DialogContent className="flex h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)]">
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  if (loading) {
    return wrapFrame(
      <>
        {isModal ? (
          <DialogHeader className="sr-only">
            <DialogTitle>{t("viewer.loading")}</DialogTitle>
          </DialogHeader>
        ) : null}
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("viewer.loading")}
        </div>
      </>,
    );
  }

  if (!session) {
    return wrapFrame(
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
        {isModal ? (
          <DialogTitle className="text-lg font-semibold">{t("viewer.notFound")}</DialogTitle>
        ) : (
          <h1 className="text-lg font-semibold">{t("viewer.notFound")}</h1>
        )}
        <Button render={<Link preload="intent" search={{ session: undefined }} to="/app" />} variant="outline">
          <ArrowLeftIcon data-icon="inline-start" />
          {t("viewer.backHistory")}
        </Button>
      </div>,
      "bg-muted/40",
    );
  }

  const selectedIndex = selectedPin ? session.pins.indexOf(selectedPin) : -1;
  const selectedNumber = selectedPin ? pinNumber(selectedPin, Math.max(0, selectedIndex)) : 0;
  const selectedColor = selectedPin?.color || getPinColor(selectedNumber);
  const selectedMarkdown = selectedPin ? formatPinMarkdown(selectedPin, selectedNumber) : "";

  return (
    <TooltipProvider delay={200}>
    {wrapFrame(
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="relative z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2 sm:gap-4 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isModal ? null : (
            <Button
              aria-label={t("viewer.backHistory")}
              render={<Link preload="intent" search={{ session: undefined }} to="/app" />}
              size="icon-sm"
              title={t("viewer.backHistory")}
              variant="ghost"
            >
              <ArrowLeftIcon />
            </Button>
          )}
          <ViewerPageIdentity
            isModal={isModal}
            reopenHint={reopenHint}
            session={session}
            t={t}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {siblingIndex >= 0 && siblingIds.length > 1 ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums" role="status">
                {t("viewer.capturePosition", { current: siblingIndex + 1, total: siblingIds.length })}
              </span>
              <ButtonGroup aria-label={t("viewer.captureNavigation")}>
                <Button
                  aria-label={t("viewer.previousCapture")}
                  disabled={siblingIndex <= 0}
                  size="icon"
                  title={t("viewer.previousCapture")}
                  type="button"
                  variant="outline"
                  onClick={() => stepCapture(-1)}
                >
                  <ChevronLeftIcon />
                </Button>
                <Button
                  aria-label={t("viewer.nextCapture")}
                  disabled={siblingIndex >= siblingIds.length - 1}
                  size="icon"
                  title={t("viewer.nextCapture")}
                  type="button"
                  variant="outline"
                  onClick={() => stepCapture(1)}
                >
                  <ChevronRightIcon />
                </Button>
              </ButtonGroup>
            </div>
          ) : null}
          <Button
            aria-label={t("viewer.reviewOnPage")}
            title={t("viewer.reviewOnPage")}
            type="button"
            variant="outline"
            onClick={reopenOnPage}
          >
            <ScanSearchIcon data-icon="inline-start" />
            <span className="hidden sm:inline">{t("viewer.reviewOnPage")}</span>
          </Button>
          {showAiSummary ? (
            <Button aria-label={t("viewer.aiSummary")} disabled={aiLoading} type="button" variant="outline" onClick={() => void generateAiSummary()}>
              <SparklesIcon data-icon="inline-start" />
              <span className="hidden sm:inline">{aiLoading ? t("viewer.aiSummarizing") : t("viewer.aiSummary")}</span>
            </Button>
          ) : null}
          <ButtonGroup aria-label={t("viewer.pageActions")}>
            <Button aria-label={pageCopied ? t("common.copied") : t("dashboard.copyPrompt")} type="button" variant="outline" onClick={copyPage}>
              {pageCopied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
              <span className="hidden sm:inline">{pageCopied ? t("common.copied") : t("dashboard.copyPrompt")}</span>
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
              <SessionActionsMenu
                batchCopied={batchCopied}
                session={session}
                t={t}
                onCopyBatch={(id) => void copyBatch(id)}
                onDelete={onDelete}
                onMove={onMove}
              />
            </DropdownMenu>
          </ButtonGroup>
          {isModal ? (
            <DialogClose render={<Button aria-label="Close" size="icon" title="Close" variant="outline" />}>
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogClose>
          ) : null}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,3fr)_minmax(12rem,2fr)] md:grid-cols-[minmax(0,1fr)_22rem] md:grid-rows-1">
        {session.shotUrl ? (
          <div className="relative flex min-h-0 min-w-0 flex-col">
            <ImageZoomStage
              alt={t("viewer.annotatedScreenshot")}
              src={session.shotUrl}
              stageRef={zoom.stageRef}
              transform={zoom.transform}
              onDoubleClick={() => zoom.transform.scale <= 1 ? zoom.zoomBy(2) : zoom.resetZoom()}
              onPointerCancel={zoom.handlePointerUp}
              onPointerDown={zoom.handlePointerDown}
              onPointerMove={zoom.handlePointerMove}
              onPointerUp={zoom.handlePointerUp}
              onWheel={zoom.handleWheel}
            />
            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
              <div className="pointer-events-auto">
                <ImageZoomControls scale={zoom.transform.scale} onReset={zoom.resetZoom} onZoomBy={zoom.zoomBy} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 items-center justify-center bg-muted/40 p-6">
            <Card className="w-full max-w-[min(48rem,100%)] p-0 shadow-lg">
              <CardContent className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
                {t("viewer.screenshotUnavailable")}
              </CardContent>
            </Card>
          </div>
        )}
        <aside className="flex min-h-0 flex-col border-t bg-card md:border-t-0 md:border-l">
            <div className="shrink-0 border-b px-4 py-3">
              <div className="flex min-w-0 items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
                <time className="inline-flex min-w-0 items-center gap-1.5" dateTime={session.createdAt}>
                  <CalendarIcon className="shrink-0 text-primary" />
                  <span className="truncate">{formatSessionDate(session, language)}</span>
                </time>
                <h2 className="inline-flex shrink-0 items-center gap-1.5">
                  <MessageCircleIcon className="text-primary" />
                  {t("dashboard.pinCount", { count: session.pins?.length || 0 })}
                </h2>
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-3 p-4">
                {(session.pins || []).map((pin, index) => {
                  const number = pinNumber(pin, index);
                  const color = pin.color || getPinColor(number);
                  const isArea = pin.type === "area" || pin.kind === "area";
                  const review = reviewForPin(reviews, pin);
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
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {review ? (
                                <Badge variant={reviewStatusBadge(review.status)}>
                                  {reviewStatusLabel(t, review.status)}
                                </Badge>
                              ) : null}
                              <LocationConfidenceBadge location={pin.location} t={t} />
                            </div>
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
      </div>,
    )}
      {showAiSummary ? (
        <Dialog open={aiSummaryOpen} onOpenChange={setAiSummaryOpen}>
          <DialogContent className="sm:max-w-2xl" showCloseButton>
            <DialogHeader>
              <DialogTitle>{t("viewer.aiSummaryTitle")}</DialogTitle>
              <DialogDescription>{t("viewer.aiSummaryDescription")}</DialogDescription>
            </DialogHeader>
            {aiLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("viewer.aiSummarizing")}</p>
            ) : aiError ? (
              <Card className="border-destructive/30 bg-destructive/5">
                <CardContent className="flex flex-col items-start gap-3 text-sm text-destructive">
                  <p>{aiError}</p>
                  {aiRecovery === "signIn" ? (
                    <Button
                      render={<a href={`/sign-in?returnTo=${encodeURIComponent(`/v/${sessionId}`)}`} />}
                      size="sm"
                      variant="outline"
                    >
                      {t("viewer.aiSignInAction")}
                    </Button>
                  ) : aiRecovery === "pricing" ? (
                    <Button render={<Link preload="intent" to="/pricing" />} size="sm" variant="outline">
                      {t("viewer.aiViewPlans")}
                    </Button>
                  ) : aiRecovery === "retry" ? (
                    <Button size="sm" type="button" variant="outline" onClick={() => void generateAiSummary()}>
                      {t("viewer.aiRetry")}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            ) : aiSummary ? (
              <div className="flex flex-col gap-5">
                <p className="text-sm leading-relaxed text-foreground">{aiSummary.summary}</p>
                {aiSummary.highlights.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">{t("viewer.aiHighlights")}</h3>
                    <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-foreground">
                      {aiSummary.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {aiCreditsRemaining === null
                    ? t("viewer.aiCreditCost")
                    : t("viewer.aiCreditsRemaining", { count: aiCreditsRemaining })}
                </p>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
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
                      <DialogDescription>
                        {selectedPin.location
                          ? locationBadge(t, selectedPin.location)?.hint
                          : t("viewer.completeContext")}
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>
                <TabsList className="shrink-0" variant="segmented">
                  <TabsTrigger value="preview">{t("viewer.preview")}</TabsTrigger>
                  <TabsTrigger value="raw">{t("viewer.raw")}</TabsTrigger>
                </TabsList>
              </div>
              {(() => {
                const review = reviewForPin(reviews, selectedPin);
                const last = lastAgentResult(executions, selectedPin);
                if (!review) return null;
                return (
                  <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Badge variant={reviewStatusBadge(review.status)}>
                        {reviewStatusLabel(t, review.status)}
                      </Badge>
                      <div className="flex flex-wrap gap-2">
                        {review.actions.includes("accept") ? (
                          <Button
                            disabled={reviewBusy}
                            size="sm"
                            type="button"
                            onClick={() => void submitReview(selectedPin, "accept")}
                          >
                            {t("viewer.acceptCorrection")}
                          </Button>
                        ) : null}
                        {review.actions.includes("reopen") ? (
                          <Button
                            disabled={reviewBusy}
                            size="sm"
                            type="button"
                            variant="outline"
                            onClick={() => void submitReview(selectedPin, "reopen")}
                          >
                            {t("viewer.reopenPin")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-sm">
                      <p className="font-medium">{t("viewer.lastAgentResult")}</p>
                      {last ? (
                        <p className="mt-1 text-muted-foreground">
                          {last.agent}: {last.result.status}
                          {last.result.summary ? ` — ${last.result.summary}` : ""}
                        </p>
                      ) : (
                        <p className="mt-1 text-muted-foreground">{t("viewer.noAgentResult")}</p>
                      )}
                    </div>
                    {review.timeline.length > 0 ? (
                      <div className="text-sm">
                        <p className="font-medium">{t("viewer.reviewTimeline")}</p>
                        <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
                          {review.timeline.map((event) => (
                            <li key={event.id}>
                              {t("viewer.reviewTransition", {
                                from: reviewStatusLabel(t, event.fromStatus),
                                to: reviewStatusLabel(t, event.toStatus),
                              })}
                              {" · "}
                              {event.origin}
                              {" · "}
                              {event.actorType}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                );
              })()}
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
    </TooltipProvider>
  );
}
