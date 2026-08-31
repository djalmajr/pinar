import { useEffect, useMemo, useState, type MouseEventHandler, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useDraggable } from "@dnd-kit/core";
import {
  formatClipboardText,
  PIN_REVIEW_STATUSES,
  requestReopenSession,
  type PinReviewStatus,
  type Session,
} from "@pinar/shared";
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
  Checkbox,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  type ColumnDef,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  PaginationControls,
  type PaginationState,
  type RowSelectionState,
  ScrollArea,
  SidebarInset,
  SidebarTrigger,
  Skeleton,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from "@pinar/ui";
import { WorkspaceChrome, useWorkspaceChrome } from "@/components/WorkspaceChrome";
import { useDeliveryPreferences } from "@/lib/delivery-preferences";
import { useDocumentMeta } from "@/lib/document-meta";
import { type ServerMessageKey, useServerI18n } from "@/lib/i18n";
import { formatSessionDate } from "@/lib/session-date";
import { flattenCollections } from "@/lib/collection-tree";
import {
  filterSessions,
  pinCount,
  type PinCountFilter,
} from "@/lib/session-filters";
import { sessionListingCopy, flattenCollectionSessions } from "@/lib/session-listing";
import {
  SESSION_DND_TYPE,
  sessionDragId,
  sessionIdsForDrop,
} from "@/lib/workspace-dnd";
import {
  reorderSessionIds,
  type SessionOrderDirection,
} from "@/lib/session-order";
import { WebViewer } from "@/pages/WebViewer";
import ArrowDownIcon from "~icons/lucide/arrow-down";
import ArrowUpIcon from "~icons/lucide/arrow-up";
import CalendarIcon from "~icons/lucide/calendar-days";
import CheckIcon from "~icons/lucide/check";
import CopyIcon from "~icons/lucide/copy";
import ExternalLinkIcon from "~icons/lucide/external-link";
import FileTextIcon from "~icons/lucide/file-text";
import FolderIcon from "~icons/lucide/folder";
import GridIcon from "~icons/lucide/layout-grid";
import ListFilterIcon from "~icons/lucide/list-filter";
import Maximize2Icon from "~icons/lucide/maximize-2";
import MessageCircleIcon from "~icons/lucide/message-circle";
import MoreVerticalIcon from "~icons/lucide/ellipsis-vertical";
import FolderInputIcon from "~icons/lucide/folder-input";
import SearchIcon from "~icons/lucide/search";
import ScanSearchIcon from "~icons/lucide/scan-search";
import TableIcon from "~icons/lucide/table-2";
import TrashIcon from "~icons/lucide/trash-2";
import XIcon from "~icons/lucide/x";

const HISTORY_VIEW_KEY = "pinar-history-view";
const SESSION_PAGE_SIZE_OPTIONS = [15, 30, 60, 100] as const;

type HistoryView = "grid" | "table";
type Translate = (key: ServerMessageKey, values?: Record<string, string | number>) => string;

function shotUrl(session: Session) {
  return session.shotUrl || (session.shotId ? `/shots/${session.shotId}.png` : null);
}

function SessionPageLink({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a
      className="inline-flex max-w-full items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary"
      draggable={false}
      href={url}
      rel="noopener noreferrer"
      target="_blank"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="truncate">{url}</span>
      <ExternalLinkIcon className="size-3 shrink-0" />
    </a>
  );
}

function SessionIdentity({
  collectionName,
  heading = false,
  session,
}: {
  collectionName?: string;
  heading?: boolean;
  session: Session;
}) {
  const { description, title, url } = sessionListingCopy(session.page);
  const collectionLabel = collectionName ? (
    <span className="inline-flex max-w-40 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <FolderIcon className="size-3.5 shrink-0" />
      <span className="truncate">{collectionName}</span>
    </span>
  ) : null;
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      {title ? (
        heading ? (
          <CardTitle className="line-clamp-1">{title}</CardTitle>
        ) : (
          <span className="flex max-w-full min-w-0 items-center gap-2">
            <span className="min-w-0 truncate align-bottom font-medium" title={title}>{title}</span>
            {collectionLabel}
          </span>
        )
      ) : null}
      {(heading || !title) ? collectionLabel : null}
      {description ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
      ) : null}
      {heading ? (
        <CardDescription className="min-w-0">
          <SessionPageLink url={url} />
        </CardDescription>
      ) : (
        <SessionPageLink url={url} />
      )}
    </div>
  );
}

