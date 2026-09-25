import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { formatClipboardText, getPinColor, type AgentExecution, type Pin, type PinLocation, type PinReview, type PinReviewHumanAction, type PinReviewStatus, type Reproduction, type Session } from "@pinar/shared";
import { ImageZoomControls, ImageZoomStage, useImageZoom } from "@/components/ImageZoomStage";
import { PinEvidence } from "@/components/PinEvidence";
import { PinStructure } from "@/components/PinStructure";
import { ReproductionTimeline } from "@/components/ReproductionTimeline";
import { SessionActionsMenu } from "../components/SessionActionsMenu";
import { batchPromptRevision, copyBatchHandoff, createBatchPromptCache } from "../lib/session-actions";
import { ServerShell } from "@/components/ServerShell";
import { WorkspaceChrome } from "@/components/WorkspaceChrome";
import { isRecord, isSession } from "@/lib/api-data";
import { isPaidAuthSession, useAuthSession } from "@/lib/auth-session";
import { useDeliveryPreferences } from "@/lib/delivery-preferences";
import { useServerI18n, type ServerMessageKey } from "@/lib/i18n";
import { formatPinMarkdown } from "@/lib/pin-markdown";
import { pinarRuntime, shouldUseWorkspaceChrome } from "@/lib/server-header";
import { formatSessionDate } from "@/lib/session-date";
import { sessionListingCopy } from "@/lib/session-listing";
import {
  buildShareUrl,
  canManageCloudShare,
  fetchActiveShare,
  publishShare,
  revokeShare,
  shareMarkdownPath,
} from "@/lib/share-links";
import { shareControlState, type ShareOperation } from "@/lib/share-control-state";
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
  Skeleton,
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
import LayersIcon from "~icons/lucide/layers";
import ExternalLinkIcon from "~icons/lucide/external-link";
import MessageCircleIcon from "~icons/lucide/message-circle";
import ShareIcon from "~icons/lucide/share-2";
import UnlinkIcon from "~icons/lucide/unlink";
import XIcon from "~icons/lucide/x";

