import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import type {
  CollectionPlacement,
  ProjectIcon,
  ProjectTree,
  ProjectTreeCollection,
  ProjectTreeProject,
  Session,
} from "@pinar/shared";
import { DEFAULT_PROJECT_ICON } from "@pinar/shared/project-icons";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@pinar/ui";
import {
  HistorySidebar,
  ProjectActionsMenu,
  ProjectSwitcher,
} from "@/components/HistorySidebar";
import { ProjectIconPicker } from "@/components/ProjectIcon";
import { AppAccountMenu } from "@/components/AppAccountMenu";
import { AppShell } from "@/components/AppShell";
import { isProjectTreeProject, isRecord } from "@/lib/api-data";
import { collectionAncestorPath } from "@/lib/collection-tree";
import { useServerI18n } from "@/lib/i18n";
import { flattenCollectionSessions } from "@/lib/session-listing";
import { reorderIds, type OrderDirection } from "@/lib/session-order";
import {
  WORKSPACE_TREE_POLL_MS,
  isAbortError,
  projectTreeFingerprint,
  resolveSelectedCollectionId,
} from "@/lib/workspace-tree-sync";
import {
  collectionIdFromOver,
  isSessionDragData,
  workspaceCollisionDetection,
  WorkspacePointerSensor,
} from "@/lib/workspace-dnd";

export const SELECTED_PROJECT_KEY = "pinar-selected-project";
export const SELECTED_COLLECTION_KEY = "pinar-selected-collection";

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

interface BatchRecord {
  finishedAt: string | null;
  id: string;
  label: string;
  sessionCount: number;
  startedAt: string;
}

interface WorkspaceChromeContextValue {
  fetchTree: (preferredProjectId?: string, options?: { silent?: boolean }) => Promise<void>;
  loading: boolean;
  moveSessions: (sessionIds: string[], collectionId: string) => Promise<void>;
  projectTree: ProjectTree;
  selectedCollection: ProjectTreeCollection | undefined;
  selectedCollectionId: string | null;
  selectedProject: ProjectTreeProject | undefined;
  selectedProjectIndex: number;
  sessions: Session[];
  setProjectTree: Dispatch<SetStateAction<ProjectTree>>;
  setSelectedCollectionId: (id: string | null) => void;
  selectedBatchId: string | null;
}

const WorkspaceChromeContext = createContext<WorkspaceChromeContextValue | null>(null);

export function useWorkspaceChrome() {
  const value = useContext(WorkspaceChromeContext);
  if (!value) throw new Error("useWorkspaceChrome must be used within WorkspaceChrome");
  return value;
}

function workspaceCrumbsFor(
  collections: ProjectTreeCollection[],
  selectedCollection: ProjectTreeCollection | undefined,
  allSessionsLabel: string,
) {
  if (!selectedCollection) return [{ id: null, name: allSessionsLabel }];
  const path = collectionAncestorPath(collections, selectedCollection.id);
  if (path.length) return path.map((collection) => ({ id: collection.id, name: collection.name }));
  return [{ id: selectedCollection.id, name: selectedCollection.name }];
}

async function requestJson(path: string, method: string, body?: unknown) {
  return fetch(path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    method,
  });
}

function readStoredCollectionId() {
  try {
    return localStorage.getItem(SELECTED_COLLECTION_KEY);
  } catch {
    return null;
  }
}

function writeStoredCollectionId(id: string | null) {
  try {
    if (id) localStorage.setItem(SELECTED_COLLECTION_KEY, id);
    else localStorage.removeItem(SELECTED_COLLECTION_KEY);
  } catch {
    /* private mode */
  }
}

function isBatchRecord(value: unknown): value is BatchRecord {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.label === "string"
    && typeof value.startedAt === "string"
    && (value.finishedAt === null || typeof value.finishedAt === "string")
    && typeof value.sessionCount === "number";
}

function sessionBatchId(session: Session) {
  const value = (session as Session & { batchId?: unknown }).batchId;
  return typeof value === "string" ? value : null;
}

