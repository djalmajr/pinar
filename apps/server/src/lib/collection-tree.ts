import type { CollectionPlacement, ProjectTreeCollection } from "@pinar/shared";
import { arrayMove } from "@dnd-kit/sortable";

export const COLLECTION_INDENTATION_WIDTH = 18;

export interface FlattenedCollection {
  collection: ProjectTreeCollection;
  depth: number;
}

export interface CollectionProjection {
  depth: number;
  parentId: string | null;
}

export interface CollectionNavigation {
  fixedCollections: ProjectTreeCollection[];
  sortableCollections: ProjectTreeCollection[];
}

export function partitionCollectionNavigation(
  collections: ProjectTreeCollection[],
): CollectionNavigation {
  const protectedIds = new Set(
    collections.filter((collection) => collection.isProtected).map((collection) => collection.id),
  );
  return {
    fixedCollections: collections.filter((collection) => collection.isProtected),
    sortableCollections: collections
      .filter((collection) => !collection.isProtected)
      .map((collection) => protectedIds.has(collection.parentId || "")
        ? { ...collection, parentId: null }
        : collection),
  };
}

export function flattenCollections(collections: ProjectTreeCollection[]) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const children = new Map<string | null, ProjectTreeCollection[]>();
  for (const collection of collections) {
    const parentId = collection.parentId && byId.has(collection.parentId)
      ? collection.parentId
      : null;
    const siblings = children.get(parentId) || [];
    siblings.push(collection);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.position - right.position);
  }
  const result: FlattenedCollection[] = [];
  const visited = new Set<string>();
  function visit(parentId: string | null, depth: number) {
    for (const collection of children.get(parentId) || []) {
      if (visited.has(collection.id)) continue;
      visited.add(collection.id);
      result.push({ collection, depth });
      visit(collection.id, depth + 1);
    }
  }
  visit(null, 0);
  for (const collection of collections) {
    if (!visited.has(collection.id)) result.push({ collection, depth: 0 });
  }
  return result;
}

export function visibleCollections(
  items: FlattenedCollection[],
  collapsedIds: ReadonlySet<string>,
) {
  const hiddenIds = new Set<string>();
  return items.filter(({ collection }) => {
    const parentId = collection.parentId;
    const hidden = Boolean(parentId && (collapsedIds.has(parentId) || hiddenIds.has(parentId)));
    if (hidden) hiddenIds.add(collection.id);
    return !hidden;
  });
}

function descendantIds(items: FlattenedCollection[], activeIndex: number) {
  const ids = new Set<string>();
  const activeDepth = items[activeIndex]?.depth ?? 0;
  for (let index = activeIndex + 1; index < items.length; index += 1) {
    if (items[index].depth <= activeDepth) break;
    ids.add(items[index].collection.id);
  }
  return ids;
}

export function getCollectionProjection(
  items: FlattenedCollection[],
  activeId: string,
  overId: string,
  offsetLeft: number,
): CollectionProjection | null {
  const activeIndex = items.findIndex((item) => item.collection.id === activeId);
  if (activeIndex < 0) return null;
  const descendants = descendantIds(items, activeIndex);
  if (descendants.has(overId)) return null;
  const sortableItems = items.filter((item) => !descendants.has(item.collection.id));
  const sortableActiveIndex = sortableItems.findIndex((item) => item.collection.id === activeId);
  const overIndex = sortableItems.findIndex((item) => item.collection.id === overId);
  if (sortableActiveIndex < 0 || overIndex < 0) return null;
  const reordered = arrayMove(sortableItems, sortableActiveIndex, overIndex);
  const newIndex = reordered.findIndex((item) => item.collection.id === activeId);
  const previous = reordered[newIndex - 1];
  const next = reordered[newIndex + 1];
  const active = reordered[newIndex];
  const projectedDepth = active.depth
    + Math.round(offsetLeft / COLLECTION_INDENTATION_WIDTH);
  const maxDepth = previous ? previous.depth + 1 : 0;
  const minDepth = next ? next.depth : 0;
  const depth = active.collection.isProtected
    ? 0
    : Math.max(minDepth, Math.min(projectedDepth, maxDepth));

  if (depth === 0 || !previous) return { depth: 0, parentId: null };
  if (previous.depth === depth) {
    return { depth, parentId: previous.collection.parentId };
  }
  if (previous.depth === depth - 1) {
    return { depth, parentId: previous.collection.id };
  }
  for (let index = newIndex - 1; index >= 0; index -= 1) {
    if (reordered[index].depth === depth - 1) {
      return { depth, parentId: reordered[index].collection.id };
    }
  }
  return { depth: 0, parentId: null };
}

export function reorderCollectionTree(
  items: FlattenedCollection[],
  activeId: string,
  overId: string,
  offsetLeft: number,
): CollectionPlacement[] | null {
  const projection = getCollectionProjection(items, activeId, overId, offsetLeft);
  const activeIndex = items.findIndex((item) => item.collection.id === activeId);
  if (!projection || activeIndex < 0) return null;
  const descendants = descendantIds(items, activeIndex);
  const subtree = items.filter((item) => descendants.has(item.collection.id));
  const sortableItems = items.filter((item) => !descendants.has(item.collection.id));
  const sortableActiveIndex = sortableItems.findIndex((item) => item.collection.id === activeId);
  const overIndex = sortableItems.findIndex((item) => item.collection.id === overId);
  if (sortableActiveIndex < 0 || overIndex < 0) return null;
  const reordered = arrayMove(sortableItems, sortableActiveIndex, overIndex);
  const newIndex = reordered.findIndex((item) => item.collection.id === activeId);
  const active = reordered[newIndex];
  const depthDelta = projection.depth - active.depth;
  reordered[newIndex] = {
    collection: { ...active.collection, parentId: projection.parentId },
    depth: projection.depth,
  };
  reordered.splice(newIndex + 1, 0, ...subtree.map((item) => ({
    ...item,
    depth: item.depth + depthDelta,
  })));
  return reordered.map(({ collection }) => ({
    id: collection.id,
    parentId: collection.parentId,
  }));
}
