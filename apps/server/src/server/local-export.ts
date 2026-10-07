import { realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  LOCAL_EXPORT_FORMAT,
  LOCAL_EXPORT_MANIFEST_PATH,
  LOCAL_EXPORT_SCHEMA_VERSION,
  type LocalExportManifest,
  type LocalExportSession,
  type Session,
  type StoredZipEntry,
  writeStoredZip,
} from "@pinar/shared";
import { safeShotName } from "@pinar/cli/shots";
import { canonicalShotPath, sessionShotIdentity } from "./local-session-files";

interface ExportProject {
  createdAt: string;
  icon: string;
  id: string;
  isProtected: boolean;
  name: string;
  position: number;
  updatedAt: string;
}

interface ExportCollection {
  createdAt: string;
  id: string;
  isProtected: boolean;
  name: string;
  parentId: string | null;
  position: number;
  projectId: string;
  sessions: Array<{ id: string }>;
  updatedAt: string;
}

type ExportSessionRecord = Session & { batchId?: string | null; shotPath?: string | null };

/** The slice of the local history database the export reads. */
export interface LocalExportSource {
  getProjectTree(): { projects: Array<ExportProject & { collections: ExportCollection[] }> };
  getSession(id: string): ExportSessionRecord | null;
  listBatches(): Array<{ finishedAt: string | null; id: string; label: string; startedAt: string }>;
}

export interface LocalExportOptions {
  now?: () => Date;
  root: string;
  shotsRoot: string;
  source: LocalExportSource;
  version: string;
}

// A file is exported only through its realpath: a regular file strictly
// inside the realpath of the given root, so a symlink that leaves the root is
// never followed and a missing path is skipped.
function containedRegularFile(path: string, root: string): string | null {
  let real: string;
  let realRoot: string;
  try {
    real = realpathSync(path);
    realRoot = realpathSync(root);
  } catch {
    return null;
  }
  if (real === realRoot || !real.startsWith(realRoot + sep)) return null;
  try {
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

// The stored shotPath is never read: it comes from a history database an older
// client, a hand-edited database, or a corrupted store may have pointed at any
// file. Only the canonical shot file for the session's own identity is
// exported, and the legacy PINAR_HOME/<identity>.png is kept under the same
// realpath containment check; a session without a safe file exports with
// shot: null.
function shotFile(session: ExportSessionRecord, root: string, shotsRoot: string) {
  if (session.includeScreenshot === false) return null;
  const identity = sessionShotIdentity(session);
  if (!identity || /[\u0000-\u001f\u007f]/.test(identity)) return null;
  const entry = `shots/${safeShotName(identity)}`;
  const candidates: Array<{ containedIn: string; path: string }> = [];
  const canonical = canonicalShotPath(identity, root);
  if (canonical) candidates.push({ containedIn: shotsRoot, path: canonical });
  const legacy = resolve(join(root, `${identity}.png`));
  if (legacy !== canonical) candidates.push({ containedIn: root, path: legacy });
  for (const candidate of candidates) {
    const path = containedRegularFile(candidate.path, candidate.containedIn);
    if (path) return { entry, path };
  }
  return null;
}

function captureFields(session: ExportSessionRecord): Record<string, unknown> {
  const capture: Record<string, unknown> = {};
  for (const key of ["captureId", "page", "pins", "privacy", "reproduction", "schemaVersion"] as const) {
    if (session[key] !== undefined && session[key] !== null) capture[key] = session[key];
  }
  return capture;
}

/**
 * Builds the manifest of a local export and the screenshot files it points
 * to. Sessions whose screenshot file is missing are exported without one.
 */
export function buildLocalExport({ now = () => new Date(), root, shotsRoot, source, version }: LocalExportOptions) {
  const tree = source.getProjectTree();
  const shots: Array<{ entry: string; path: string }> = [];
  const sessions: LocalExportSession[] = [];
  const collections: LocalExportManifest["collections"] = [];
  for (const project of tree.projects) {
    for (const collection of project.collections) {
      collections.push({
        createdAt: collection.createdAt,
        id: collection.id,
        isProtected: collection.isProtected,
        name: collection.name,
        parentId: collection.parentId,
        position: collection.position,
        projectId: project.id,
        updatedAt: collection.updatedAt,
      });
      for (const summary of collection.sessions) {
        const session = source.getSession(summary.id);
        if (!session) continue;
        const file = shotFile(session, root, shotsRoot);
        if (file && !shots.some((shot) => shot.entry === file.entry)) shots.push(file);
        sessions.push({
          batchId: session.batchId ?? null,
          capture: captureFields(session),
          collectionId: collection.id,
          createdAt: session.createdAt,
          id: session.id,
          includeScreenshot: session.includeScreenshot !== false,
          position: session.position ?? 0,
          // Several sessions may share one screenshot entry; the archive keeps
          // a single entry for it.
          shot: file ? file.entry : null,
        });
      }
    }
  }
  const manifest: LocalExportManifest = {
    batches: source.listBatches().map((batch) => ({ finishedAt: batch.finishedAt, id: batch.id, label: batch.label, startedAt: batch.startedAt })),
    collections,
    exportedAt: now().toISOString(),
    format: LOCAL_EXPORT_FORMAT,
    projects: tree.projects.map((project) => ({
      createdAt: project.createdAt,
      icon: project.icon,
      id: project.id,
      isProtected: project.isProtected,
      name: project.name,
      position: project.position,
      updatedAt: project.updatedAt,
    })),
    schemaVersion: LOCAL_EXPORT_SCHEMA_VERSION,
    sessions,
    source: { runtime: "local", version },
  };
  return { manifest, shots };
}

/** Streams the export as a stored ZIP, reading one screenshot at a time. */
export function streamLocalExport(options: LocalExportOptions): AsyncGenerator<Uint8Array> {
  const { manifest, shots } = buildLocalExport(options);
  async function* entries(): AsyncGenerator<StoredZipEntry> {
    yield { data: new TextEncoder().encode(JSON.stringify(manifest)), name: LOCAL_EXPORT_MANIFEST_PATH };
    for (const shot of shots) yield { data: new Uint8Array(await readFile(shot.path)), name: shot.entry };
  }
  return writeStoredZip(entries());
}

export function localExportFileName(now = new Date()) {
  return `pinar-export-${now.toISOString().slice(0, 10)}.zip`;
}
