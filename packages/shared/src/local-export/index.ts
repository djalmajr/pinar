/**
 * Pinar local export, format v1: a stored ZIP with `manifest.json` plus the
 * `shots/<shotId>.png` entries its sessions reference; several sessions may
 * share one screenshot entry and the archive keeps a single entry for it.
 * Ids are the local ones; the cloud import keeps them so a repeated import
 * updates instead of duplicating. Sessions carry the same capture fields the
 * cloud already accepts on `POST /api/history`, so the importer reuses that
 * validation.
 */

export const LOCAL_EXPORT_FORMAT = "pinar-local-export";
export const LOCAL_EXPORT_SCHEMA_VERSION = 1;
export const LOCAL_EXPORT_MANIFEST_PATH = "manifest.json";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SHOT_PATH_PATTERN = /^shots\/[A-Za-z0-9_-]{1,64}\.png$/;

export interface LocalExportProject {
  createdAt: string;
  icon: string;
  id: string;
  isProtected: boolean;
  name: string;
  position: number;
  updatedAt: string;
}

export interface LocalExportCollection {
  createdAt: string;
  id: string;
  isProtected: boolean;
  name: string;
  parentId: string | null;
  position: number;
  projectId: string;
  updatedAt: string;
}

export interface LocalExportBatch {
  finishedAt: string | null;
  id: string;
  label: string;
  startedAt: string;
}

export interface LocalExportSession {
  batchId: string | null;
  /** Capture fields as the cloud `POST /api/history` body expects them. */
  capture: Record<string, unknown>;
  collectionId: string;
  createdAt: string;
  id: string;
  includeScreenshot: boolean;
  position: number;
  /** `shots/<shotId>.png` inside the archive, or null without a screenshot. */
  shot: string | null;
}

export interface LocalExportManifest {
  batches: LocalExportBatch[];
  collections: LocalExportCollection[];
  exportedAt: string;
  format: typeof LOCAL_EXPORT_FORMAT;
  projects: LocalExportProject[];
  schemaVersion: typeof LOCAL_EXPORT_SCHEMA_VERSION;
  sessions: LocalExportSession[];
  source: { runtime: "local"; version: string };
}

