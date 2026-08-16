import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  formatClipboardText,
  type CollectionPlacement,
  type ProjectTree,
  type ProjectTreeCollection,
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
  type ColumnDef,
  DataTable,
  Dialog,
  DialogContent,
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
  ScrollArea,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@pinar/ui";
import { HistorySidebar } from "@/components/HistorySidebar";
import { ServerFooter } from "@/components/ServerFooter";
import { ServerShell } from "@/components/ServerShell";
import { isProjectTreeProject, isRecord } from "@/lib/api-data";
import { type ServerMessageKey, useServerI18n } from "@/lib/i18n";
import { formatSessionDate } from "@/lib/session-date";
import CalendarIcon from "~icons/lucide/calendar-days";
import CheckIcon from "~icons/lucide/check";
import CopyIcon from "~icons/lucide/copy";
import ExternalLinkIcon from "~icons/lucide/external-link";
import FileTextIcon from "~icons/lucide/file-text";
import GridIcon from "~icons/lucide/layout-grid";
import ListFilterIcon from "~icons/lucide/list-filter";
import MessageCircleIcon from "~icons/lucide/message-circle";
import MoreHorizontalIcon from "~icons/lucide/more-horizontal";
import MoveRightIcon from "~icons/lucide/move-right";
import SearchIcon from "~icons/lucide/search";
import TableIcon from "~icons/lucide/table-2";
import TrashIcon from "~icons/lucide/trash-2";
import XIcon from "~icons/lucide/x";

const HISTORY_VIEW_KEY = "pinar-history-view";

type HistoryView = "grid" | "table";
type PinCountFilter = "one" | "twoToFive" | "sixOrMore";
type Translate = (key: ServerMessageKey, values?: Record<string, string | number>) => string;
type ContainerKind = "collection" | "project";

interface ContainerEditor {
  id?: string;
  kind: ContainerKind;
  mode: "create" | "rename";
  parentId?: string;
}

interface ContainerDelete {
  id: string;
  kind: ContainerKind;
}

interface DestinationOption {
  collectionId: string;
  label: string;
}

function pinCount(session: Session) {
  return session.pinCount ?? session.pins.length;
}

function pinCountFilterValue(count: number): PinCountFilter {
  if (count === 1) return "one";
  if (count <= 5) return "twoToFive";
  return "sixOrMore";
}

function shotUrl(session: Session) {
  return session.shotUrl || (session.shotId ? `/shots/${session.shotId}.png` : null);
}

