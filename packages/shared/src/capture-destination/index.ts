import type { CaptureDestination, ProjectTree, ProjectTreeCollection, ProjectTreeProject } from "../types/index.js";

export interface CaptureDestinationOption<Icon> {
  children?: CaptureDestinationOption<Icon>[];
  disabled?: boolean;
  icon?: Icon;
  label: string;
  selectable?: boolean;
  value: string;
}

export interface CaptureDestinationOptionsInput<Icon> {
  collectionIcon: (collection: ProjectTreeCollection) => Icon;
  collectionLabel: (collection: ProjectTreeCollection) => string;
  projectIcon?: (project: ProjectTreeProject) => Icon;
  tree: ProjectTree;
}

interface DestinationGroups {
  children: Map<string | null, ProjectTreeCollection[]>;
  visited: Set<string>;
}

/**
 * Groups a project's collections under their parent when it exists. A
 * collection whose parent is missing is kept at the root, and a cycle of
 * parents is reported through `visited` so it is also kept at the root.
 */
function groupCollections(collections: ProjectTreeCollection[]): DestinationGroups {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const children = new Map<string | null, ProjectTreeCollection[]>();
  for (const collection of collections) {
    const parentId = collection.parentId && byId.has(collection.parentId) ? collection.parentId : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(collection);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.position - right.position);
  const visited = new Set<string>();
  function visit(parentId: string | null) {
    for (const collection of children.get(parentId) ?? []) {
      if (visited.has(collection.id)) continue;
      visited.add(collection.id);
      visit(collection.id);
    }
  }
  visit(null);
  return { children, visited };
}

function collectionOption<Icon>(collection: ProjectTreeCollection, groups: DestinationGroups, input: CaptureDestinationOptionsInput<Icon>, hoisted = false): CaptureDestinationOption<Icon> {
  const option: CaptureDestinationOption<Icon> = {
    icon: input.collectionIcon(collection),
    label: input.collectionLabel(collection),
    selectable: true,
    value: collection.id,
  };
  // A hoisted collection sits in a parent cycle, so its children would
  // repeat the cycle and are kept flat at the root instead.
  const children = hoisted ? undefined : groups.children.get(collection.id);
  if (children?.length) option.children = children.map((child) => collectionOption(child, groups, input));
  return option;
}

/**
 * Options for the capture destination cascader: one node per project, in
 * `position` order, with the project's root collections as children, each
 * nested by `position`. Collections whose parent is missing or that sit in a
 * parent cycle are kept at the root. `collectionIcon`/`collectionLabel` are
 * only called for collections.
 */
export function captureDestinationOptions<Icon>(input: CaptureDestinationOptionsInput<Icon>): CaptureDestinationOption<Icon>[] {
  const projects = [...input.tree.projects].sort((left, right) => left.position - right.position);
  return projects.map((project) => {
    const groups = groupCollections(project.collections);
    const children: CaptureDestinationOption<Icon>[] = (groups.children.get(null) ?? []).map((collection) => collectionOption(collection, groups, input));
    for (const collection of project.collections) if (!groups.visited.has(collection.id)) children.push(collectionOption(collection, groups, input, true));
    return {
      children,
      disabled: project.collections.length === 0,
      ...(input.projectIcon ? { icon: input.projectIcon(project) } : {}),
      label: project.name,
      selectable: false,
      value: project.id,
    };
  });
}

/**
 * Cascader path for a saved destination: the project id, then the ancestors
 * of its collection from the root down, then the collection id. Returns null
 * when the destination is null or its project or collection is missing from
 * the tree. Orphan and cyclic collections stay at the top, matching
 * `captureDestinationOptions`.
 */
export function captureDestinationPath(tree: ProjectTree, destination: CaptureDestination | null): string[] | null {
  if (!destination) return null;
  const project = tree.projects.find((item) => item.id === destination.projectId);
  if (!project) return null;
  const collection = project.collections.find((item) => item.id === destination.collectionId);
  if (!collection) return null;
  if (!groupCollections(project.collections).visited.has(collection.id)) return [project.id, collection.id];
  const byId = new Map(project.collections.map((item) => [item.id, item]));
  const path = [collection.id];
  let current = collection;
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    path.push(parent.id);
    current = parent;
  }
  path.reverse();
  return [project.id, ...path];
}