export class LocalExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalExportError";
  }
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LocalExportError(`${where} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string, max = 2_000): string {
  if (typeof value !== "string" || value.length > max) throw new LocalExportError(`${where} must be a string`);
  return value;
}

function id(value: unknown, where: string): string {
  const parsed = text(value, where, 64);
  if (!ID_PATTERN.test(parsed)) throw new LocalExportError(`${where} is not a valid id`);
  return parsed;
}

function optionalId(value: unknown, where: string): string | null {
  return value === null || value === undefined || value === "" ? null : id(value, where);
}

function integer(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new LocalExportError(`${where} must be a non-negative integer`);
  return value;
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new LocalExportError(`${where} must be an array`);
  return value;
}

function unique<T extends { id: string }>(items: T[], where: string) {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new LocalExportError(`${where} has a duplicate id: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

/** Validates a parsed `manifest.json`, including every cross-reference. */
export function parseLocalExportManifest(input: unknown): LocalExportManifest {
  const root = record(input, "manifest");
  if (root.format !== LOCAL_EXPORT_FORMAT) throw new LocalExportError("not a Pinar local export");
  if (root.schemaVersion !== LOCAL_EXPORT_SCHEMA_VERSION) throw new LocalExportError(`unsupported export version: ${String(root.schemaVersion)}`);
  const source = record(root.source, "source");
  const projects = list(root.projects, "projects").map((value, index): LocalExportProject => {
    const item = record(value, `projects[${index}]`);
    return {
      createdAt: text(item.createdAt, `projects[${index}].createdAt`, 64),
      icon: text(item.icon, `projects[${index}].icon`, 64),
      id: id(item.id, `projects[${index}].id`),
      isProtected: item.isProtected === true,
      name: text(item.name, `projects[${index}].name`, 200),
      position: integer(item.position, `projects[${index}].position`),
      updatedAt: text(item.updatedAt, `projects[${index}].updatedAt`, 64),
    };
  });
  const projectIds = unique(projects, "projects");
  const collections = list(root.collections, "collections").map((value, index): LocalExportCollection => {
    const item = record(value, `collections[${index}]`);
    const projectId = id(item.projectId, `collections[${index}].projectId`);
    if (!projectIds.has(projectId)) throw new LocalExportError(`collections[${index}] points to a missing project`);
    return {
      createdAt: text(item.createdAt, `collections[${index}].createdAt`, 64),
      id: id(item.id, `collections[${index}].id`),
      isProtected: item.isProtected === true,
      name: text(item.name, `collections[${index}].name`, 200),
      parentId: optionalId(item.parentId, `collections[${index}].parentId`),
      position: integer(item.position, `collections[${index}].position`),
      projectId,
      updatedAt: text(item.updatedAt, `collections[${index}].updatedAt`, 64),
    };
  });
  const collectionIds = unique(collections, "collections");
  const batches = list(root.batches, "batches").map((value, index): LocalExportBatch => {
    const item = record(value, `batches[${index}]`);
    return {
      finishedAt: item.finishedAt === null || item.finishedAt === undefined ? null : text(item.finishedAt, `batches[${index}].finishedAt`, 64),
      id: id(item.id, `batches[${index}].id`),
      label: text(item.label, `batches[${index}].label`, 200),
      startedAt: text(item.startedAt, `batches[${index}].startedAt`, 64),
    };
  });
  const batchIds = unique(batches, "batches");
  const sessions = list(root.sessions, "sessions").map((value, index): LocalExportSession => {
    const item = record(value, `sessions[${index}]`);
    const collectionId = id(item.collectionId, `sessions[${index}].collectionId`);
    if (!collectionIds.has(collectionId)) throw new LocalExportError(`sessions[${index}] points to a missing collection`);
    const batchId = optionalId(item.batchId, `sessions[${index}].batchId`);
    if (batchId && !batchIds.has(batchId)) throw new LocalExportError(`sessions[${index}] points to a missing batch`);
    const shot = item.shot === null || item.shot === undefined ? null : text(item.shot, `sessions[${index}].shot`, 80);
    // Several sessions may reference the same screenshot entry: the exporter
    // deduplicates the archive, so only the entry shape is validated here.
    if (shot !== null && !SHOT_PATH_PATTERN.test(shot)) throw new LocalExportError(`sessions[${index}].shot is not a valid path`);
    return {
      batchId,
      capture: record(item.capture, `sessions[${index}].capture`),
      collectionId,
      createdAt: text(item.createdAt, `sessions[${index}].createdAt`, 64),
      id: id(item.id, `sessions[${index}].id`),
      includeScreenshot: item.includeScreenshot !== false,
      position: integer(item.position, `sessions[${index}].position`),
      shot,
    };
  });
  unique(sessions, "sessions");
  return {
    batches,
    collections,
    exportedAt: text(root.exportedAt, "exportedAt", 64),
    format: LOCAL_EXPORT_FORMAT,
    projects,
    schemaVersion: LOCAL_EXPORT_SCHEMA_VERSION,
    sessions,
    source: { runtime: "local", version: text(source.version, "source.version", 64) },
  };
}

/** Parents before children, so an importer can create collections in order. */
export function collectionsInCreationOrder(collections: LocalExportCollection[]): LocalExportCollection[] {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const ordered: LocalExportCollection[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  function place(collection: LocalExportCollection) {
    if (placed.has(collection.id)) return;
    const parent = collection.parentId ? byId.get(collection.parentId) : undefined;
    // A missing parent or a parent cycle is imported at the root.
    if (parent && parent.projectId === collection.projectId && !visiting.has(parent.id)) {
      visiting.add(collection.id);
      place(parent);
      visiting.delete(collection.id);
    }
    placed.add(collection.id);
    ordered.push(collection);
  }
  for (const collection of collections) place(collection);
  return ordered;
}