interface WebViewerProps {
  captureIds?: string[];
  initialSession?: Session;
  navigationId?: string;
  onClose?: () => void;
  // Moving and deleting need a list to return to, so the standalone /v/ route
  // leaves them out rather than stranding the reader on a dead session.
  onDelete?: (sessionId: string) => void;
  onMove?: (sessionId: string) => void;
  onNavigate?: (sessionId: string) => void;
  onShareChange?: () => Promise<void> | void;
  presentation?: "modal" | "page";
  sessionId: string;
  siblingIds?: string[];
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
  session,
  t,
}: {
  isModal: boolean;
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

interface ViewerNavigationProps {
  siblingCount: number;
  siblingIndex: number;
  t: (key: ServerMessageKey, values?: Record<string, string | number>) => string;
  onStep: (delta: number) => void;
}

function ViewerNavigation({ siblingCount, siblingIndex, t, onStep }: ViewerNavigationProps) {
  if (siblingIndex < 0 || siblingCount <= 1) return null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-xs text-muted-foreground tabular-nums" role="status">
        {t("viewer.capturePosition", { current: siblingIndex + 1, total: siblingCount })}
      </span>
      <ButtonGroup aria-label={t("viewer.captureNavigation")}>
        <Button
          aria-label={t("viewer.previousCapture")}
          disabled={siblingIndex <= 0}
          size="icon"
          title={t("viewer.previousCapture")}
          type="button"
          variant="outline"
          onClick={() => onStep(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          aria-label={t("viewer.nextCapture")}
          disabled={siblingIndex >= siblingCount - 1}
          size="icon"
          title={t("viewer.nextCapture")}
          type="button"
          variant="outline"
          onClick={() => onStep(1)}
        >
          <ChevronRightIcon />
        </Button>
      </ButtonGroup>
    </div>
  );
}

function ViewerCloseButton() {
  return (
    <DialogClose render={<Button aria-label="Close" size="icon" title="Close" variant="outline" />}>
      <XIcon />
      <span className="sr-only">Close</span>
    </DialogClose>
  );
}

interface ViewerLoadingStateProps {
  isModal: boolean;
  shareState: "hidden" | "shared" | "unshared";
  siblingCount: number;
  siblingIndex: number;
  t: (key: ServerMessageKey, values?: Record<string, string | number>) => string;
  onStep: (delta: number) => void;
}

function ViewerLoadingState({
  isModal,
  shareState,
  siblingCount,
  siblingIndex,
  t,
  onStep,
}: ViewerLoadingStateProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-viewer-loading>
      {isModal ? (
        <DialogHeader className="sr-only">
          <DialogTitle>{t("viewer.loading")}</DialogTitle>
        </DialogHeader>
      ) : null}
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
          <div className="min-w-0 flex-1 space-y-1.5" data-viewer-loading-identity>
            <Skeleton className="h-4 w-40 max-w-2/3" />
            <Skeleton className="h-3 w-64 max-w-4/5" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ViewerNavigation
            siblingCount={siblingCount}
            siblingIndex={siblingIndex}
            t={t}
            onStep={onStep}
          />
          {shareState === "shared" ? (
            <ButtonGroup aria-label={t("dashboard.share")}>
              <Button aria-label={t("share.copyLink")} disabled type="button" variant="outline">
                <CopyIcon data-icon="inline-start" />
                <span className="hidden sm:inline">{t("share.copyLink")}</span>
              </Button>
              <Button aria-label={t("share.revoke")} disabled type="button" variant="outline">
                <UnlinkIcon data-icon="inline-start" />
                <span className="hidden sm:inline">{t("share.revoke")}</span>
              </Button>
            </ButtonGroup>
          ) : shareState === "unshared" ? (
            <Button aria-label={t("share.publish")} disabled type="button" variant="outline">
              <ShareIcon data-icon="inline-start" />
              <span className="hidden sm:inline">{t("share.publish")}</span>
            </Button>
          ) : null}
          <ButtonGroup aria-label={t("viewer.pageActions")}>
            <Button aria-label={t("dashboard.copyPrompt")} disabled type="button" variant="outline">
              <CopyIcon data-icon="inline-start" />
              <span className="hidden sm:inline">{t("dashboard.copyPrompt")}</span>
            </Button>
            <Button
              aria-label={t("viewer.moreActions")}
              disabled
              size="icon"
              title={t("viewer.moreActions")}
              type="button"
              variant="outline"
            >
              <ChevronDownIcon />
            </Button>
          </ButtonGroup>
          {isModal ? <ViewerCloseButton /> : null}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,3fr)_minmax(12rem,2fr)] md:grid-cols-[minmax(0,1fr)_22rem] md:grid-rows-1">
        <div className="min-h-0 min-w-0 bg-muted/20 p-6" data-viewer-loading-stage>
          <Skeleton className="size-full rounded-lg" />
        </div>
        <aside className="flex min-h-0 flex-col border-t bg-card md:border-t-0 md:border-l" data-viewer-loading-sidebar>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex items-center gap-1.5">
              <CalendarIcon className="shrink-0 text-primary" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex items-center gap-1.5">
              <MessageCircleIcon className="text-primary" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
            {[0, 1, 2].map((item) => (
              <Card className="w-full gap-3 py-3" key={item}>
                <CardHeader className="grid grid-cols-[auto_1fr] items-start gap-x-2 px-3">
                  <Skeleton className="size-6 rounded-full" />
                  <div className="min-w-0 space-y-2">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </CardHeader>
                <CardContent className="px-3">
                  <Skeleton className="h-6 w-full rounded-md" />
                </CardContent>
              </Card>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

type CopyPromptPhase = "idle" | "preparing" | "copied" | "error";

function CopyPromptLabel({ active, labels }: { active: string; labels: readonly string[] }) {
  return (
    <span className="hidden whitespace-nowrap sm:inline-grid">
      {labels.map((label) => (
        <span
          aria-hidden={label !== active}
          className={label === active ? "col-start-1 row-start-1" : "invisible col-start-1 row-start-1"}
          key={label}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

export function WebViewer({
  captureIds = [],
  initialSession,
  navigationId,
  onClose,
  onDelete,
  onMove,
  onNavigate,
  onShareChange,
  presentation = "page",
  sessionId,
  siblingIds = [],
}: WebViewerProps) {
  const { language, t } = useServerI18n();
  const { handoffMode } = useDeliveryPreferences();
  const authSession = useAuthSession();
  const showAiReproduction = pinarRuntime() === "local" || isPaidAuthSession(authSession);
  const [loading, setLoading] = useState(true);
  const [pageCopied, setPageCopied] = useState(false);
  const [batchCopied, setBatchCopied] = useState(false);
  const [copyPhase, setCopyPhase] = useState<CopyPromptPhase>("idle");
  const promptCache = useMemo(() => createBatchPromptCache(), []);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviews, setReviews] = useState<PinReview[]>([]);
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [shareOperation, setShareOperation] = useState<ShareOperation>(null);
  const [revokeSettled, setRevokeSettled] = useState(false);
  const [shareError, setShareError] = useState("");
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const shareControls = shareControlState({
    operation: shareOperation,
    revokeSettled,
    token: shareToken,
  });
  const [captures, setCaptures] = useState<Session[]>([]);
  const [highlightedCapture, setHighlightedCapture] = useState<string | null>(null);
  const imageRefs = useRef(new Map<string, HTMLDivElement>());
  const captureKey = (presentation === "modal" && captureIds.length ? captureIds : [sessionId]).join(",");
  const pinOwner = (pin: Pin) => captures.find((capture) => capture.pins.some((item) => pinLookupId(item) === pinLookupId(pin))) || session;
  const selectedCapture = selectedPin ? pinOwner(selectedPin) : session;
  const showShareControls = canManageCloudShare(pinarRuntime(), authSession, session);
  const canEditPins = pinarRuntime() === "local" || canManageCloudShare(pinarRuntime(), authSession, session);
  const [pinPatchBusy, setPinPatchBusy] = useState(false);
  const [pinPatchError, setPinPatchError] = useState("");
  const zoom = useImageZoom(captureKey);
  const isModal = presentation === "modal";
  const activeNavigationId = navigationId ?? sessionId;
  const siblingIndex = siblingIds.indexOf(activeNavigationId);
  const loadingShareState = initialSession && canManageCloudShare(pinarRuntime(), authSession, initialSession)
    ? initialSession.isShared ? "shared" : "unshared"
    : "hidden";

  const stepCapture = useCallback((delta: number) => {
    const next = siblingIds[siblingIds.indexOf(activeNavigationId) + delta];
    if (next) onNavigate?.(next);
  }, [activeNavigationId, onNavigate, siblingIds]);

  useEffect(() => {
    if (!isModal || siblingIds.length < 2) return;
    function onKey(event: KeyboardEvent) {
      // Pin details and form controls keep their own arrow-key behavior.
      if (selectedPin) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [role='menu'], [role='listbox'], [role='combobox']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      stepCapture(event.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isModal, selectedPin, siblingIds, stepCapture]);

  async function loadSession(isCurrent: () => boolean = () => true) {
    const results = await Promise.all(captureKey.split(",").map(async (id) => {
      const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
      const data: unknown = await response.json();
      if (!response.ok || !isRecord(data) || !isSession(data.session)) throw new Error("Capture unavailable");
      return { session: data.session, reviews: asReviews(data.reviews), executions: asExecutions(data.executions) };
    }));
    if (!isCurrent()) return;
    setCaptures(results.map((item) => item.session));
    setSession(results.find((item) => item.session.id === sessionId)?.session || results[0].session);
    setReviews(results.flatMap((item) => item.reviews));
    setExecutions(results.flatMap((item) => item.executions));
    setSelectedPin((current) => current ? results.flatMap((item) => item.session.pins).find((pin) => pinLookupId(pin) === pinLookupId(current)) || null : null);
  }

  useEffect(() => {
    let current = true;
    setLoading(true);
    void loadSession(() => current)
      .catch(() => { if (current) setSession(null); })
      .finally(() => { if (current) setLoading(false); });
    return () => {
      current = false;
    };
  }, [captureKey]);

  useEffect(() => {
    setShareOperation(null);
    setRevokeSettled(false);
    setShareError("");
    setShareLinkCopied(false);
    setShareToken(null);
    if (!showShareControls) return;
    let cancelled = false;
    void fetchActiveShare("session", sessionId)
      .then((token) => {
        if (!cancelled) setShareToken(token);
      })
      .catch(() => {
        if (!cancelled) setShareToken(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, showShareControls]);

  async function submitReview(pin: Pin, action: PinReviewHumanAction) {
    const pinId = pinLookupId(pin);
    if (!pinId || reviewBusy) return;
    setReviewBusy(true);
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(pinOwner(pin)?.id || sessionId)}/pins/${encodeURIComponent(pinId)}/review`,
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

  // Viewer edits on a pin (a trimmed evidence list, an accepted diagnosis, a
  // generated component) are stored on the capture through one PATCH.
  async function patchPin(pin: Pin, fields: Record<string, unknown>, failureMessage: ServerMessageKey) {
    const pinId = pinLookupId(pin);
    if (!pinId || pinPatchBusy) return false;
    setPinPatchBusy(true);
    setPinPatchError("");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(pinOwner(pin)?.id || sessionId)}`, {
        body: JSON.stringify({ pins: [{ ...fields, pinId }] }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) {
        setPinPatchError(t(failureMessage));
        return false;
      }
      await loadSession();
      return true;
    } catch {
      setPinPatchError(t(failureMessage));
      return false;
    } finally {
      setPinPatchBusy(false);
    }
  }

  async function persistReproduction(reproduction: Reproduction | null, captureId = sessionId) {
    if (pinPatchBusy) return false;
    setPinPatchBusy(true);
    setPinPatchError("");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(captureId)}`, {
        body: JSON.stringify({ reproduction }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) return false;
      await loadSession();
      return true;
    } catch {
      return false;
    } finally {
      setPinPatchBusy(false);
    }
  }

  async function removeEvidenceItem(pin: Pin, index: number) {
    if (!pin.evidence) return;
    const items = pin.evidence.items.filter((_item, position) => position !== index);
    await patchPin(pin, { evidence: items.length ? { ...pin.evidence, items } : null }, "viewer.evidenceRemoveFailed");
  }

  function markdownUrl() {
    return new URL(shareMarkdownPath(sessionId, shareToken), window.location.origin).toString();
  }

  async function copyShareLink() {
    if (!shareControls.copyEnabled || !shareToken) return;
    await navigator.clipboard.writeText(buildShareUrl(sessionId, shareToken, window.location.origin));
    setShareLinkCopied(true);
    window.setTimeout(() => setShareLinkCopied(false), 2_000);
  }

  async function publishShareLink() {
    if (shareOperation) return;
    setShareOperation("publish");
    setRevokeSettled(false);
    setShareError("");
    try {
      setShareToken(await publishShare("session", sessionId));
      await onShareChange?.();
    } catch {
      setShareError(t("share.error"));
    } finally {
      setShareOperation(null);
    }
  }

  async function revokeShareLink() {
    if (shareOperation) return;
    setShareOperation("revoke");
    setRevokeSettled(false);
    setShareError("");
    try {
      await revokeShare("session", sessionId);
      setRevokeSettled(true);
      setShareToken(null);
      await onShareChange?.();
    } catch {
      setShareError(t("share.error"));
    } finally {
      setShareOperation(null);
      setRevokeSettled(false);
    }
  }

  const aggregateBatchId = isModal && session?.batchId ? session.batchId : null;
  const promptRevision = aggregateBatchId ? batchPromptRevision(captures, reviews) : "";
  const promptRevisionRef = useRef(promptRevision);
  promptRevisionRef.current = promptRevision;

  useEffect(() => {
    if (!aggregateBatchId) return;
    void promptCache.prepare(aggregateBatchId, promptRevision).catch(() => undefined);
  }, [aggregateBatchId, promptCache, promptRevision]);

  useEffect(() => {
    setCopyPhase("idle");
  }, [aggregateBatchId, promptRevision]);

  async function copyBatch(batchId: string) {
    if (!await copyBatchHandoff(batchId)) return;
    setBatchCopied(true);
    window.setTimeout(() => setBatchCopied(false), 2_000);
  }

  async function copyPage() {
    if (!session) return;
    if (aggregateBatchId) {
      if (copyPhase === "preparing") return;
      const revision = promptRevision;
      const waiting = promptCache.prepared(aggregateBatchId, revision) === undefined;
      if (waiting) setCopyPhase("preparing");
      try {
        const text = await promptCache.prepare(aggregateBatchId, revision);
        await navigator.clipboard.writeText(text);
        if (promptRevisionRef.current !== revision) return;
        setCopyPhase("copied");
        window.setTimeout(() => setCopyPhase((phase) => phase === "copied" ? "idle" : phase), 2_000);
      } catch {
        if (promptRevisionRef.current !== revision) return;
        setCopyPhase("error");
      }
      return;
    }
    await navigator.clipboard.writeText(formatClipboardText(
      session.page,
      session.pins,
      session.shotUrl,
      markdownUrl(),
      session.captureId || session.id,
      session.includeScreenshot !== false,
      handoffMode,
      language,
    ));
    setPageCopied(true);
    window.setTimeout(() => setPageCopied(false), 2_000);
  }

  const copyPromptLabels = [
    t("dashboard.copyPrompt"),
    t("dashboard.copyPromptPreparing"),
    t("common.copied"),
    t("dashboard.copyPromptFailed"),
  ] as const;
  const copyPromptLabel = aggregateBatchId
    ? copyPhase === "preparing"
      ? t("dashboard.copyPromptPreparing")
      : copyPhase === "copied"
        ? t("common.copied")
        : copyPhase === "error"
          ? t("dashboard.copyPromptFailed")
          : t("dashboard.copyPrompt")
    : pageCopied ? t("common.copied") : t("dashboard.copyPrompt");
  const copyPromptCopied = aggregateBatchId ? copyPhase === "copied" : pageCopied;


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
      <ViewerLoadingState
        isModal={isModal}
        shareState={loadingShareState}
        siblingCount={siblingIds.length}
        siblingIndex={siblingIndex}
        t={t}
        onStep={stepCapture}
      />,
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

  const selectedIndex = selectedPin ? (selectedCapture?.pins || []).indexOf(selectedPin) : -1;
  const selectedNumber = selectedPin ? pinNumber(selectedPin, Math.max(0, selectedIndex)) : 0;
  const selectedColor = selectedPin?.color || getPinColor(selectedNumber);
  const selectedMarkdown = selectedPin ? formatPinMarkdown(selectedPin, selectedNumber) : "";
  const batchId = session.batchId ?? null;

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
            session={session}
            t={t}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ViewerNavigation
            siblingCount={siblingIds.length}
            siblingIndex={siblingIndex}
            t={t}
            onStep={stepCapture}
          />
          {showShareControls ? (
            shareControls.branch === "shared" ? (
              <>
                <ButtonGroup aria-label={t("dashboard.share")}>
                  <Button
                    aria-label={shareLinkCopied ? t("share.linkCopied") : t("share.copyLink")}
                    disabled={!shareControls.copyEnabled}
                    title={shareError || t("share.copyLink")}
                    type="button"
                    variant="outline"
                    onClick={() => void copyShareLink()}
                  >
                    {shareLinkCopied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                    <span className="hidden sm:inline">{shareLinkCopied ? t("share.linkCopied") : t("share.copyLink")}</span>
                  </Button>
                  <Button
                    aria-label={shareControls.revokeLabel === "revoking" ? t("share.revoking") : t("share.revoke")}
                    disabled={shareControls.revokeDisabled}
                    title={shareError || t("share.revoke")}
                    type="button"
                    variant="outline"
                    onClick={() => void revokeShareLink()}
                  >
                    <UnlinkIcon data-icon="inline-start" />
                    <span className="hidden sm:inline">{shareControls.revokeLabel === "revoking" ? t("share.revoking") : t("share.revoke")}</span>
                  </Button>
                </ButtonGroup>
              </>
            ) : (
              <Button
                aria-label={shareControls.publishLabel === "publishing" ? t("share.publishing") : t("share.publish")}
                disabled={shareControls.publishDisabled}
                title={shareError || t("share.publish")}
                type="button"
                variant="outline"
                onClick={() => void publishShareLink()}
              >
                <ShareIcon data-icon="inline-start" />
                <span className="hidden sm:inline">{shareControls.publishLabel === "publishing" ? t("share.publishing") : t("share.publish")}</span>
              </Button>
            )
          ) : null}
          <ButtonGroup aria-label={t("viewer.pageActions")}>
            <Button
              aria-busy={aggregateBatchId && copyPhase === "preparing" ? true : undefined}
              aria-invalid={aggregateBatchId && copyPhase === "error" ? true : undefined}
              aria-label={copyPromptLabel}
              disabled={Boolean(aggregateBatchId && copyPhase === "preparing")}
              title={copyPromptLabel}
              type="button"
              variant="outline"
              onClick={() => void copyPage()}
            >
              {copyPromptCopied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
              {aggregateBatchId ? (
                <CopyPromptLabel active={copyPromptLabel} labels={copyPromptLabels} />
              ) : (
                <span className="hidden sm:inline">{copyPromptLabel}</span>
              )}
            </Button>
            {batchId && !isModal ? (
              <Button
                aria-label={batchCopied ? t("common.copied") : t("dashboard.copyBatch")}
                type="button"
                variant="outline"
                onClick={() => void copyBatch(batchId)}
              >
                {batchCopied ? <CheckIcon data-icon="inline-start" /> : <LayersIcon data-icon="inline-start" />}
                <span className="hidden sm:inline">{batchCopied ? t("common.copied") : t("dashboard.copyBatch")}</span>
              </Button>
            ) : null}
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
                copied={pageCopied}
                session={session}
                shareToken={shareToken}
                t={t}
                onDelete={onDelete}
                onMove={onMove}
              />
            </DropdownMenu>
          </ButtonGroup>
          {isModal ? <ViewerCloseButton /> : null}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,3fr)_minmax(12rem,2fr)] md:grid-cols-[minmax(0,1fr)_22rem] md:grid-rows-1">
        {captures.some((capture) => capture.shotUrl) ? (
          <div className="relative flex min-h-0 min-w-0 flex-col">
            <ImageZoomStage
              alt={t("viewer.annotatedScreenshot")}
              src={session.shotUrl || ""}
              stageRef={zoom.stageRef}
              transform={zoom.transform}
              onDoubleClick={() => zoom.transform.scale <= 1 ? zoom.zoomBy(2) : zoom.resetZoom()}
              onPointerCancel={zoom.handlePointerUp}
              onPointerDown={zoom.handlePointerDown}
              onPointerMove={zoom.handlePointerMove}
              onPointerUp={zoom.handlePointerUp}
              onWheel={zoom.handleWheel}
            >
              {captures.length > 1 ? (
                <div className="grid w-full gap-6 p-8" style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(captures.length))}, minmax(0, 1fr))` }}>
                  {captures.map((capture) => (
                    <div key={capture.id} data-capture-image={capture.id} ref={(node) => { if (node) imageRefs.current.set(capture.id, node); else imageRefs.current.delete(capture.id); }} className={`overflow-hidden rounded-lg border bg-card shadow-sm ${highlightedCapture === capture.id ? "ring-2 ring-primary" : ""}`}>
                      <div className="truncate border-b px-3 py-2 text-xs font-medium">{capture.page.title || capture.page.url}</div>
                      {capture.shotUrl ? <img alt={capture.page.title || t("viewer.annotatedScreenshot")} src={capture.shotUrl} draggable={false} className="pointer-events-none block w-full select-none" /> : <p className="p-6 text-xs">{t("viewer.screenshotUnavailable")}</p>}
                    </div>
                  ))}
                </div>
              ) : undefined}
            </ImageZoomStage>
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
                  {t("dashboard.pinCount", { count: captures.reduce((count, capture) => count + capture.pins.length, 0) })}
                </h2>
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-3 p-4">
                {captures.filter((capture) => capture.reproduction).map((capture) => (
                  <ReproductionTimeline
                    canEdit={canEditPins}
                    key={capture.id}
                    reproduction={capture.reproduction!}
                    sessionId={capture.id}
                    showAi={showAiReproduction && canEditPins}
                    onPersist={(value) => persistReproduction(value, capture.id)}
                  />
                ))}
                {captures.flatMap((capture) => capture.pins.map((pin, index) => ({ capture, pin, index }))).map(({ capture, pin, index }) => {
                  const number = pinNumber(pin, index);
                  const color = pin.color || getPinColor(number);
                  const isArea = pin.type === "area" || pin.kind === "area";
                  const review = reviewForPin(reviews, pin);
                  return (
                    <Button
                      className="h-auto w-full justify-start p-0 text-left whitespace-normal"
                      key={`${capture.id}-${pinLookupId(pin)}`}
                      title={t("viewer.openPin", { number })}
                      variant="ghost"
                      onClick={() => { setHighlightedCapture(capture.id); const image = imageRefs.current.get(capture.id); if (image) zoom.focusElement(image); setSelectedPin(pin); }}
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
                            {captures.length > 1 ? <p className="mt-1 truncate text-xs text-muted-foreground">{capture.page.title || capture.page.url}</p> : null}
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
      <Dialog open={Boolean(selectedPin)} onOpenChange={(open) => !open && setSelectedPin(null)}>
        <DialogContent className="min-w-0 max-w-[calc(100vw-2rem)] overflow-x-hidden sm:max-w-5xl" outsideScroll showCloseButton>
          {selectedPin && (
            <Tabs className="min-w-0" defaultValue="preview">
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
                  {selectedPin.snapshot ? <TabsTrigger value="structure">{t("viewer.structure")}</TabsTrigger> : null}
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
              {selectedPin.evidence ? (
                <PinEvidence
                  busy={pinPatchBusy}
                  canEdit={canEditPins}
                  evidence={selectedPin.evidence}
                  onRemove={(index) => void removeEvidenceItem(selectedPin, index)}
                />
              ) : null}
              {pinPatchError ? <p className="text-xs text-destructive">{pinPatchError}</p> : null}
              <TabsContent className="min-w-0" value="preview">
                <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
                  <article className="min-w-0 flex flex-col gap-4 p-5 text-sm leading-relaxed">
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
              <TabsContent className="min-w-0" value="raw">
                <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/40">
                  <pre className="whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
                    <code>{selectedMarkdown}</code>
                  </pre>
                </div>
              </TabsContent>
              {selectedPin.snapshot ? (
                <TabsContent className="min-w-0" value="structure">
                  <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
                    <PinStructure snapshot={selectedPin.snapshot} />
                  </div>
                </TabsContent>
              ) : null}
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
