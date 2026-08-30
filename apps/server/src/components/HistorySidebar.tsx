import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type {
  CollectionPlacement,
  ProjectIcon,
  ProjectTree,
  ProjectTreeCollection,
  ProjectTreeProject,
} from "@pinar/shared";
import {
  DragOverlay,
  useDndContext,
  useDndMonitor,
  useDroppable,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  cn,
  useSidebar,
} from "@pinar/ui";
import {
  COLLECTION_INDENTATION_WIDTH,
  flattenCollections,
  getCollectionProjection,
  partitionCollectionNavigation,
  reorderCollectionTree,
  visibleCollections,
} from "@/lib/collection-tree";
import {
  COLLECTION_DND_TYPE,
  SESSION_DND_TYPE,
} from "@/lib/workspace-dnd";
import { ProjectIconGlyph } from "@/components/ProjectIcon";
import type { ServerMessageKey } from "@/lib/i18n";
import CheckIcon from "~icons/lucide/check";
import ArrowDownIcon from "~icons/lucide/arrow-down";
import ArrowUpIcon from "~icons/lucide/arrow-up";
import ChevronsUpDownIcon from "~icons/lucide/chevrons-up-down";
import FolderIcon from "~icons/lucide/folder";
import FolderOpenIcon from "~icons/lucide/folder-open";
import FolderPlusIcon from "~icons/lucide/folder-plus";
import InboxIcon from "~icons/lucide/inbox";
import LayoutGridIcon from "~icons/lucide/layout-grid";
import MoreHorizontalIcon from "~icons/lucide/more-horizontal";
import PencilIcon from "~icons/lucide/pencil";
import PlusIcon from "~icons/lucide/plus";
import ShareIcon from "~icons/lucide/share-2";
import TrashIcon from "~icons/lucide/trash-2";

type ContainerKind = "collection" | "project";
type Translate = (key: ServerMessageKey, values?: Record<string, number | string>) => string;

interface ContainerTarget {
  id: string;
  kind: ContainerKind;
}

interface RenameTarget extends ContainerTarget {
  icon?: ProjectIcon;
  name: string;
}

interface HistorySidebarProps {
  footer?: ReactNode;
  selectedCollectionId: string | null;
  selectedProject?: ProjectTreeProject;
  t: Translate;
  onCreate: (kind: ContainerKind, parentId?: string) => void;
  onDelete: (target: ContainerTarget) => void;
  onRename: (target: RenameTarget) => void;
  onReorderCollections: (items: CollectionPlacement[]) => void;
  onSelectCollection: (collectionId: string | null) => void;
  onShare: (path: string) => void;
}

interface ProjectSwitcherProps {
  compact: boolean;
  projectTree: ProjectTree;
  selectedProject?: ProjectTreeProject;
  t: Translate;
  onCreate: () => void;
  onSelectProject: (projectId: string) => void;
}

interface ProjectActionsMenuProps {
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  selectedProject?: ProjectTreeProject;
  t: Translate;
  onDelete: (target: ContainerTarget) => void;
  onRename: (target: RenameTarget) => void;
  onReorder: (direction: "earlier" | "later") => void;
  onShare: (path: string) => void;
}

interface SortableCollectionProps {
  collection: ProjectTreeCollection;
  depth: number;
  hasChildren: boolean;
  isActive: boolean;
  isExpanded: boolean;
  t: Translate;
  onCreateChild: (parentId: string) => void;
  onDelete: (target: ContainerTarget) => void;
  onRename: (target: RenameTarget) => void;
  onSelect: (collectionId: string) => void;
  onShare: (path: string) => void;
  onToggle: (collectionId: string) => void;
}

interface CollectionMenuProps {
  collection: ProjectTreeCollection;
  menuOpen: boolean;
  t: Translate;
  onActionFocusChange: (focused: boolean) => void;
  onCreate: () => void;
  onDelete: (target: ContainerTarget) => void;
  onMenuOpenChange: (open: boolean) => void;
  onRename: (target: RenameTarget) => void;
  onShare: (path: string) => void;
}