export function WorkspaceChrome({
  children,
  className,
  navigateOnCollectionSelect = false,
}: {
  children: ReactNode;
  className?: string;
  navigateOnCollectionSelect?: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useServerI18n();
  const [containerDelete, setContainerDelete] = useState<ContainerDelete | null>(null);
  const [containerEditor, setContainerEditor] = useState<ContainerEditor | null>(null);
  const [containerName, setContainerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [projectIcon, setProjectIcon] = useState<ProjectIcon>(DEFAULT_PROJECT_ICON);
  const [projectTree, setProjectTree] = useState<ProjectTree>({ projects: [] });
  const [activeSessionDrag, setActiveSessionDrag] = useState<{ count: number; title: string } | null>(null);
  const [selectedCollectionId, setSelectedCollectionIdState] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [filterDeleteId, setFilterDeleteId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchIdState] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const fingerprintRef = useRef("");
  const generationRef = useRef(0);
  const mutatingRef = useRef(0);
  const selectedCollectionIdRef = useRef(selectedCollectionId);
  const selectedProjectIdRef = useRef(selectedProjectId);
  selectedCollectionIdRef.current = selectedCollectionId;
  selectedProjectIdRef.current = selectedProjectId;

  const selectedProject = projectTree.projects.find((project) => project.id === selectedProjectId)
    ?? projectTree.projects[0];
  const selectedProjectIndex = projectTree.projects.findIndex(({ id }) => id === selectedProject?.id);
  const selectedCollection = selectedProject?.collections.find((collection) => collection.id === selectedCollectionId);
  const sessions = useMemo(() => {
    const listed = selectedCollection
      ? selectedCollection.sessions
      : flattenCollectionSessions(selectedProject?.collections);
    if (!selectedBatchId) return listed;
    return listed.filter((session) => sessionBatchId(session) === selectedBatchId);
  }, [selectedBatchId, selectedCollection, selectedProject]);

  const setSelectedCollectionId = useCallback((id: string | null) => {
    setSelectedCollectionIdState(id);
    setSelectedBatchIdState(null);
    writeStoredCollectionId(id);
    if (navigateOnCollectionSelect) void navigate({ search: { session: undefined }, to: "/app" });
  }, [navigate, navigateOnCollectionSelect]);

  const setSelectedBatchId = useCallback((id: string | null) => {
    setSelectedBatchIdState(id);
    if (id === null) return;
    setSelectedCollectionIdState(null);
    writeStoredCollectionId(null);
    if (navigateOnCollectionSelect) void navigate({ search: { session: undefined }, to: "/app" });
  }, [navigate, navigateOnCollectionSelect]);

  const applyProjects = useCallback((projects: ProjectTreeProject[], preferredProjectId: string) => {
    const fingerprint = projectTreeFingerprint(projects);
    if (fingerprint === fingerprintRef.current) return;
    fingerprintRef.current = fingerprint;
    setProjectTree({ projects });
    const nextProject = projects.find((project) => project.id === preferredProjectId) ?? projects[0];
    const nextProjectId = nextProject?.id ?? "";
    if (nextProjectId !== selectedProjectIdRef.current) {
      setSelectedProjectId(nextProjectId);
      if (nextProjectId) localStorage.setItem(SELECTED_PROJECT_KEY, nextProjectId);
      else localStorage.removeItem(SELECTED_PROJECT_KEY);
    } else if (nextProjectId) {
      localStorage.setItem(SELECTED_PROJECT_KEY, nextProjectId);
    }
    const collectionIds = new Set(nextProject?.collections.map((collection) => collection.id) ?? []);
    const nextCollectionId = resolveSelectedCollectionId(
      selectedCollectionIdRef.current,
      readStoredCollectionId(),
      collectionIds,
    );
    if (nextCollectionId !== selectedCollectionIdRef.current) {
      setSelectedCollectionIdState(nextCollectionId);
      writeStoredCollectionId(nextCollectionId);
    }
  }, []);

  const applyBatches = useCallback((next: BatchRecord[]) => {
    setBatches(next);
    setSelectedBatchIdState((current) => {
      if (!current || next.some((batch) => batch.id === current)) return current;
      return null;
    });
  }, []);

  const fetchTree = useCallback(async (
    preferredProjectId?: string,
    options?: { silent?: boolean },
  ) => {
    if (options?.silent && mutatingRef.current > 0) return;
    if (!options?.silent) {
      mutatingRef.current += 1;
      setLoading(true);
    }
    const generation = ++generationRef.current;
    try {
      const [response, batchesResponse] = await Promise.all([
        fetch("/api/project-tree", { cache: "no-store" }),
        fetch("/api/batches", { cache: "no-store" }).catch(() => null),
      ]);
      const data: unknown = await response.json();
      if (generation !== generationRef.current) return;
      if (!response.ok || !isRecord(data) || !isRecord(data.tree) || !Array.isArray(data.tree.projects)) return;
      applyProjects(
        data.tree.projects.filter(isProjectTreeProject),
        preferredProjectId || selectedProjectIdRef.current,
      );
      if (!batchesResponse?.ok) return;
      const batchesData: unknown = await batchesResponse.json();
      if (generation !== generationRef.current) return;
      if (isRecord(batchesData) && Array.isArray(batchesData.batches)) {
        applyBatches(batchesData.batches.filter(isBatchRecord));
      }
    } catch (error) {
      if (options?.silent || isAbortError(error)) return;
      throw error;
    } finally {
      if (!options?.silent) {
        mutatingRef.current = 0;
        if (generation === generationRef.current) setLoading(false);
      }
    }
  }, [applyBatches, applyProjects]);

  const setProjectTreeAndLock = useCallback((update: SetStateAction<ProjectTree>) => {
    mutatingRef.current += 1;
    generationRef.current += 1;
    fingerprintRef.current = "";
    setProjectTree(update);
  }, []);

  const moveSessions = useCallback(async (sessionIds: string[], collectionId: string) => {
    const ids = [...new Set(sessionIds)];
    if (!ids.length) return;
    const destination = projectTree.projects
      .flatMap((project) => project.collections)
      .find((collection) => collection.id === collectionId);
    if (!destination) return;
    const alreadyThere = new Set(
      destination.sessions.map((session) => session.id),
    );
    const toMove = ids.filter((id) => !alreadyThere.has(id));
    if (!toMove.length) return;
    await Promise.all(toMove.map((id) => requestJson(`/api/sessions/${id}/move`, "POST", { collectionId })));
    await fetchTree(selectedProject?.id, { silent: true });
  }, [fetchTree, projectTree.projects, selectedProject?.id]);

  const sensors = useSensors(
    useSensor(WorkspacePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleSessionDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    if (!isSessionDragData(data)) return;
    setActiveSessionDrag({
      count: data.sessionIds.length,
      title: typeof data.title === "string" ? data.title : t("dashboard.session"),
    });
  }

  function handleSessionDragEnd(event: DragEndEvent) {
    setActiveSessionDrag(null);
    if (!isSessionDragData(event.active.data.current) || !event.over) return;
    const collectionIds = new Set(selectedProject?.collections.map((collection) => collection.id) ?? []);
    const collectionId = collectionIdFromOver(event.over.id, collectionIds);
    if (!collectionId) return;
    void moveSessions(event.active.data.current.sessionIds, collectionId);
  }

  useEffect(() => {
    if (!activeSessionDrag) return;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = previousCursor;
    };
  }, [activeSessionDrag]);

  useEffect(() => {
    void fetchTree(localStorage.getItem(SELECTED_PROJECT_KEY) || "");
  }, [fetchTree]);

  useEffect(() => {
    let timer = 0;
    function poll() {
      void fetchTree(selectedProjectIdRef.current, { silent: true });
    }
    function arm() {
      window.clearInterval(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setInterval(poll, WORKSPACE_TREE_POLL_MS);
    }
    function onVisible() {
      arm();
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    arm();
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
    };
  }, [fetchTree]);

  async function createProject(name: string, icon: ProjectIcon) {
    const response = await requestJson("/api/projects", "POST", { icon, name });
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
      setSelectedCollectionIdState(data.collection.id);
      writeStoredCollectionId(data.collection.id);
      setSelectedBatchIdState(null);
    }
  }

  async function renameContainer(
    kind: ContainerKind,
    id: string,
    name: string,
    icon?: ProjectIcon,
  ) {
    await requestJson(`/api/${kind}s/${id}`, "PATCH", { icon, name });
    await fetchTree(selectedProjectId);
  }

  async function deleteContainer(kind: ContainerKind, id: string) {
    const response = await requestJson(`/api/${kind}s/${id}`, "DELETE");
    if (response.ok) {
      setContainerDelete(null);
      await fetchTree();
    }
  }

  async function deleteFilter(id: string) {
    const response = await requestJson(`/api/batches/${id}`, "DELETE");
    if (!response.ok && response.status !== 404) return;
    setFilterDeleteId(null);
    setSelectedBatchIdState((current) => (current === id ? null : current));
    setBatches((current) => current.filter((batch) => batch.id !== id));
    await fetchTree(selectedProjectId, { silent: true });
  }

  function openContainerEditor(
    editor: ContainerEditor,
    name = "",
    icon = DEFAULT_PROJECT_ICON,
  ) {
    setContainerName(name);
    setContainerEditor(editor);
    setProjectIcon(icon);
  }

  async function submitContainerEditor() {
    const name = containerName.trim();
    if (!containerEditor || !name) return;
    if (containerEditor.mode === "create") {
      if (containerEditor.kind === "project") await createProject(name, projectIcon);
      else await createCollection(name, containerEditor.parentId);
    } else if (containerEditor.id) {
      await renameContainer(
        containerEditor.kind,
        containerEditor.id,
        name,
        containerEditor.kind === "project" ? projectIcon : undefined,
      );
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
    setProjectTreeAndLock((current) => ({
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

  async function reorderProject(direction: OrderDirection) {
    if (!selectedProject) return;
    const ids = reorderIds(
      projectTree.projects.map(({ id }) => id),
      selectedProject.id,
      direction,
    );
    if (!ids) return;
    const byId = new Map(projectTree.projects.map((project) => [project.id, project]));
    setProjectTreeAndLock({
      projects: ids.flatMap((id, position) => {
        const project = byId.get(id);
        return project ? [{ ...project, position }] : [];
      }),
    });
    await requestJson("/api/projects/reorder", "POST", { ids });
    await fetchTree(selectedProject.id);
  }

  async function copyShare(path: string) {
    await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
  }

  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId);
  const workspaceCrumbs = selectedBatch
    ? [{ id: null, name: selectedBatch.label }]
    : workspaceCrumbsFor(
      selectedProject?.collections ?? [],
      selectedCollection,
      t("dashboard.allSessions"),
    );

  const contextValue = useMemo<WorkspaceChromeContextValue>(() => ({
    fetchTree,
    loading,
    moveSessions,
    projectTree,
    selectedBatchId,
    selectedCollection,
    selectedCollectionId,
    selectedProject,
    selectedProjectIndex,
    sessions,
    setProjectTree: setProjectTreeAndLock,
    setSelectedCollectionId,
  }), [
    fetchTree,
    loading,
    moveSessions,
    projectTree,
    selectedBatchId,
    selectedCollection,
    selectedCollectionId,
    selectedProject,
    selectedProjectIndex,
    sessions,
    setProjectTreeAndLock,
    setSelectedCollectionId,
  ]);

  return (
    <WorkspaceChromeContext.Provider value={contextValue}>
      <DndContext
        collisionDetection={workspaceCollisionDetection}
        sensors={sensors}
        onDragCancel={() => setActiveSessionDrag(null)}
        onDragEnd={handleSessionDragEnd}
        onDragStart={handleSessionDragStart}
      >
      <AppShell
        className={className ?? "font-sans"}
        projectActions={(
          <ProjectActionsMenu
            canMoveEarlier={selectedProjectIndex > 0}
            canMoveLater={selectedProjectIndex >= 0 && selectedProjectIndex < projectTree.projects.length - 1}
            selectedProject={selectedProject}
            t={t}
            onDelete={setContainerDelete}
            onRename={({ icon, id, kind, name }) => openContainerEditor(
              { id, kind, mode: "rename" },
              name,
              icon,
            )}
            onReorder={(direction) => void reorderProject(direction)}
            onShare={(path) => void copyShare(path)}
          />
        )}
        projectSelector={(compact) => (
          <ProjectSwitcher
            compact={compact}
            projectTree={projectTree}
            selectedProject={selectedProject}
            t={t}
            onCreate={() => openContainerEditor({ kind: "project", mode: "create" })}
            onSelectProject={(projectId) => {
              setSelectedProjectId(projectId);
              localStorage.setItem(SELECTED_PROJECT_KEY, projectId);
              setSelectedCollectionIdState(null);
              setSelectedBatchIdState(null);
              writeStoredCollectionId(null);
              if (navigateOnCollectionSelect) void navigate({ search: { session: undefined }, to: "/app" });
            }}
          />
        )}
        sidebar={(
          <HistorySidebar
            filters={batches.map((batch) => ({
              count: batch.sessionCount,
              id: batch.id,
              label: batch.label,
            }))}
            footer={<AppAccountMenu />}
            selectedCollectionId={selectedCollectionId}
            selectedFilterId={selectedBatchId}
            selectedProject={selectedProject}
            t={t}
            onCreate={(kind, parentId) => openContainerEditor({ kind, mode: "create", parentId })}
            onDelete={setContainerDelete}
            onDeleteFilter={setFilterDeleteId}
            onRename={({ id, kind, name }) => openContainerEditor({ id, kind, mode: "rename" }, name)}
            onReorderCollections={(items) => void reorderCollections(items)}
            onSelectCollection={setSelectedCollectionId}
            onSelectFilter={setSelectedBatchId}
            onShare={(path) => void copyShare(path)}
          />
        )}
        workspaceCrumbs={workspaceCrumbs}
        onSelectWorkspace={setSelectedCollectionId}
      >
        {children}
        <Dialog open={Boolean(containerEditor)} onOpenChange={(open) => !open && setContainerEditor(null)}>
          <DialogContent className={containerEditor?.kind === "project" ? "sm:max-w-lg" : undefined}>
            <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submitContainerEditor(); }}>
              <DialogHeader>
                <DialogTitle>
                  {containerEditor?.mode === "create"
                    ? t(containerEditor.kind === "project"
                      ? "dashboard.newProject"
                      : containerEditor.parentId
                        ? "dashboard.newSubcollection"
                        : "dashboard.newCollection")
                    : containerEditor?.kind === "project"
                      ? t("dashboard.editProject")
                      : t("dashboard.renamePrompt", { kind: t("dashboard.collection") })}
                </DialogTitle>
              </DialogHeader>
              <Input autoFocus aria-label={t("dashboard.name")} placeholder={t("dashboard.name")} value={containerName} onChange={(event) => setContainerName(event.target.value)} />
              {containerEditor?.kind === "project" ? (
                <ProjectIconPicker
                  emptyMessage={t("dashboard.noProjectIcons")}
                  label={t("dashboard.projectIcon")}
                  searchPlaceholder={t("dashboard.searchProjectIcons")}
                  value={projectIcon}
                  onValueChange={setProjectIcon}
                />
              ) : null}
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
        <AlertDialog open={Boolean(filterDeleteId)} onOpenChange={(open) => !open && setFilterDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("dashboard.deleteFilterTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("dashboard.deleteFilterConfirm")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => filterDeleteId && void deleteFilter(filterDeleteId)}>{t("dashboard.deleteFilter")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppShell>
      <DragOverlay dropAnimation={null} zIndex={100}>
        {activeSessionDrag ? (
          <div className="flex w-72 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-2xl" data-session-drag-overlay>
            <span className="size-2 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{activeSessionDrag.title}</p>
              {activeSessionDrag.count > 1 ? (
                <p className="text-xs text-muted-foreground">
                  {t("dashboard.selectedCount", { count: activeSessionDrag.count })}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>
    </WorkspaceChromeContext.Provider>
  );
}
