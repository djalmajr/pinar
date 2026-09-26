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
import IconLoaderCircle from "~icons/lucide/loader-circle";
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
import { CollectionCollaboratorsDialog } from "@/components/CollectionCollaboratorsDialog";
import { CollectionInvitationsDialog } from "@/components/CollectionInvitationsDialog";
import { isProjectTreeCollection, isProjectTreeProject, isRecord } from "@/lib/api-data";
import { useAuthSession } from "@/lib/auth-session";
import {
  acceptCollectionInvitation,
  canManageCollectionCollaborators,
  fetchCollectionInvitations,
  fetchSharedCollections,
  type CollectionInvitationRecord,
  type SharedCollectionRecord,
} from "@/lib/collection-collaborators";
import { collectionAncestorPath } from "@/lib/collection-tree";
import { useServerI18n } from "@/lib/i18n";
import { flattenCollectionSessions } from "@/lib/session-listing";
import { sessionGroupCount } from "@/lib/session-groups";
import { pinarRuntime } from "@/lib/server-header";
import { reorderIds, type OrderDirection } from "@/lib/session-order";
import {
  applyRememberedShareTokens,
  beginWorkspaceTreeRefresh,
  finishWorkspaceTreeRefresh,
  WORKSPACE_TREE_POLL_MS,
  type WorkspaceShareTokenCache,
  isAbortError,
  projectTreeFingerprint,
  resolveSelectedCollectionId,
  type WorkspaceTreeRefresh,
  type WorkspaceTreeRefreshFlight,
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
  fetchTree: (preferredProjectId?: string, options?: { metadata?: boolean; silent?: boolean }) => Promise<void>;
  loading: boolean;
  moveSessions: (sessionIds: string[], collectionId: string) => Promise<void>;
  onOpenInvitations: () => void;
  pendingInvitations: CollectionInvitationRecord[];
  projectTree: ProjectTree;
  selectedCollection: ProjectTreeCollection | undefined;
  selectedCollectionId: string | null;
  selectedProject: ProjectTreeProject | undefined;
  selectedProjectIndex: number;
  sharedOnly: boolean;
  sessions: Session[];
  setProjectTree: Dispatch<SetStateAction<ProjectTree>>;
  setSelectedCollectionId: (id: string | null) => void;
  selectedBatchId: string | null;
  setSelectedBatchId: (id: string | null) => void;
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
  const [containerSubmitting, setContainerSubmitting] = useState(false);
  const [containerError, setContainerError] = useState(false);
  const [containerName, setContainerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [projectIcon, setProjectIcon] = useState<ProjectIcon>(DEFAULT_PROJECT_ICON);
  const [projectTree, setProjectTree] = useState<ProjectTree>({ projects: [] });
  const [activeSessionDrag, setActiveSessionDrag] = useState<{ count: number; title: string } | null>(null);
  const [selectedCollectionId, setSelectedCollectionIdState] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [filterDeleteAllOpen, setFilterDeleteAllOpen] = useState(false);
  const [filterDeleteId, setFilterDeleteId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchIdState] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [sharedOnly, setSharedOnly] = useState(false);
  const fingerprintRef = useRef("");
  const generationRef = useRef(0);
  const shareTokensRef = useRef<WorkspaceShareTokenCache>({ ready: false, tokens: [] });
  const mutatingRef = useRef(0);
  const selectedCollectionIdRef = useRef(selectedCollectionId);
  const selectedProjectIdRef = useRef(selectedProjectId);
  selectedCollectionIdRef.current = selectedCollectionId;
  selectedProjectIdRef.current = selectedProjectId;

  const session = useAuthSession();
  const canManageCollaborators = canManageCollectionCollaborators(session, pinarRuntime());
  const [collaboratorCollection, setCollaboratorCollection] = useState<ProjectTreeCollection | null>(null);
  const [sharedCollections, setSharedCollections] = useState<SharedCollectionRecord[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<CollectionInvitationRecord[]>([]);
  const [invitationsOpen, setInvitationsOpen] = useState(false);

  const fetchCollaborationData = useCallback(async () => {
    if (pinarRuntime() !== "cloud" || !session || session.kind !== "account") return;
    try {
      const [invitationsResult, sharedResult] = await Promise.all([
        fetchCollectionInvitations().catch(() => []),
        fetchSharedCollections().catch(() => []),
      ]);
      setPendingInvitations(invitationsResult);
      setSharedCollections(sharedResult);
    } catch {
      // non-blocking
    }
  }, [session]);

  useEffect(() => {
    void fetchCollaborationData();
  }, [fetchCollaborationData]);

  const handleAcceptInvitation = useCallback(async (invitationId: string) => {
    const result = await acceptCollectionInvitation(invitationId);
    await fetchCollaborationData();
    return result.collectionId;
  }, [fetchCollaborationData]);

  const selectedProject = projectTree.projects.find((project) => project.id === selectedProjectId)
    ?? projectTree.projects[0];
  const selectedProjectIndex = projectTree.projects.findIndex(({ id }) => id === selectedProject?.id);
  const selectedCollection = selectedProject?.collections.find((collection) => collection.id === selectedCollectionId);
  const workspaceView = JSON.stringify([selectedProject?.id ?? "", selectedCollectionId, selectedBatchId, sharedOnly]);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-pinar-workspace-view", workspaceView);
    return () => {
      if (root.getAttribute("data-pinar-workspace-view") === workspaceView) root.removeAttribute("data-pinar-workspace-view");
    };
  }, [workspaceView]);
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
    setSharedOnly(false);
    writeStoredCollectionId(id);
    if (navigateOnCollectionSelect) void navigate({ search: { session: undefined }, to: "/app" });
  }, [navigate, navigateOnCollectionSelect]);

  const setSelectedBatchId = useCallback((id: string | null) => {
    setSelectedBatchIdState(id);
    if (id === null) return;
    setSelectedCollectionIdState(null);
    setSharedOnly(false);
    writeStoredCollectionId(null);
    if (navigateOnCollectionSelect) void navigate({ search: { session: undefined }, to: "/app" });
  }, [navigate, navigateOnCollectionSelect]);

  const selectSharedSessions = useCallback(() => {
    setSharedOnly(true);
    setSelectedCollectionIdState(null);
    setSelectedBatchIdState(null);
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
    options?: { metadata?: boolean; silent?: boolean },
  ) => {
    if (options?.silent && mutatingRef.current > 0) return;
    if (!options?.silent) {
      mutatingRef.current += 1;
      setLoading(true);
    }
    const includeMetadata = options?.metadata !== false;
    const generation = ++generationRef.current;
    try {
      const [response, batchesResponse, sharesResponse] = await Promise.all([
        fetch("/api/project-tree", { cache: "no-store" }),
        includeMetadata
          ? fetch("/api/batches", { cache: "no-store" }).catch(() => null)
          : Promise.resolve(null),
        includeMetadata && pinarRuntime() === "cloud"
          ? fetch("/api/shares", { cache: "no-store" }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const data: unknown = await response.json();
      if (generation !== generationRef.current) return;
      if (!response.ok || !isRecord(data) || !isRecord(data.tree) || !Array.isArray(data.tree.projects)) return;
      let projects = data.tree.projects.filter(isProjectTreeProject);
      let nextTokens: unknown[] | null = null;
      if (sharesResponse?.ok) {
        const sharesData: unknown = await sharesResponse.json();
        if (generation !== generationRef.current) return;
        if (isRecord(sharesData) && Array.isArray(sharesData.tokens)) nextTokens = sharesData.tokens;
      }
      const shared = applyRememberedShareTokens(projects, shareTokensRef.current, nextTokens);
      if (generation !== generationRef.current) return;
      shareTokensRef.current = shared.cache;
      applyProjects(
        shared.projects,
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
    let flight: WorkspaceTreeRefreshFlight = { active: null, queued: null };
    async function execute(refresh: WorkspaceTreeRefresh) {
      try {
        await Promise.all([
          fetchTree(selectedProjectIdRef.current, {
            metadata: refresh !== "poll",
            silent: true,
          }),
          fetchCollaborationData(),
        ]);
      } finally {
        const finished = finishWorkspaceTreeRefresh(flight);
        flight = finished.flight;
        if (finished.next) void execute(finished.next);
      }
    }
    function requestRefresh(refresh: WorkspaceTreeRefresh) {
      const decision = beginWorkspaceTreeRefresh(flight, refresh);
      flight = decision.flight;
      if (decision.started) void execute(refresh);
    }
    function arm() {
      window.clearInterval(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setInterval(() => requestRefresh("poll"), WORKSPACE_TREE_POLL_MS);
    }
    function onVisible() {
      arm();
      if (document.visibilityState === "visible") requestRefresh("focus");
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    arm();
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
    };
  }, [fetchCollaborationData, fetchTree]);

  async function createProject(name: string, icon: ProjectIcon) {
    const response = await requestJson("/api/projects", "POST", { icon, name });
    const data: unknown = await response.json();
    if (!response.ok || !isRecord(data) || !isRecord(data.project) || typeof data.project.id !== "string") throw new Error("project_create_failed");
    await fetchTree(data.project.id);
  }

  async function createCollection(name: string, parentId?: string) {
    if (!selectedProject) return;
    const response = await requestJson(
      `/api/projects/${selectedProject.id}/collections`,
      "POST",
      { name, parentId },
    );
    const data: unknown = await response.json();
    if (!response.ok || !isRecord(data) || !isRecord(data.collection) || typeof data.collection.id !== "string") throw new Error("collection_create_failed");
    const created: unknown = { ...data.collection, sessions: [] };
    if (!isProjectTreeCollection(created)) throw new Error("collection_create_failed");
    generationRef.current += 1;
    setLoading(false);
    fingerprintRef.current = "";
    setProjectTree((current) => ({
      projects: current.projects.map((project) => project.id === selectedProject.id
        ? { ...project, collections: [...project.collections, created] }
        : project),
    }));
    selectedCollectionIdRef.current = created.id;
    setSelectedCollectionIdState(created.id);
    writeStoredCollectionId(created.id);
    setSelectedBatchIdState(null);
    void fetchTree(selectedProject.id, { silent: true }).catch(() => null);
  }

  async function renameContainer(
    kind: ContainerKind,
    id: string,
    name: string,
    icon?: ProjectIcon,
  ) {
    const response = await requestJson(`/api/${kind}s/${id}`, "PATCH", { icon, name });
    if (!response.ok) throw new Error("container_rename_failed");
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

  async function deleteAllFilters() {
    const ids = batches.map((batch) => batch.id);
    for (const id of ids) {
      const response = await requestJson(`/api/batches/${id}`, "DELETE");
      if (!response.ok && response.status !== 404) return;
    }
    setFilterDeleteAllOpen(false);
    setSelectedBatchIdState(null);
    setBatches([]);
    await fetchTree(selectedProjectId, { silent: true });
  }

  function openContainerEditor(
    editor: ContainerEditor,
    name = "",
    icon = DEFAULT_PROJECT_ICON,
  ) {
    setContainerError(false);
    setContainerName(name);
    setContainerEditor(editor);
    setProjectIcon(icon);
  }

  async function submitContainerEditor() {
    const name = containerName.trim();
    if (!containerEditor || !name || containerSubmitting) return;
    setContainerSubmitting(true);
    setContainerError(false);
    try {
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
    } catch {
      setContainerError(true);
    } finally {
      setContainerSubmitting(false);
    }
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
  const workspaceCrumbs = sharedOnly
    ? [{ id: null, name: t("dashboard.shared") }]
    : selectedBatch
      ? [{ id: null, name: selectedBatch.label }]
      : workspaceCrumbsFor(
        selectedProject?.collections ?? [],
        selectedCollection,
        t("dashboard.allSessions"),
      );

  const openInvitations = useCallback(() => {
    setInvitationsOpen(true);
  }, []);

  const contextValue = useMemo<WorkspaceChromeContextValue>(() => ({
    fetchTree,
    loading,
    moveSessions,
    onOpenInvitations: openInvitations,
    pendingInvitations,
    projectTree,
    selectedBatchId,
    setSelectedBatchId,
    selectedCollection,
    selectedCollectionId,
    selectedProject,
    selectedProjectIndex,
    sharedOnly,
    sessions,
    setProjectTree: setProjectTreeAndLock,
    setSelectedCollectionId,
  }), [
    fetchTree,
    loading,
    moveSessions,
    openInvitations,
    pendingInvitations,
    projectTree,
    selectedBatchId,
    setSelectedBatchId,
    selectedCollection,
    selectedCollectionId,
    selectedProject,
    selectedProjectIndex,
    sharedOnly,
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
              setSharedOnly(false);
              writeStoredCollectionId(null);
              if (navigateOnCollectionSelect) void navigate({ search: { session: undefined }, to: "/app" });
            }}
          />
        )}
        sidebar={(
          <HistorySidebar
            canManageCollaborators={canManageCollaborators}
            filters={batches.map((batch) => ({
              count: batch.sessionCount,
              id: batch.id,
              label: batch.label,
            }))}
            footer={<AppAccountMenu />}
            onManageCollaborators={setCollaboratorCollection}
            onOpenInvitations={openInvitations}
            pendingInvitations={pendingInvitations}
            selectedCollectionId={selectedCollectionId}
            selectedFilterId={selectedBatchId}
            selectedProject={selectedProject}
            sharedCollections={sharedCollections}
            sharedCount={sessionGroupCount(
              flattenCollectionSessions(selectedProject?.collections).filter((session) => session.isShared),
            )}
            sharedOnly={sharedOnly}
            t={t}
            onCreate={(kind, parentId) => openContainerEditor({ kind, mode: "create", parentId })}
            onDelete={setContainerDelete}
            onDeleteAllFilters={() => {
              if (batches.length) setFilterDeleteAllOpen(true);
            }}
            onDeleteFilter={setFilterDeleteId}
            onRename={({ id, kind, name }) => openContainerEditor({ id, kind, mode: "rename" }, name)}
            onReorderCollections={(items) => void reorderCollections(items)}
            onSelectCollection={setSelectedCollectionId}
            onSelectFilter={setSelectedBatchId}
            onSelectShared={selectSharedSessions}
            onShare={(path) => void copyShare(path)}
          />
        )}
        workspaceCrumbs={workspaceCrumbs}
        onSelectWorkspace={setSelectedCollectionId}
      >
        {children}
        <Dialog open={Boolean(containerEditor)} onOpenChange={(open) => !open && !containerSubmitting && setContainerEditor(null)}>
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
              <Input autoFocus aria-label={t("dashboard.name")} disabled={containerSubmitting} placeholder={t("dashboard.name")} value={containerName} onChange={(event) => setContainerName(event.target.value)} />
              {containerEditor?.kind === "project" ? (
                <ProjectIconPicker
                  emptyMessage={t("dashboard.noProjectIcons")}
                  label={t("dashboard.projectIcon")}
                  searchPlaceholder={t("dashboard.searchProjectIcons")}
                  value={projectIcon}
                  onValueChange={setProjectIcon}
                />
              ) : null}
              {containerError ? <p className="text-sm text-destructive" role="alert">{t("dashboard.containerSaveFailed")}</p> : null}
              <DialogFooter>
                <Button disabled={containerSubmitting} type="button" variant="outline" onClick={() => setContainerEditor(null)}>{t("common.cancel")}</Button>
                <Button aria-busy={containerSubmitting || undefined} disabled={containerSubmitting || !containerName.trim()} type="submit">
                  {containerSubmitting ? <IconLoaderCircle aria-hidden="true" className="size-4 animate-spin" data-icon="inline-start" /> : null}
                  {t(containerSubmitting
                    ? containerEditor?.mode === "create" ? "dashboard.creatingContainer" : "dashboard.savingContainer"
                    : containerEditor?.mode === "create" ? "dashboard.create" : "dashboard.save")}
                </Button>
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
        <AlertDialog open={filterDeleteAllOpen} onOpenChange={(open) => !open && setFilterDeleteAllOpen(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("dashboard.deleteAllFiltersTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("dashboard.deleteAllFiltersConfirm")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void deleteAllFilters()}>{t("dashboard.deleteAllFilters")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <CollectionCollaboratorsDialog
          collection={collaboratorCollection}
          open={Boolean(collaboratorCollection)}
          onOpenChange={(open) => !open && setCollaboratorCollection(null)}
        />
        <CollectionInvitationsDialog
          invitations={pendingInvitations}
          open={invitationsOpen}
          onAccept={handleAcceptInvitation}
          onOpenChange={setInvitationsOpen}
        />
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
