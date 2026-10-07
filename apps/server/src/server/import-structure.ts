import {
  collectionsInCreationOrder,
  type LocalExportCollection,
  type LocalExportProject,
} from "@pinar/shared";

export const MAX_IMPORTED_PROJECTS = 1_000;
export const MAX_IMPORTED_COLLECTIONS = 10_000;
export const MAX_IMPORTED_SESSIONS = 100_000;

export interface ImportedProjectRecord {
  createdAt: string;
  icon: string;
  id: string;
  name: string;
  position: number;
  updatedAt: string;
}

export interface ImportedCollectionRecord {
  createdAt: string;
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  projectId: string;
  updatedAt: string;
}

/**
 * Storage operations the structure import needs, scoped to one owner. Each
 * upsert answers whether the row is now this owner's own unprotected record;
 * a row held by another account or a protected row is never overwritten.
 */
export interface ImportStructureStore {
  protectedDestination(): Promise<{ collectionId: string; projectId: string }>;
  upsertCollection(collection: ImportedCollectionRecord): Promise<boolean>;
  upsertProject(project: ImportedProjectRecord): Promise<boolean>;
}

export interface ImportStructureInput {
  batchIds: string[];
  collections: LocalExportCollection[];
  projects: LocalExportProject[];
  sessionIds: string[];
}

export interface ImportStructureResult {
  /** Local batch id → cloud batch id. */
  batchIds: Record<string, string>;
  /** Local collection id → cloud collection id. */
  collectionIds: Record<string, string>;
  /** Local project id → cloud project id. */
  projectIds: Record<string, string>;
  /** Local session id → cloud session id. */
  sessionIds: Record<string, string>;
}

export class ImportStructureError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ImportStructureError";
  }
}

type ImportedKind = "batch" | "collection" | "project" | "session";

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The cloud id of an imported record: a hash of the owner, the kind and the
 * local id. The same export always lands on the same ids for one account, so
 * a repeated import updates in place, and an export can never name a record
 * that already exists in the cloud — including another account's or the
 * owner's protected project and inbox.
 */
export async function importedId(ownerId: string, kind: ImportedKind, localId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pinar-import\0${ownerId}\0${kind}\0${localId}`));
  return base64Url(new Uint8Array(digest)).slice(0, 22);
}

async function idMap(ownerId: string, kind: ImportedKind, localIds: string[]) {
  const map: Record<string, string> = {};
  for (const localId of localIds) map[localId] = await importedId(ownerId, kind, localId);
  return map;
}

/**
 * Creates or updates the projects and collections of a local export for one
 * owner and answers the cloud ids of every imported record. The local
 * protected project and inbox map onto the owner's own.
 */
export async function importStructure(
  store: ImportStructureStore,
  ownerId: string,
  input: ImportStructureInput,
): Promise<ImportStructureResult> {
  if (input.projects.length > MAX_IMPORTED_PROJECTS) throw new ImportStructureError("too many projects");
  if (input.collections.length > MAX_IMPORTED_COLLECTIONS) throw new ImportStructureError("too many collections");
  if (input.sessionIds.length > MAX_IMPORTED_SESSIONS) throw new ImportStructureError("too many sessions");
  const destination = await store.protectedDestination();
  const projectIds: Record<string, string> = {};
  const collectionIds: Record<string, string> = {};
  const localProjectOf = new Map(input.collections.map((collection) => [collection.id, collection.projectId]));
  for (const project of input.projects) {
    if (project.isProtected) {
      projectIds[project.id] = destination.projectId;
      continue;
    }
    const id = await importedId(ownerId, "project", project.id);
    const owned = await store.upsertProject({ createdAt: project.createdAt, icon: project.icon, id, name: project.name, position: project.position, updatedAt: project.updatedAt });
    if (!owned) throw new ImportStructureError("an imported project id is unavailable", 409);
    projectIds[project.id] = id;
  }
  for (const collection of collectionsInCreationOrder(input.collections)) {
    const projectId = projectIds[collection.projectId];
    if (!projectId) throw new ImportStructureError(`collection ${collection.id} points to a missing project`);
    if (collection.isProtected && projectId === destination.projectId) {
      collectionIds[collection.id] = destination.collectionId;
      continue;
    }
    // A parent from another project, missing, or in a cycle is imported at the root.
    const parentId = collection.parentId && localProjectOf.get(collection.parentId) === collection.projectId
      ? collectionIds[collection.parentId] ?? null
      : null;
    const id = await importedId(ownerId, "collection", collection.id);
    const owned = await store.upsertCollection({
      createdAt: collection.createdAt,
      id,
      name: collection.name,
      parentId,
      position: collection.position,
      projectId,
      updatedAt: collection.updatedAt,
    });
    if (!owned) throw new ImportStructureError("an imported collection id is unavailable", 409);
    collectionIds[collection.id] = id;
  }
  return {
    batchIds: await idMap(ownerId, "batch", input.batchIds),
    collectionIds,
    projectIds,
    sessionIds: await idMap(ownerId, "session", input.sessionIds),
  };
}