function SessionPageLink({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a
      className="inline-flex max-w-full items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary"
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

function SessionActions({
  copied,
  destinations,
  session,
  onCopy,
  onDelete,
  onMove,
  t,
}: {
  copied: boolean;
  destinations: DestinationOption[];
  session: Session;
  onCopy: (session: Session) => void;
  onDelete: (id: string) => void;
  onMove: (sessionId: string, collectionId: string) => void;
  t: Translate;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button aria-label={t("dashboard.moreActions")} size="icon-xs" title={t("dashboard.moreActions")} variant="ghost" />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-64 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link params={{ id: session.id }} preload="intent" to="/v/$id" />}>
            <ExternalLinkIcon />
            {t("dashboard.view")}
          </DropdownMenuItem>
          <DropdownMenuItem render={<a href={`/v/${session.id}.md`} rel="noopener noreferrer" target="_blank" />}>
            <FileTextIcon />
            {t("dashboard.markdown")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCopy(session)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? t("common.copied") : t("dashboard.copyPrompt")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {destinations.some((destination) => destination.collectionId !== session.collectionId) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("dashboard.moveToCollection")}</DropdownMenuLabel>
            <DropdownMenuGroup>
              {destinations.filter((destination) => destination.collectionId !== session.collectionId).map((destination) => (
                <DropdownMenuItem key={destination.collectionId} onClick={() => onMove(session.id, destination.collectionId)}>
                  <MoveRightIcon />
                  {destination.label}
                </DropdownMenuItem>
              ))}
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
  );
}

function SessionPreview({ session, t }: { session: Session; t: Translate }) {
  const [failed, setFailed] = useState(false);
  const previewUrl = shotUrl(session);
  if (!previewUrl || failed) return null;
  return (
    <Link className="group relative block h-32 overflow-hidden border-b bg-muted" params={{ id: session.id }} preload="intent" to="/v/$id">
      <img
        alt={session.page.title || t("dashboard.screenshot")}
        className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.01]"
        src={previewUrl}
        onError={() => setFailed(true)}
      />
      <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
        <ExternalLinkIcon />
        {t("dashboard.openViewer")}
      </span>
    </Link>
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

export function HistoryDashboard() {
  const { language, t } = useServerI18n();
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [containerDelete, setContainerDelete] = useState<ContainerDelete | null>(null);
  const [containerEditor, setContainerEditor] = useState<ContainerEditor | null>(null);
  const [containerName, setContainerName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pinFilters, setPinFilters] = useState<PinCountFilter[]>([]);
  const [projectTree, setProjectTree] = useState<ProjectTree>({ projects: [] });
  const [search, setSearch] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [view, setView] = useState<HistoryView>("grid");

  const selectedProject = projectTree.projects.find((project) => project.id === selectedProjectId)
    ?? projectTree.projects[0];
  const selectedCollection = selectedProject?.collections.find((collection) => collection.id === selectedCollectionId);
  const sessions = selectedCollection
    ? selectedCollection.sessions
    : selectedProject?.collections.flatMap((collection) => collection.sessions) ?? [];
  const destinations = projectTree.projects.flatMap((project) => project.collections.map((collection) => ({
    collectionId: collection.id,
    label: `${project.name} / ${collection.name}`,
  })));

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sessions.filter((session) => {
      if (pinFilters.length > 0 && !pinFilters.includes(pinCountFilterValue(pinCount(session)))) return false;
      if (!query) return true;
      return session.page.title.toLowerCase().includes(query)
        || session.page.url.toLowerCase().includes(query)
        || session.pins.some((pin) => pin.comment.toLowerCase().includes(query)
          || (pin.selector || "").toLowerCase().includes(query));
    });
  }, [pinFilters, search, sessions]);

  useEffect(() => {
    const savedView = localStorage.getItem(HISTORY_VIEW_KEY);
    if (savedView === "grid" || savedView === "table") setView(savedView);
    void fetchTree();
  }, []);

  async function fetchTree(preferredProjectId = selectedProjectId) {
    setLoading(true);
    try {
      const response = await fetch("/api/project-tree", { cache: "no-store" });
      const data: unknown = await response.json();
      if (!response.ok || !isRecord(data) || !isRecord(data.tree) || !Array.isArray(data.tree.projects)) return;
      const projects = data.tree.projects.filter(isProjectTreeProject);
      setProjectTree({ projects });
      const nextProject = projects.find((project) => project.id === preferredProjectId) ?? projects[0];
      setSelectedProjectId(nextProject?.id ?? "");
      if (!nextProject?.collections.some((collection) => collection.id === selectedCollectionId)) {
        setSelectedCollectionId(null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function requestJson(path: string, method: string, body?: unknown) {
    return fetch(path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      method,
    });
  }

  async function createProject(name: string) {
    const response = await requestJson("/api/projects", "POST", { name });
    const data: unknown = await response.json();
    if (response.ok && isRecord(data) && isRecord(data.project) && typeof data.project.id === "string") {
      await fetchTree(data.project.id);
    }
  }

  async function createCollection(name: string, parentId?: string) {
    if (!selectedProject) return;
    const response = await requestJson(
      `/api/projects/${selectedProject.id}/collections`,
      "POST",
      { name, parentId },
    );
    const data: unknown = await response.json();
    if (response.ok && isRecord(data) && isRecord(data.collection) && typeof data.collection.id === "string") {
      await fetchTree(selectedProject.id);
      setSelectedCollectionId(data.collection.id);
    }
  }

  async function renameContainer(kind: ContainerKind, id: string, name: string) {
    await requestJson(`/api/${kind}s/${id}`, "PATCH", { name });
    await fetchTree(selectedProjectId);
  }

  async function deleteContainer(kind: ContainerKind, id: string) {
    const response = await requestJson(`/api/${kind}s/${id}`, "DELETE");
    if (response.ok) {
      setContainerDelete(null);
      await fetchTree();
    }
  }

  function openContainerEditor(editor: ContainerEditor, name = "") {
    setContainerName(name);
    setContainerEditor(editor);
  }

  async function submitContainerEditor() {
    const name = containerName.trim();
    if (!containerEditor || !name) return;
    if (containerEditor.mode === "create") {
      if (containerEditor.kind === "project") await createProject(name);
      else await createCollection(name, containerEditor.parentId);
    } else if (containerEditor.id) {
      await renameContainer(containerEditor.kind, containerEditor.id, name);
    }
    setContainerEditor(null);
  }

  async function reorderCollections(items: CollectionPlacement[]) {
    if (!selectedProject) return;
    const collectionsById = new Map(selectedProject.collections.map((collection) => [collection.id, collection]));
    const siblingPositions = new Map<string | null, number>();
    const collections = items.flatMap((item): ProjectTreeCollection[] => {
      const collection = collectionsById.get(item.id);
      if (!collection) return [];
      const position = siblingPositions.get(item.parentId) || 0;
      siblingPositions.set(item.parentId, position + 1);
      return [{ ...collection, parentId: item.parentId, position }];
    });
    setProjectTree((current) => ({
      projects: current.projects.map((project) => project.id === selectedProject.id
        ? { ...project, collections }
        : project),
    }));
    const response = await requestJson(
      `/api/projects/${selectedProject.id}/collections/reorder`,
      "POST",
      { items },
    );
    await fetchTree(selectedProject.id);
    if (!response.ok) return;
  }

  async function moveSession(sessionId: string, collectionId: string) {
    await requestJson(`/api/sessions/${sessionId}/move`, "POST", { collectionId });
    await fetchTree(selectedProjectId);
  }

  async function copyShare(path: string) {
    await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
  }

  async function copyPrompt(session: Session) {
    await navigator.clipboard.writeText(formatClipboardText(
      session.page,
      session.pins,
      session.shotUrl,
      session.viewerUrl || `/v/${session.id}.md`,
    ));
    setCopiedId(session.id);
    window.setTimeout(() => setCopiedId(null), 2_000);
  }

  async function deleteSession() {
    if (!deleteId) return;
    const response = await fetch(`/api/history/${deleteId}`, { method: "DELETE" });
    if (response.ok) await fetchTree(selectedProjectId);
    setDeleteId(null);
  }

  function selectView(values: string[]) {
    const nextView = values[0];
    if (nextView !== "grid" && nextView !== "table") return;
    setView(nextView);
    localStorage.setItem(HISTORY_VIEW_KEY, nextView);
  }

  const tableColumns = useMemo<ColumnDef<Session>[]>(() => [
    {
      accessorFn: (session) => session.page.title || t("dashboard.untitled"),
      cell: ({ row }) => (
        <div className="min-w-0">
          <Link className="block truncate font-medium hover:underline" params={{ id: row.original.id }} preload="intent" to="/v/$id">
            {row.original.page.title || t("dashboard.untitled")}
          </Link>
          <SessionPageLink url={row.original.page.url} />
        </div>
      ),
      enableHiding: false,
      header: t("dashboard.session"),
      id: "session",
      meta: { label: t("dashboard.session") },
      size: 340,
    },
    {
      accessorFn: (session) => new Date(session.createdAt).getTime(),
      cell: ({ row }) => <time className="text-muted-foreground" dateTime={row.original.createdAt}>{formatSessionDate(row.original, language)}</time>,
      header: t("dashboard.created"),
      id: "createdAt",
      meta: { label: t("dashboard.created") },
      size: 150,
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
      cell: ({ row }) => (
        <SessionActions
          copied={copiedId === row.original.id}
          destinations={destinations}
          session={row.original}
          onCopy={(session) => void copyPrompt(session)}
          onDelete={setDeleteId}
          onMove={(sessionId, collectionId) => void moveSession(sessionId, collectionId)}
          t={t}
        />
      ),
      enableHiding: false,
      enableSorting: false,
      header: t("dashboard.actions"),
      id: "actions",
      meta: { align: "right", label: t("dashboard.actions") },
      size: 64,
    },
  ], [copiedId, destinations, language, t]);

  const searchControl = (
    <div className="relative min-w-40 max-w-md flex-1">
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
  const viewControl = (
    <ToggleGroup aria-label={t("dashboard.historyView")} className="shrink-0 bg-background" size="default" spacing={0} value={[view]} variant="outline" onValueChange={selectView}>
      <ToggleGroupItem aria-label={t("dashboard.gridView")} title={t("dashboard.gridView")} value="grid"><GridIcon /></ToggleGroupItem>
      <ToggleGroupItem aria-label={t("dashboard.tableView")} title={t("dashboard.tableView")} value="table"><TableIcon /></ToggleGroupItem>
    </ToggleGroup>
  );

  return (
    <ServerShell activePage="dashboard" className="font-sans">
      <SidebarProvider className="min-h-0 flex-1">
        <HistorySidebar
          projectTree={projectTree}
          selectedCollectionId={selectedCollectionId}
          selectedProject={selectedProject}
          t={t}
          onCreate={(kind, parentId) => openContainerEditor({ kind, mode: "create", parentId })}
          onDelete={setContainerDelete}
          onRename={({ id, kind, name }) => openContainerEditor({ id, kind, mode: "rename" }, name)}
          onReorderCollections={(items) => void reorderCollections(items)}
          onSelectCollection={setSelectedCollectionId}
          onSelectProject={(projectId) => { setSelectedProjectId(projectId); setSelectedCollectionId(null); }}
          onShare={(path) => void copyShare(path)}
        />
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <ScrollArea className="min-h-0 min-w-0 flex-1">
            <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-4 p-5">
              {view !== "table" && (
                <div className="flex min-w-0 flex-row items-center gap-2 overflow-x-auto" role="toolbar">
                  <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2"><SidebarTrigger aria-label={t("dashboard.collections")} title={t("dashboard.collections")} />{searchControl}{pinFilterControl}</div>
                  <div className="ml-auto flex shrink-0 items-center justify-end gap-2">{viewControl}</div>
                </div>
              )}
              {loading ? <DashboardSkeleton /> : filteredSessions.length === 0 ? (
                <Card className="border-dashed py-16 text-center"><CardHeader><CardTitle>{t("dashboard.emptyTitle")}</CardTitle><CardDescription>{t("dashboard.emptyDescription")}</CardDescription></CardHeader></Card>
              ) : view === "table" ? (
                <DataTable
                  columns={tableColumns}
                  data={filteredSessions}
                  emptyMessage={t("dashboard.filteredEmpty")}
                  getRowId={(session) => session.id}
                  labels={{ clearFilter: t("dashboard.clearFilter"), columns: t("dashboard.columns"), resetFilters: t("dashboard.resetFilters") }}
                  toolbar={<><SidebarTrigger aria-label={t("dashboard.collections")} title={t("dashboard.collections")} />{searchControl}{pinFilterControl}</>}
                  toolbarActions={viewControl}
                  onRowClick={(session) => void navigate({ params: { id: session.id }, to: "/v/$id" })}
                />
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
                  {filteredSessions.map((session) => {
                    const count = pinCount(session);
                    return (
                      <Card className="gap-0 py-0 transition-colors hover:ring-primary/35" key={session.id} size="sm">
                        <SessionPreview session={session} t={t} />
                        <CardHeader className="py-3"><CardTitle className="line-clamp-1">{session.page.title || t("dashboard.untitled")}</CardTitle><CardDescription className="min-w-0"><SessionPageLink url={session.page.url} /></CardDescription></CardHeader>
                        <CardFooter className="mt-auto justify-between gap-2 py-2.5">
                          <div className="flex min-w-0 items-center gap-3 text-xs font-medium text-muted-foreground"><time className="inline-flex min-w-0 items-center gap-1.5" dateTime={session.createdAt}><CalendarIcon className="shrink-0 text-primary" /><span className="truncate">{formatSessionDate(session, language)}</span></time><span className="inline-flex shrink-0 items-center gap-1.5"><MessageCircleIcon className="text-primary" />{t("dashboard.pinCount", { count, label: t(count === 1 ? "dashboard.pinSingular" : "dashboard.pinPlural") })}</span></div>
                          <SessionActions copied={copiedId === session.id} destinations={destinations} session={session} onCopy={(current) => void copyPrompt(current)} onDelete={setDeleteId} onMove={(sessionId, collectionId) => void moveSession(sessionId, collectionId)} t={t} />
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
              )}
              <ServerFooter />
            </div>
          </ScrollArea>
        </SidebarInset>
      </SidebarProvider>
      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("dashboard.deleteTitle")}</AlertDialogTitle><AlertDialogDescription>{t("dashboard.deleteDescription")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void deleteSession()}>{t("dashboard.delete")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
      <Dialog open={Boolean(containerEditor)} onOpenChange={(open) => !open && setContainerEditor(null)}>
        <DialogContent>
          <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submitContainerEditor(); }}>
            <DialogHeader>
              <DialogTitle>
                {containerEditor?.mode === "create"
                  ? t(containerEditor.kind === "project"
                    ? "dashboard.newProject"
                    : containerEditor.parentId
                      ? "dashboard.newSubcollection"
                      : "dashboard.newCollection")
                  : t("dashboard.renamePrompt", { kind: t(containerEditor?.kind === "project" ? "dashboard.project" : "dashboard.collection") })}
              </DialogTitle>
            </DialogHeader>
            <Input autoFocus aria-label={t("dashboard.name")} placeholder={t("dashboard.name")} value={containerName} onChange={(event) => setContainerName(event.target.value)} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setContainerEditor(null)}>{t("common.cancel")}</Button>
              <Button disabled={!containerName.trim()} type="submit">{t(containerEditor?.mode === "create" ? "dashboard.create" : "dashboard.save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(containerDelete)} onOpenChange={(open) => !open && setContainerDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(containerDelete?.kind === "project" ? "dashboard.deleteProject" : "dashboard.deleteCollection")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dashboard.deleteContainerConfirm", { kind: t(containerDelete?.kind === "project" ? "dashboard.project" : "dashboard.collection") })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => containerDelete && void deleteContainer(containerDelete.kind, containerDelete.id)}>{t("dashboard.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ServerShell>
  );
}