function CollectionMenu({
  collection,
  menuOpen,
  t,
  onActionFocusChange,
  onCreate,
  onDelete,
  onMenuOpenChange,
  onRename,
  onShare,
}: CollectionMenuProps) {
  return (
    <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
      <DropdownMenuTrigger
        render={
          <SidebarMenuAction
            aria-label={`${collection.name}: ${t("dashboard.collectionActions")}`}
            className="size-6 peer-data-[size=default]/menu-button:top-1"
            showOnHover
            title={t("dashboard.collectionActions")}
            onBlur={() => onActionFocusChange(false)}
            onFocus={() => onActionFocusChange(true)}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48" side="right" sideOffset={8}>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onCreate}>
            <FolderPlusIcon />
            {t("dashboard.newCollection")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRename({
            id: collection.id,
            kind: "collection",
            name: collection.name,
          })}>
            <PencilIcon />
            {t("dashboard.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onShare(`/c/${collection.id}`)}>
            <ShareIcon />
            {t("dashboard.share")}
          </DropdownMenuItem>
          {!collection.isProtected && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete({ id: collection.id, kind: "collection" })}
              >
                <TrashIcon />
                {t("dashboard.remove")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortableCollection({
  collection,
  depth,
  hasChildren,
  isActive,
  isExpanded,
  t,
  onCreateChild,
  onDelete,
  onRename,
  onSelect,
  onShare,
  onToggle,
}: SortableCollectionProps) {
  const { active } = useDndContext();
  const sortable = useSortable({
    data: { type: COLLECTION_DND_TYPE },
    id: collection.id,
  });
  const [menuActionFocused, setMenuActionFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sessionDropTarget = sortable.isOver && active?.data.current?.type === SESSION_DND_TYPE;
  const style: CSSProperties = {
    opacity: sortable.isDragging ? 0.35 : 1,
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const buttonStyle: CSSProperties = {
    paddingInlineStart: `${8 + (depth * COLLECTION_INDENTATION_WIDTH)}px`,
  };
  const toggleStyle: CSSProperties = {
    insetInlineStart: `${8 + (depth * COLLECTION_INDENTATION_WIDTH)}px`,
  };

  return (
    <SidebarMenuItem ref={sortable.setNodeRef} style={style}>
      <SidebarMenuButton
        {...sortable.attributes}
        {...sortable.listeners}
        ref={sortable.setActivatorNodeRef}
        className={cn(
          "touch-none",
          sortable.isDragging ? "cursor-grabbing" : "cursor-default",
          sessionDropTarget && "bg-sidebar-accent ring-1 ring-sidebar-ring",
        )}
        aria-expanded={hasChildren ? isExpanded : undefined}
        isActive={isActive}
        style={buttonStyle}
        tooltip={collection.name}
        onClick={() => onSelect(collection.id)}
      >
        <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
          {!hasChildren && <FolderIcon />}
        </span>
        <span>{collection.name}</span>
      </SidebarMenuButton>
      {hasChildren && (
        <button
          aria-expanded={isExpanded}
          aria-label={t(isExpanded ? "dashboard.collapseCollection" : "dashboard.expandCollection", {
            name: collection.name,
          })}
          className="absolute top-2 z-10 flex size-4 items-center justify-center rounded-sm text-sidebar-foreground outline-none after:absolute after:-inset-1 focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-3.5"
          data-collection-toggle
          style={toggleStyle}
          type="button"
          onClick={() => onToggle(collection.id)}
        >
          {isExpanded ? <FolderOpenIcon /> : <FolderIcon />}
        </button>
      )}
      <SidebarMenuBadge className={cn(
        "group-hover/menu-item:opacity-0",
        (menuOpen || menuActionFocused) && "opacity-0",
      )}>
        {collection.sessions.length}
      </SidebarMenuBadge>
      <CollectionMenu
        collection={collection}
        menuOpen={menuOpen}
        t={t}
        onActionFocusChange={setMenuActionFocused}
        onCreate={() => onCreateChild(collection.id)}
        onDelete={onDelete}
        onMenuOpenChange={setMenuOpen}
        onRename={onRename}
        onShare={onShare}
      />
    </SidebarMenuItem>
  );
}

interface FixedCollectionProps {
  collection: ProjectTreeCollection;
  isActive: boolean;
  t: Translate;
  onCreate: () => void;
  onDelete: (target: ContainerTarget) => void;
  onRename: (target: RenameTarget) => void;
  onSelect: (collectionId: string) => void;
  onShare: (path: string) => void;
}

function FixedCollection({
  collection,
  isActive,
  t,
  onCreate,
  onDelete,
  onRename,
  onSelect,
  onShare,
}: FixedCollectionProps) {
  const { active } = useDndContext();
  const droppable = useDroppable({
    data: { type: COLLECTION_DND_TYPE },
    id: collection.id,
  });
  const [menuActionFocused, setMenuActionFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sessionDropTarget = droppable.isOver && active?.data.current?.type === SESSION_DND_TYPE;
  return (
    <SidebarMenuItem ref={droppable.setNodeRef}>
      <SidebarMenuButton
        className={cn(sessionDropTarget && "bg-sidebar-accent ring-1 ring-sidebar-ring")}
        isActive={isActive}
        tooltip={collection.name}
        onClick={() => onSelect(collection.id)}
      >
        <InboxIcon />
        <span>{collection.name}</span>
      </SidebarMenuButton>
      <SidebarMenuBadge className={cn(
        "group-hover/menu-item:opacity-0",
        (menuOpen || menuActionFocused) && "opacity-0",
      )}>
        {collection.sessions.length}
      </SidebarMenuBadge>
      <CollectionMenu
        collection={collection}
        menuOpen={menuOpen}
        t={t}
        onActionFocusChange={setMenuActionFocused}
        onCreate={onCreate}
        onDelete={onDelete}
        onMenuOpenChange={setMenuOpen}
        onRename={onRename}
        onShare={onShare}
      />
    </SidebarMenuItem>
  );
}

export function ProjectSwitcher({
  compact,
  projectTree,
  selectedProject,
  t,
  onCreate,
  onSelectProject,
}: ProjectSwitcherProps) {
  const { isMobile } = useSidebar();
  const totalSessions = selectedProject?.collections.reduce(
    (total, collection) => total + collection.sessions.length,
    0,
  ) ?? 0;
  const sessionLabel = t(
    totalSessions === 1 ? "aggregate.sessionSingular" : "aggregate.sessionPlural",
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={selectedProject?.name ?? t("common.loading")}
            className={cn(
              "min-w-0",
              compact
                ? "size-8 justify-center p-0"
                : isMobile
                  ? "h-8 w-auto max-w-full justify-start px-1.5"
                  : "h-11 w-full justify-start px-1.5",
            )}
            disabled={!selectedProject}
            variant="ghost"
          />
        }
      >
        {compact ? (
          selectedProject ? <ProjectIconGlyph icon={selectedProject.icon} /> : null
        ) : (
          <>
            {selectedProject ? (
              <ProjectIconGlyph className="size-5 shrink-0" icon={selectedProject.icon} />
            ) : null}
            <span className={cn("min-w-0 text-left leading-tight", isMobile ? "truncate font-semibold" : "grid flex-1")}>
              {isMobile ? (
                selectedProject?.name ?? t("common.loading")
              ) : (
                <>
                  <span className="truncate font-semibold">
                    {selectedProject?.name ?? t("common.loading")}
                  </span>
                  <span className="truncate text-xs font-normal text-sidebar-foreground/60">
                    {t("aggregate.sessionCount", { count: totalSessions, label: sessionLabel })}
                  </span>
                </>
              )}
            </span>
            <ChevronsUpDownIcon className={isMobile ? "shrink-0" : "ml-auto"} />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={8}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="capitalize">
            {t("dashboard.project")}
          </DropdownMenuLabel>
          {projectTree.projects.map((project) => (
            <DropdownMenuItem key={project.id} onClick={() => onSelectProject(project.id)}>
              <ProjectIconGlyph icon={project.icon} />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {project.id === selectedProject?.id && <CheckIcon />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onCreate}>
            <PlusIcon />
            {t("dashboard.newProject")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectActionsMenu({
  canMoveEarlier,
  canMoveLater,
  selectedProject,
  t,
  onDelete,
  onRename,
  onReorder,
  onShare,
}: ProjectActionsMenuProps) {
  if (!selectedProject) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`${selectedProject.name}: ${t("dashboard.projectActions")}`}
            size="icon-sm"
            title={t("dashboard.projectActions")}
            variant="ghost"
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuItem className="gap-2.5" onClick={() => onRename({
            id: selectedProject.id,
            icon: selectedProject.icon,
            kind: "project",
            name: selectedProject.name,
          })}>
            <PencilIcon />
            {t("dashboard.editProject")}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5" onClick={() => onShare(`/p/${selectedProject.id}`)}>
            <ShareIcon />
            {t("dashboard.share")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {(canMoveEarlier || canMoveLater) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("dashboard.order")}</DropdownMenuLabel>
              {canMoveEarlier && (
                <DropdownMenuItem onClick={() => onReorder("earlier")}>
                  <ArrowUpIcon />
                  {t("dashboard.moveEarlier")}
                </DropdownMenuItem>
              )}
              {canMoveLater && (
                <DropdownMenuItem onClick={() => onReorder("later")}>
                  <ArrowDownIcon />
                  {t("dashboard.moveLater")}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </>
        )}
        {!selectedProject.isProtected && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="gap-2.5"
                variant="destructive"
                onClick={() => onDelete({ id: selectedProject.id, kind: "project" })}
              >
                <TrashIcon />
                {t("dashboard.deleteProject")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HistorySidebar({
  footer,
  selectedCollectionId,
  selectedProject,
  t,
  onCreate,
  onDelete,
  onRename,
  onReorderCollections,
  onSelectCollection,
  onShare,
}: HistorySidebarProps) {
  const { setOpenMobile } = useSidebar();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsedCollectionIds, setCollapsedCollectionIds] = useState<Set<string>>(() => new Set());
  const [offsetLeft, setOffsetLeft] = useState(0);
  const [overId, setOverId] = useState<string | null>(null);
  const collections = selectedProject?.collections ?? [];
  const { fixedCollections, sortableCollections } = useMemo(
    () => partitionCollectionNavigation(collections),
    [collections],
  );
  const flattened = useMemo(
    () => flattenCollections(sortableCollections),
    [sortableCollections],
  );
  const visibleFlattened = useMemo(
    () => visibleCollections(flattened, collapsedCollectionIds),
    [collapsedCollectionIds, flattened],
  );
  const collectionIdsWithChildren = useMemo(
    () => new Set(sortableCollections.flatMap((collection) => collection.parentId ? [collection.parentId] : [])),
    [sortableCollections],
  );
  const projection = activeId && overId
    ? getCollectionProjection(flattened, activeId, overId, offsetLeft)
    : null;
  const activeCollection = sortableCollections.find((collection) => collection.id === activeId);
  const totalSessions = collections.reduce(
    (total, collection) => total + collection.sessions.length,
    0,
  );

  function closeMobile() {
    setOpenMobile(false);
  }

  function create(kind: ContainerKind, parentId?: string) {
    closeMobile();
    onCreate(kind, parentId);
  }

  function rename(target: RenameTarget) {
    closeMobile();
    onRename(target);
  }

  function deleteContainer(target: ContainerTarget) {
    closeMobile();
    onDelete(target);
  }

  function selectCollection(collectionId: string | null) {
    onSelectCollection(collectionId);
    closeMobile();
  }

  function toggleCollection(collectionId: string) {
    setCollapsedCollectionIds((current) => {
      const next = new Set(current);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  }

  function resetDrag() {
    setActiveId(null);
    setOffsetLeft(0);
    setOverId(null);
  }

  function isCollectionTreeDrag(event: { active: { data: { current?: { type?: string } } } }) {
    return event.active.data.current?.type !== SESSION_DND_TYPE;
  }

  function handleDragStart(event: DragStartEvent) {
    if (!isCollectionTreeDrag(event)) return;
    const id = String(event.active.id);
    setActiveId(id);
    setOverId(id);
  }

  function handleDragMove(event: DragMoveEvent) {
    if (!isCollectionTreeDrag(event)) return;
    setOffsetLeft(event.delta.x);
  }

  function handleDragOver(event: DragOverEvent) {
    if (!isCollectionTreeDrag(event)) return;
    setOverId(event.over ? String(event.over.id) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    if (isCollectionTreeDrag(event) && event.over) {
      const items = reorderCollectionTree(
        flattened,
        String(event.active.id),
        String(event.over.id),
        event.delta.x,
      );
      if (items) {
        onReorderCollections([
          ...fixedCollections.map(({ id }) => ({ id, parentId: null })),
          ...items,
        ]);
      }
    }
    resetDrag();
  }

  useDndMonitor({
    onDragCancel: resetDrag,
    onDragEnd: handleDragEnd,
    onDragMove: handleDragMove,
    onDragOver: handleDragOver,
    onDragStart: handleDragStart,
  });

  return (
    <Sidebar
      className="top-14 h-[calc(100svh-3.5rem)] transition-none group-data-[side=left]:border-r-0"
      collapsible="icon"
    >
      <SidebarContent>
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={selectedCollectionId === null}
                  tooltip={t("dashboard.allSessions")}
                  onClick={() => selectCollection(null)}
                >
                  <LayoutGridIcon />
                  <span>{t("dashboard.allSessions")}</span>
                </SidebarMenuButton>
                <SidebarMenuBadge>{totalSessions}</SidebarMenuBadge>
              </SidebarMenuItem>
              {fixedCollections.map((collection) => (
                <FixedCollection
                  collection={collection}
                  isActive={selectedCollectionId === collection.id}
                  key={collection.id}
                  t={t}
                  onCreate={() => create("collection")}
                  onDelete={deleteContainer}
                  onRename={rename}
                  onSelect={selectCollection}
                  onShare={onShare}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="pt-4">
          <SidebarGroupLabel className="h-7 text-[11px] font-normal uppercase text-sidebar-foreground/60">
            {t("dashboard.collections")}
          </SidebarGroupLabel>
          <SidebarGroupAction
            aria-label={t("dashboard.newCollection")}
            className="top-5"
            title={t("dashboard.newCollection")}
            onClick={() => create("collection")}
          >
            <PlusIcon />
            <span className="sr-only">{t("dashboard.newCollection")}</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SortableContext
              items={visibleFlattened.map((item) => item.collection.id)}
              strategy={verticalListSortingStrategy}
            >
              <SidebarMenu>
                {visibleFlattened.map(({ collection, depth }) => (
                  <SortableCollection
                    collection={collection}
                    depth={collection.id === activeId && projection ? projection.depth : depth}
                    hasChildren={collectionIdsWithChildren.has(collection.id)}
                    isActive={selectedCollectionId === collection.id}
                    isExpanded={!collapsedCollectionIds.has(collection.id)}
                    key={collection.id}
                    t={t}
                    onCreateChild={(parentId) => create("collection", parentId)}
                    onDelete={deleteContainer}
                    onRename={rename}
                    onSelect={selectCollection}
                    onShare={onShare}
                    onToggle={toggleCollection}
                  />
                ))}
              </SidebarMenu>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeCollection ? (
                <div className="flex h-8 items-center gap-2 rounded-md bg-popover px-2 text-sm text-popover-foreground shadow-md ring-1 ring-border">
                  <FolderIcon />
                  <span className="truncate">{activeCollection.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {footer ? <SidebarFooter>{footer}</SidebarFooter> : null}
    </Sidebar>
  );
}