function SessionActions({
  copied,
  session,
  onCopy,
  onDelete,
  onMove,
  onReorder,
  onView,
  canMoveEarlier,
  canMoveLater,
  t,
}: {
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  copied: boolean;
  session: Session;
  onCopy: (session: Session) => void;
  onDelete: (id: string) => void;
  onMove: (id: string) => void;
  onReorder: (sessionId: string, direction: SessionOrderDirection) => void;
  onView: (sessionId: string) => void;
  t: Translate;
}) {
  return (
    <div className="flex items-center justify-end gap-0.5" data-session-actions>
      <Button
        aria-label={copied ? t("common.copied") : t("dashboard.copyPrompt")}
        data-no-dnd=""
        size="icon-sm"
        title={copied ? t("common.copied") : t("dashboard.copyPrompt")}
        variant="ghost"
        onClick={() => onCopy(session)}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button aria-label={t("dashboard.moreActions")} data-no-dnd="" size="icon-sm" title={t("dashboard.moreActions")} variant="ghost" />}
        >
          <MoreVerticalIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-96 w-64 overflow-y-auto">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => onView(session.id)}>
              <Maximize2Icon />
              {t("dashboard.view")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => requestReopenSession(session.id)}>
              <ScanSearchIcon />
              {t("dashboard.reviewOnPage")}
            </DropdownMenuItem>
            <DropdownMenuItem render={<a href={`/v/${session.id}.md`} rel="noopener noreferrer" target="_blank" />}>
              <FileTextIcon />
              {t("dashboard.markdown")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(session.id)}>
              <FolderInputIcon />
              {t("dashboard.moveTo")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {(canMoveEarlier || canMoveLater) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("dashboard.order")}</DropdownMenuLabel>
                {canMoveEarlier && (
                  <DropdownMenuItem onClick={() => onReorder(session.id, "earlier")}>
                    <ArrowUpIcon />
                    {t("dashboard.moveEarlier")}
                  </DropdownMenuItem>
                )}
                {canMoveLater && (
                  <DropdownMenuItem onClick={() => onReorder(session.id, "later")}>
                    <ArrowDownIcon />
                    {t("dashboard.moveLater")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(session.id)}>
            <TrashIcon />
            {t("dashboard.deleteSession")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SessionPreview({
  compact = false,
  session,
  t,
  onOpen,
}: {
  compact?: boolean;
  session: Session;
  t: Translate;
  onOpen?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const previewUrl = shotUrl(session);
  if (compact) {
    const preview = !previewUrl || failed ? (
      <span aria-hidden="true" className="block size-full bg-muted" />
    ) : (
      <img
        alt=""
        className="size-full object-cover object-top"
        draggable={false}
        src={previewUrl}
        onError={() => setFailed(true)}
      />
    );
    if (!onOpen) return <span className="block h-11 w-[4.5rem] overflow-hidden rounded-md">{preview}</span>;
    return (
      <button
        aria-label={t("dashboard.openPreview")}
        className="block h-11 w-[4.5rem] overflow-hidden rounded-md border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        data-no-dnd=""
        type="button"
        onClick={onOpen}
      >
        {preview}
      </button>
    );
  }
  if (!previewUrl || failed) return null;
  return (
    <button
      aria-label={t("dashboard.openPreview")}
      className="group relative block h-32 w-full overflow-hidden border-b bg-muted"
      data-no-dnd=""
      type="button"
      onClick={onOpen}
    >
      <img
        alt={session.page.title || t("dashboard.screenshot")}
        className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.01]"
        draggable={false}
        src={previewUrl}
        onError={() => setFailed(true)}
      />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
        <Maximize2Icon />
        {t("dashboard.openPreview")}
      </span>
    </button>
  );
}


function DashboardSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
      {Array.from({ length: 8 }, (_, index) => (
        <Card className="gap-0 py-0" key={index} size="sm">
          <Skeleton className="h-32 rounded-b-none" />
          <CardHeader className="py-3"><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-3/5" /></CardHeader>
          <CardFooter className="mt-auto justify-between gap-2 py-2.5"><Skeleton className="h-4 w-24" /><Skeleton className="size-6" /></CardFooter>
        </Card>
      ))}
    </div>
  );
}

function reviewStatusLabel(t: Translate, status: PinReviewStatus) {
  if (status === "correction_ready") return t("dashboard.reviewCorrectionReady");
  if (status === "accepted") return t("dashboard.reviewAccepted");
  if (status === "reopened") return t("dashboard.reviewReopened");
  return t("dashboard.reviewOpen");
}

function reviewStatusBadge(status: PinReviewStatus) {
  if (status === "correction_ready") return "warning" as const;
  if (status === "accepted") return "successSoft" as const;
  if (status === "reopened") return "secondary" as const;
  return "outline" as const;
}

function ReviewCounts({ session, t }: { session: Session; t: Translate }) {
  const counts = session.reviewCounts;
  if (!counts) return null;
  const visible = PIN_REVIEW_STATUSES.filter((status) => counts[status] > 0);
  if (!visible.length) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {visible.map((status) => (
        <Badge key={status} variant={reviewStatusBadge(status)}>
          {counts[status]} {reviewStatusLabel(t, status)}
        </Badge>
      ))}
    </span>
  );
}

function sessionSelectLabel(session: Session, t: Translate) {
  const copy = sessionListingCopy(session.page);
  return t("dashboard.selectSession", { title: copy.title || copy.url || session.id });
}

function SessionSelectCheckbox({
  checked,
  indeterminate = false,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      aria-label={label}
      checked={checked}
      data-no-dnd=""
      indeterminate={indeterminate}
      onCheckedChange={onCheckedChange}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

function DraggableSessionTableRow({
  children,
  className,
  onClick,
  selected,
  selectedIds,
  session,
}: {
  children: ReactNode;
  className?: string;
  onClick?: MouseEventHandler<HTMLTableRowElement>;
  selected: boolean;
  selectedIds: ReadonlySet<string>;
  session: Session;
}) {
  const sessionIds = sessionIdsForDrop(session.id, selectedIds);
  const draggable = useDraggable({
    data: {
      sessionId: session.id,
      sessionIds,
      title: sessionListingCopy(session.page).title || session.page.url || session.id,
      type: SESSION_DND_TYPE,
    },
    id: sessionDragId(session.id),
  });
  return (
    <TableRow
      ref={draggable.setNodeRef}
      className={cn(className, draggable.isDragging && "cursor-grabbing opacity-40")}
      data-session-drag-surface={session.id}
      data-session-id={session.id}
      data-state={selected ? "selected" : undefined}
      {...draggable.attributes}
      {...draggable.listeners}
      role="row"
      onClick={onClick}
    >
      {children}
    </TableRow>
  );
}

function DraggableSessionCard({
  children,
  selected,
  selectedIds,
  session,
}: {
  children: ReactNode;
  selected: boolean;
  selectedIds: ReadonlySet<string>;
  session: Session;
}) {
  const sessionIds = sessionIdsForDrop(session.id, selectedIds);
  const draggable = useDraggable({
    data: {
      sessionId: session.id,
      sessionIds,
      title: sessionListingCopy(session.page).title || session.page.url || session.id,
      type: SESSION_DND_TYPE,
    },
    id: sessionDragId(session.id),
  });
  return (
    <Card
      ref={draggable.setNodeRef}
      className={cn(
        "relative gap-0 py-0 transition-colors hover:ring-primary/35",
        selected && "ring-primary/50",
        draggable.isDragging && "cursor-grabbing opacity-40",
      )}
      data-session-drag-surface={session.id}
      data-session-id={session.id}
      size="sm"
      {...draggable.attributes}
      {...draggable.listeners}
      role={undefined}
    >
      {children}
    </Card>
  );
}

export function HistoryDashboard({ viewerSessionId }: { viewerSessionId?: string }) {
  return (
    <WorkspaceChrome>
      <HistoryDashboardContent viewerSessionId={viewerSessionId} />
    </WorkspaceChrome>
  );
}

function HistoryDashboardContent({ viewerSessionId }: { viewerSessionId?: string }) {
  const { language, t } = useServerI18n();
  const { handoffMode, includeScreenshot } = useDeliveryPreferences();
  const navigate = useNavigate();
  const {
    fetchTree,
    loading,
    moveSessions,
    projectTree,
    selectedCollection,
    selectedCollectionId,
    selectedProject,
    setProjectTree,
  } = useWorkspaceChrome();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [moveIds, setMoveIds] = useState<string[]>([]);
  const [moveProjectId, setMoveProjectId] = useState("");
  const [moveCollectionId, setMoveCollectionId] = useState("");
  const [moving, setMoving] = useState(false);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: SESSION_PAGE_SIZE_OPTIONS[0],
  });
  const [pinFilters, setPinFilters] = useState<PinCountFilter[]>([]);
  const [reviewFilters, setReviewFilters] = useState<PinReviewStatus[]>([]);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<HistoryView>("grid");
  useDocumentMeta(selectedCollection?.name || t("dashboard.allSessions"));

  const sessions = useMemo(
    () => selectedCollection
      ? selectedCollection.sessions
      : flattenCollectionSessions(selectedProject?.collections),
    [selectedCollection, selectedProject],
  );
  const collectionNameBySessionId = useMemo(() => {
    const names = new Map<string, string>();
    for (const collection of selectedProject?.collections ?? []) {
      for (const session of collection.sessions) {
        if (!names.has(session.id)) names.set(session.id, collection.name);
      }
    }
    return names;
  }, [selectedProject]);
  const moveProjects = projectTree.projects;
  const moveProjectIds = moveProjects.map((project) => project.id);
  const moveCollectionTree = flattenCollections(
    moveProjects.find((project) => project.id === moveProjectId)?.collections ?? [],
  );
  const moveCollectionIds = moveCollectionTree.map(({ collection }) => collection.id);

  const filteredSessions = useMemo(
    () => filterSessions(sessions, search, pinFilters, reviewFilters),
    [pinFilters, reviewFilters, search, sessions],
  );
  const gridSessions = useMemo(() => {
    const start = pagination.pageIndex * pagination.pageSize;
    const ordered = selectedCollection
      ? filteredSessions
      : [...filteredSessions].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    return ordered.slice(start, start + pagination.pageSize);
  }, [filteredSessions, pagination.pageIndex, pagination.pageSize, selectedCollection]);
  const pageCount = Math.max(1, Math.ceil(filteredSessions.length / pagination.pageSize));
  const rowSelection = useMemo(
    () => Object.fromEntries([...selectedIds].map((id) => [id, true])),
    [selectedIds],
  );
  const gridPageSelected = gridSessions.length > 0
    && gridSessions.every((session) => selectedIds.has(session.id));
  const gridPagePartiallySelected = gridSessions.some((session) => selectedIds.has(session.id))
    && !gridPageSelected;

  useEffect(() => {
    const existing = new Set(sessions.map((session) => session.id));
    setSelectedIds((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (existing.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [sessions]);

  useEffect(() => {
    const savedView = localStorage.getItem(HISTORY_VIEW_KEY);
    if (savedView === "grid" || savedView === "table") setView(savedView);
  }, []);

  useEffect(() => {
    setPagination((current) => current.pageIndex === 0
      ? current
      : { ...current, pageIndex: 0 });
  }, [pinFilters, reviewFilters, search, selectedCollectionId, selectedProject?.id]);

  useEffect(() => {
    if (pagination.pageIndex < pageCount) return;
    setPagination((current) => ({ ...current, pageIndex: pageCount - 1 }));
  }, [pageCount, pagination.pageIndex]);

  async function requestJson(path: string, method: string, body?: unknown) {
    return fetch(path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      method,
    });
  }

  function toggleSessionSelected(sessionId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }

  function setRowSelection(updater: RowSelectionState | ((current: RowSelectionState) => RowSelectionState)) {
    const next = typeof updater === "function" ? updater(rowSelection) : updater;
    const ids = Object.entries(next).flatMap(([id, on]) => (on ? [id] : []));
    setSelectedIds((current) => {
      if (current.size === ids.length && ids.every((id) => current.has(id))) return current;
      return new Set(ids);
    });
  }

  async function reorderSession(sessionId: string, direction: SessionOrderDirection) {
    if (!selectedCollection || !selectedProject) return;
    const ids = reorderSessionIds(selectedCollection.sessions.map(({ id }) => id), sessionId, direction);
    if (!ids) return;
    const byId = new Map(selectedCollection.sessions.map((session) => [session.id, session]));
    const nextSessions = ids.flatMap((id, position) => {
      const session = byId.get(id);
      return session ? [{ ...session, position }] : [];
    });
    setProjectTree((current) => ({
      projects: current.projects.map((project) => project.id === selectedProject.id
        ? {
            ...project,
            collections: project.collections.map((collection) => collection.id === selectedCollection.id
              ? { ...collection, sessions: nextSessions }
              : collection),
          }
        : project),
    }));
    await requestJson(
      `/api/collections/${selectedCollection.id}/sessions/reorder`,
      "POST",
      { ids },
    );
    await fetchTree(selectedProject.id);
  }

  async function copyPrompt(session: Session) {
    await navigator.clipboard.writeText(formatClipboardText(
      session.page,
      session.pins,
      session.shotUrl,
      session.viewerUrl || `/v/${session.id}.md`,
      session.captureId || session.id,
      includeScreenshot,
      handoffMode,
    ));
    setCopiedId(session.id);
    window.setTimeout(() => setCopiedId(null), 2_000);
  }

  async function deleteSessions() {
    if (!deleteIds.length) return;
    await Promise.all(deleteIds.map((id) => fetch(`/api/history/${id}`, { method: "DELETE" })));
    setSelectedIds((current) => {
      const removed = new Set(deleteIds);
      return new Set([...current].filter((id) => !removed.has(id)));
    });
    setDeleteIds([]);
    await fetchTree(selectedProject?.id);
  }

  function openMoveDialog(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return;
    const project = selectedProject ?? projectTree.projects.find((item) => item.collections.length > 0);
    setMoveProjectId(project?.id ?? "");
    setMoveCollectionId("");
    setMoveIds(uniqueIds);
  }

  async function submitMove() {
    if (!moveIds.length || !moveCollectionId || moving) return;
    setMoving(true);
    try {
      await moveSessions(moveIds, moveCollectionId);
      setSelectedIds((current) => {
        const movedIds = new Set(moveIds);
        return new Set([...current].filter((id) => !movedIds.has(id)));
      });
      setMoveIds([]);
    } finally {
      setMoving(false);
    }
  }

  function openViewer(sessionId: string) {
    void navigate({ search: { session: sessionId }, to: "/app" });
  }

  function closeViewer() {
    void navigate({ search: { session: undefined }, to: "/app" });
  }

  function selectView(nextView: string) {
    if (nextView !== "grid" && nextView !== "table") return;
    setView(nextView);
    localStorage.setItem(HISTORY_VIEW_KEY, nextView);
  }

  const tableColumns = useMemo<ColumnDef<Session>[]>(() => [
    {
      cell: ({ row }) => (
        <SessionSelectCheckbox
          checked={row.getIsSelected()}
          label={sessionSelectLabel(row.original, t)}
          onCheckedChange={(checked) => row.toggleSelected(checked)}
        />
      ),
      enableHiding: false,
      enableSorting: false,
      header: ({ table }) => (
        <SessionSelectCheckbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
          label={t("dashboard.selectAll")}
          onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
        />
      ),
      id: "select",
      maxSize: 40,
      meta: { fit: true, label: t("dashboard.selectAll") },
      minSize: 40,
      size: 40,
    },
    {
      cell: ({ row }) => (
        <SessionPreview compact session={row.original} t={t} onOpen={() => openViewer(row.original.id)} />
      ),
      enableHiding: false,
      enableSorting: false,
      header: t("dashboard.preview"),
      id: "preview",
      maxSize: 88,
      meta: { fit: true, label: t("dashboard.preview") },
      minSize: 88,
      size: 88,
    },
    {
      accessorFn: (session) => sessionListingCopy(session.page).title || session.page.url,
      cell: ({ row }) => (
        <SessionIdentity
          collectionName={selectedCollection ? undefined : collectionNameBySessionId.get(row.original.id)}
          session={row.original}
        />
      ),
      enableHiding: false,
      header: t("dashboard.session"),
      id: "session",
      meta: { grow: true, label: t("dashboard.session"), wrap: true },
    },
    {
      cell: ({ row }) => <ReviewCounts session={row.original} t={t} />,
      header: t("dashboard.reviewStatus"),
      id: "review",
      meta: { label: t("dashboard.reviewStatus") },
      size: 160,
    },
    {
      accessorFn: pinCount,
      cell: ({ row }) => <span className="inline-flex items-center gap-1.5 text-muted-foreground"><MessageCircleIcon className="text-primary" />{pinCount(row.original)}</span>,
      header: t("dashboard.pins"),
      id: "pins",
      meta: { label: t("dashboard.pins") },
      size: 90,
    },
    {
      accessorFn: (session) => new Date(session.createdAt).getTime(),
      cell: ({ row }) => <time className="text-muted-foreground" dateTime={row.original.createdAt}>{formatSessionDate(row.original, language)}</time>,
      header: t("dashboard.created"),
      id: "createdAt",
      meta: { label: t("dashboard.created") },
      size: 180,
    },
    {
      cell: ({ row }) => (
        <SessionActions
          canMoveEarlier={false}
          canMoveLater={false}
          copied={copiedId === row.original.id}
          session={row.original}
          onCopy={(session) => void copyPrompt(session)}
          onDelete={(id) => setDeleteIds([id])}
          onMove={(id) => openMoveDialog([id])}
          onReorder={(sessionId, direction) => void reorderSession(sessionId, direction)}
          onView={openViewer}
          t={t}
        />
      ),
      enableHiding: false,
      enableSorting: false,
      header: t("dashboard.actions"),
      id: "actions",
      meta: { align: "right", label: t("dashboard.actions") },
      size: 76,
    },
  ], [collectionNameBySessionId, copiedId, handoffMode, includeScreenshot, language, projectTree.projects, selectedCollection, selectedProject, t]);

  const searchControl = (
    <div className="relative min-w-0 flex-1 sm:w-56 sm:min-w-40 sm:flex-none">
      <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="bg-background pl-9" placeholder={t("dashboard.search")} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
    </div>
  );
  const pinFilterOptions: Array<{ label: string; value: PinCountFilter }> = [
    { label: t("dashboard.onePin"), value: "one" },
    { label: t("dashboard.twoToFivePins"), value: "twoToFive" },
    { label: t("dashboard.sixOrMorePins"), value: "sixOrMore" },
  ];
  const pinFilterControl = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button className="border-dashed font-normal" variant="outline" />}><ListFilterIcon data-icon="inline-start" />{t("dashboard.pins")}{pinFilters.length > 0 && <Badge className="rounded-md px-1 font-normal" variant="secondary">{pinFilters.length}</Badge>}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuGroup><DropdownMenuLabel>{t("dashboard.pins")}</DropdownMenuLabel>{pinFilterOptions.map((option) => <DropdownMenuCheckboxItem checked={pinFilters.includes(option.value)} key={option.value} onClick={() => setPinFilters((current) => current.includes(option.value) ? current.filter((item) => item !== option.value) : [...current, option.value])}>{option.label}</DropdownMenuCheckboxItem>)}</DropdownMenuGroup>
        {pinFilters.length > 0 && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setPinFilters([])}><XIcon />{t("dashboard.clearFilter")}</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const reviewFilterControl = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button className="border-dashed font-normal" variant="outline" />}><ListFilterIcon data-icon="inline-start" />{t("dashboard.reviewStatus")}{reviewFilters.length > 0 && <Badge className="rounded-md px-1 font-normal" variant="secondary">{reviewFilters.length}</Badge>}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("dashboard.reviewStatus")}</DropdownMenuLabel>
          {PIN_REVIEW_STATUSES.map((status) => (
            <DropdownMenuCheckboxItem
              checked={reviewFilters.includes(status)}
              key={status}
              onClick={() => setReviewFilters((current) => (
                current.includes(status) ? current.filter((item) => item !== status) : [...current, status]
              ))}
            >
              {reviewStatusLabel(t, status)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {reviewFilters.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setReviewFilters([])}>
              <XIcon />
              {t("dashboard.clearFilter")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const viewControl = (
    <Tabs className="shrink-0" value={view} onValueChange={selectView}>
      <TabsList aria-label={t("dashboard.historyView")} variant="segmented">
        <TabsTrigger aria-label={t("dashboard.gridView")} title={t("dashboard.gridView")} value="grid"><GridIcon /></TabsTrigger>
        <TabsTrigger aria-label={t("dashboard.tableView")} title={t("dashboard.tableView")} value="table"><TableIcon /></TabsTrigger>
      </TabsList>
    </Tabs>
  );
  const selectionToolbar = selectedIds.size > 0 ? (
    <div className="flex shrink-0 items-center gap-2" data-bulk-toolbar>
      <Button variant="outline" onClick={() => openMoveDialog([...selectedIds])}>
        <FolderInputIcon data-icon="inline-start" />
        {t("dashboard.moveTo")}
      </Button>
      <Button variant="destructiveOutline" onClick={() => setDeleteIds([...selectedIds])}>
        <TrashIcon data-icon="inline-start" />
        {t("dashboard.delete")}
      </Button>
      <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>
        {t("dashboard.clearSelection")}
      </Button>
    </div>
  ) : null;
  const gridSelectControl = (
    <SessionSelectCheckbox
      checked={gridPageSelected}
      indeterminate={gridPagePartiallySelected}
      label={t("dashboard.selectAll")}
      onCheckedChange={(checked) => {
        const pageIds = gridSessions.map((session) => session.id);
        setSelectedIds((current) => {
          const next = new Set(current);
          for (const id of pageIds) {
            if (checked) next.add(id);
            else next.delete(id);
          }
          return next;
        });
      }}
    />
  );
  const paginationLabels = {
    nextPage: t("dashboard.nextPage"),
    pageStatus: (page: number, totalPages: number) => t("dashboard.pageStatus", {
      page,
      pageCount: totalPages,
    }),
    previousPage: t("dashboard.previousPage"),
    rowsPerPage: t("dashboard.sessionsPerPage"),
  };

  return (
    <>
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <ScrollArea
          className="min-h-0 min-w-0 flex-1 [&>[data-slot=scroll-area-scrollbar]]:hidden"
          data-dashboard-scroll-area
        >
          <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-4 p-5">
            {(view !== "table" || filteredSessions.length === 0) && (
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2" role="toolbar">
                  <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
                    <SidebarTrigger aria-label={t("dashboard.collections")} className="md:hidden" title={t("dashboard.collections")} />
                    {filteredSessions.length > 0 ? gridSelectControl : null}
                    {searchControl}
                    {pinFilterControl}
                    {reviewFilterControl}
                    {selectionToolbar}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center justify-end gap-2">{viewControl}</div>
                </div>
              </div>
            )}
            {loading ? <DashboardSkeleton /> : filteredSessions.length === 0 ? (
              <Card className="border-dashed py-16 text-center">
                <CardHeader>
                  <CardTitle>{t("dashboard.emptyTitle")}</CardTitle>
                  <CardDescription>{t("dashboard.emptyDescription")}</CardDescription>
                </CardHeader>
              </Card>
            ) : view === "table" ? (
              <DataTable
                columns={tableColumns}
                data={filteredSessions}
                emptyMessage={t("dashboard.filteredEmpty")}
                enableRowSelection
                footerStart={selectedIds.size > 0 ? (
                  <span className="text-sm text-muted-foreground" data-selected-count>
                    {t("dashboard.selectedCount", { count: selectedIds.size })}
                  </span>
                ) : null}
                getRowId={(session) => session.id}
                initialSorting={[{ desc: true, id: "createdAt" }]}
                labels={{
                  clearFilter: t("dashboard.clearFilter"),
                  columns: t("dashboard.columns"),
                  ...paginationLabels,
                  resetFilters: t("dashboard.resetFilters"),
                }}
                pageSizeOptions={SESSION_PAGE_SIZE_OPTIONS}
                pagination={pagination}
                renderRow={({ children, className, onClick, row, selected }) => (
                  <DraggableSessionTableRow
                    className={className}
                    selected={selected}
                    selectedIds={selectedIds}
                    session={row.original}
                    onClick={onClick}
                  >
                    {children}
                  </DraggableSessionTableRow>
                )}
                rowSelection={rowSelection}
                toolbar={(
                  <>
                    <SidebarTrigger aria-label={t("dashboard.collections")} className="md:hidden" title={t("dashboard.collections")} />
                    {searchControl}
                    {pinFilterControl}
                    {reviewFilterControl}
                    {selectionToolbar}
                  </>
                )}
                toolbarActions={viewControl}
                onPaginationChange={setPagination}
                onRowSelectionChange={setRowSelection}
              />
            ) : (
              <>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
                  {gridSessions.map((session) => {
                    const count = pinCount(session);
                    const orderIndex = selectedCollection?.sessions.findIndex(({ id }) => id === session.id) ?? -1;
                    return (
                      <DraggableSessionCard
                        key={session.id}
                        selected={selectedIds.has(session.id)}
                        selectedIds={selectedIds}
                        session={session}
                      >
                        <div className="absolute top-2 left-2 z-10" data-grid-selection>
                          <SessionSelectCheckbox
                            checked={selectedIds.has(session.id)}
                            label={sessionSelectLabel(session, t)}
                            onCheckedChange={(checked) => toggleSessionSelected(session.id, checked)}
                          />
                        </div>
                        <SessionPreview session={session} t={t} onOpen={() => openViewer(session.id)} />
                        <CardHeader className="py-3">
                          <div className="min-w-0">
                            <SessionIdentity
                              collectionName={selectedCollection ? undefined : collectionNameBySessionId.get(session.id)}
                              heading
                              session={session}
                            />
                          </div>
                        </CardHeader>
                        <CardFooter className="mt-auto justify-between gap-2 py-2.5">
                          <div className="flex min-w-0 flex-col gap-2 text-xs font-medium text-muted-foreground">
                            <div className="flex min-w-0 items-center gap-3">
                              <time className="inline-flex min-w-0 items-center gap-1.5" dateTime={session.createdAt}><CalendarIcon className="shrink-0 text-primary" /><span className="truncate">{formatSessionDate(session, language)}</span></time>
                              <span className="inline-flex shrink-0 items-center gap-1.5"><MessageCircleIcon className="text-primary" />{t("dashboard.pinCount", { count, label: t(count === 1 ? "dashboard.pinSingular" : "dashboard.pinPlural") })}</span>
                            </div>
                            <ReviewCounts session={session} t={t} />
                          </div>
                          <SessionActions canMoveEarlier={orderIndex > 0} canMoveLater={Boolean(selectedCollection && orderIndex >= 0 && orderIndex < selectedCollection.sessions.length - 1)} copied={copiedId === session.id} session={session} onCopy={(current) => void copyPrompt(current)} onDelete={(id) => setDeleteIds([id])} onMove={(id) => openMoveDialog([id])} onReorder={(sessionId, direction) => void reorderSession(sessionId, direction)} onView={openViewer} t={t} />
                        </CardFooter>
                      </DraggableSessionCard>
                    );
                  })}
                </div>
                <PaginationControls
                  labels={paginationLabels}
                  pageCount={pageCount}
                  pageIndex={pagination.pageIndex}
                  pageSize={pagination.pageSize}
                  pageSizeOptions={SESSION_PAGE_SIZE_OPTIONS}
                  onPageIndexChange={(pageIndex) => setPagination((current) => ({
                    ...current,
                    pageIndex,
                  }))}
                  onPageSizeChange={(pageSize) => setPagination({ pageIndex: 0, pageSize })}
                />
              </>
            )}
          </div>
        </ScrollArea>
      </SidebarInset>
      {viewerSessionId ? (
        <WebViewer onClose={closeViewer} presentation="modal" sessionId={viewerSessionId} />
      ) : null}
      <Dialog open={moveIds.length > 0} onOpenChange={(open) => !open && setMoveIds([])}>
        <DialogContent className="sm:max-w-2xl">
          <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submitMove(); }}>
            <DialogHeader>
              <DialogTitle>{t("dashboard.moveTo")}</DialogTitle>
              <DialogDescription>
                {t("dashboard.moveDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-semibold">{t("app.workspace")}</span>
                <Combobox
                  autoHighlight
                  itemToStringLabel={(projectId) => moveProjects.find((project) => project.id === String(projectId))?.name ?? ""}
                  itemToStringValue={(projectId) => String(projectId)}
                  items={moveProjectIds}
                  value={moveProjectId}
                  onValueChange={(value) => {
                    setMoveProjectId(String(value ?? ""));
                    setMoveCollectionId("");
                  }}
                >
                  <ComboboxInput aria-label={t("app.workspace")} className="w-full" placeholder={t("dashboard.chooseWorkspace")} />
                  <ComboboxContent>
                    <ComboboxEmpty>{t("dashboard.noWorkspacesFound")}</ComboboxEmpty>
                    <ComboboxList>
                      {(projectId) => {
                        const project = moveProjects.find((item) => item.id === String(projectId));
                        return project ? (
                          <ComboboxItem disabled={!project.collections.length} key={project.id} value={project.id}>
                            {project.name}
                          </ComboboxItem>
                        ) : null;
                      }}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </label>
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-semibold">{t("dashboard.collectionMenu")}</span>
                <Combobox
                  autoHighlight
                  disabled={!moveProjectId || !moveCollectionIds.length}
                  itemToStringLabel={(collectionId) => moveCollectionTree.find(({ collection }) => collection.id === String(collectionId))?.collection.name ?? ""}
                  itemToStringValue={(collectionId) => String(collectionId)}
                  items={moveCollectionIds}
                  value={moveCollectionId}
                  onValueChange={(value) => setMoveCollectionId(String(value ?? ""))}
                >
                  <ComboboxInput aria-label={t("dashboard.collectionMenu")} className="w-full" placeholder={t("dashboard.chooseCollection")} />
                  <ComboboxContent>
                    <ComboboxEmpty>{t("dashboard.noCollectionsFound")}</ComboboxEmpty>
                    <ComboboxList>
                      {(collectionId) => {
                        const entry = moveCollectionTree.find(({ collection }) => collection.id === String(collectionId));
                        return entry ? (
                          <ComboboxItem key={entry.collection.id} value={entry.collection.id}>
                            <span className="min-w-0 truncate" style={{ paddingInlineStart: `${entry.depth * 16}px` }}>
                              {entry.collection.name}
                            </span>
                          </ComboboxItem>
                        ) : null;
                      }}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMoveIds([])}>{t("common.cancel")}</Button>
              <Button disabled={!moveCollectionId || moving} type="submit">{t("dashboard.move")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteIds.length > 0} onOpenChange={(open) => !open && setDeleteIds([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteIds.length > 1
                ? t("dashboard.deleteSelectedTitle", { count: deleteIds.length })
                : t("dashboard.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteIds.length > 1
                ? t("dashboard.deleteSelectedDescription")
                : t("dashboard.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void deleteSessions()}>
              {t("dashboard.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
