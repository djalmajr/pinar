/**
 * Browser-side importer for the local Pinar export (format v1). It reads the
 * stored ZIP through @pinar/shared, sends the structure to the cloud, then
 * uploads the sessions one request at a time (shots go to /api/shots as a PNG
 * data URL, the rest to /api/history) and finally finishes the batches that
 * were already finished in the local app.
 *
 * Fatal answers (auth, trial, quota) stop the whole import with
 * LocalImportStoppedError; a single failed session is collected in `failed`
 * and the import continues.
 */
import {
  LOCAL_EXPORT_MANIFEST_PATH,
  parseLocalExportManifest,
  readZipDirectory,
  readZipEntry,
  type LocalExportManifest,
} from "@pinar/shared";
import { isRecord } from "@/lib/api-data";

export interface LocalImportProgress {
  done: number;
  failed: number;
  total: number;
}

export interface LocalImportResult {
  failed: Array<{ error: string; id: string }>;
  imported: number;
}

/**
 * Stops the import: an invalid archive or manifest (`invalidFile`), a fatal
 * server answer or an aborted signal. The UI shows `settings.importInvalid`
 * when `invalidFile` and `settings.importStopped` with the message otherwise.
 */
export class LocalImportStoppedError extends Error {
  readonly invalidFile: boolean;

  constructor(message: string, invalidFile = false) {
    super(message);
    this.name = "LocalImportStoppedError";
    this.invalidFile = invalidFile;
  }
}

// Auth, trial and quota answers end the import: retrying every session would
// only burn the same refusals. The codes are the ones the cloud API answers
// with on the write routes (see cloud-api.ts).
const FATAL_STATUSES = new Set([401, 402, 403, 413, 428]);
const TRIAL_OR_QUOTA_CODES = new Set(["cloud_subscription_required", "storage_quota_exceeded"]);

// btoa on 32 KiB chunks: String.fromCharCode spreads one chunk at a time, so
// multi-megabyte screenshots never overflow the call stack.
const BASE64_CHUNK = 32_768;

function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK)));
  }
  return btoa(parts.join(""));
}

function errorMessage(body: Record<string, unknown> | null, status: number): string {
  if (body && typeof body.error === "string" && body.error) return body.error;
  return `import failed (HTTP ${status})`;
}

function isFatal(status: number, body: Record<string, unknown> | null): boolean {
  if (FATAL_STATUSES.has(status)) return true;
  return body !== null && TRIAL_OR_QUOTA_CODES.has(typeof body.code === "string" ? body.code : "");
}

interface StructureIds {
  batchIds: Record<string, string>;
  collectionIds: Record<string, string>;
  sessionIds: Record<string, string>;
}

function stringMap(value: unknown, keys: string[]): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const map: Record<string, string> = {};
  for (const key of keys) {
    const id = value[key];
    if (typeof id !== "string" || !id) return null;
    map[key] = id;
  }
  return map;
}

// The cloud answers the id of every imported record; an answer that misses
// one would upload a session to an unknown place, so it stops the import.
function structureIds(body: Record<string, unknown> | null, manifest: LocalExportManifest): StructureIds | null {
  if (!body) return null;
  const batchIds = stringMap(body.batchIds, manifest.batches.map((batch) => batch.id));
  const collectionIds = stringMap(body.collectionIds, manifest.collections.map((collection) => collection.id));
  const sessionIds = stringMap(body.sessionIds, manifest.sessions.map((session) => session.id));
  return batchIds && collectionIds && sessionIds ? { batchIds, collectionIds, sessionIds } : null;
}

async function postJson(
  fetcher: typeof fetch,
  path: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<{ body: Record<string, unknown> | null; status: number }> {
  const response = await fetcher(path, {
    body: JSON.stringify(payload),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    ...(signal ? { signal } : {}),
  });
  const value: unknown = await response.json().catch(() => null);
  return { body: isRecord(value) ? value : null, status: response.status };
}

export async function importLocalExport(
  archive: Blob,
  options: { fetch?: typeof fetch; onProgress?: (progress: LocalImportProgress) => void; signal?: AbortSignal } = {},
): Promise<LocalImportResult> {
  const fetcher = options.fetch ?? fetch;
  const abortError = () => new LocalImportStoppedError("import aborted");
  if (options.signal?.aborted) throw abortError();

  // The manifest is validated before any network call, so a wrong file never
  // touches the cloud.
  let directory;
  let manifest: LocalExportManifest;
  try {
    directory = await readZipDirectory(archive);
    const manifestEntry = directory.find((entry) => entry.name === LOCAL_EXPORT_MANIFEST_PATH);
    if (!manifestEntry) throw new Error("missing manifest.json");
    manifest = parseLocalExportManifest(JSON.parse(new TextDecoder().decode(await readZipEntry(archive, manifestEntry))));
  } catch {
    throw new LocalImportStoppedError("invalid Pinar export", true);
  }

  // The structure call creates projects and collections; the answer maps every
  // local id to its cloud id for the session uploads.
  const structure = await postJson(
    fetcher,
    "/api/import/structure",
    { ...manifest, sessionIds: manifest.sessions.map((session) => session.id), sessions: [] },
    options.signal,
  );
  const ids = structure.status < 400 ? structureIds(structure.body, manifest) : null;
  if (!ids) throw new LocalImportStoppedError(errorMessage(structure.body, structure.status));

  const batches = new Map(manifest.batches.map((batch) => [batch.id, batch]));
  // Ascending position, stable: equal positions keep the manifest order.
  const ordered = [...manifest.sessions].sort((left, right) => left.position - right.position);
  const total = ordered.length;
  let done = 0;
  let imported = 0;
  const failed: Array<{ error: string; id: string }> = [];

  // One session per request, in order: the cloud answers stay sequential and
  // a fatal refusal stops the loop before the next upload.
  for (const session of ordered) {
    if (options.signal?.aborted) throw abortError();
    const payload: Record<string, unknown> = {
      ...session.capture,
      captureId: typeof session.capture.captureId === "string" && session.capture.captureId
        ? session.capture.captureId
        : session.id,
      collectionId: ids.collectionIds[session.collectionId],
      createdAt: session.createdAt,
      id: ids.sessionIds[session.id],
      includeScreenshot: session.includeScreenshot,
    };
    const batch = session.batchId ? batches.get(session.batchId) : undefined;
    if (batch) payload.batch = { id: ids.batchIds[batch.id], label: batch.label, startedAt: batch.startedAt };
    let path = "/api/history";
    if (session.shot) {
      const shotEntry = directory.find((entry) => entry.name === session.shot);
      if (!shotEntry) throw new LocalImportStoppedError("invalid Pinar export", true);
      try {
        payload.image = `data:image/png;base64,${base64(await readZipEntry(archive, shotEntry))}`;
      } catch {
        throw new LocalImportStoppedError("invalid Pinar export", true);
      }
      path = "/api/shots";
    }
    const { body, status } = await postJson(fetcher, path, payload, options.signal);
    done += 1;
    if (isFatal(status, body)) throw new LocalImportStoppedError(errorMessage(body, status));
    if (status < 400) imported += 1;
    else failed.push({ error: errorMessage(body, status), id: session.id });
    options.onProgress?.({ done, failed: failed.length, total });
  }

  // Batches already finished in the local app keep their finishedAt; failing
  // here must not undo the imported sessions.
  for (const batch of manifest.batches) {
    if (!batch.finishedAt) continue;
    if (options.signal?.aborted) throw abortError();
    try {
      await postJson(fetcher, `/api/batches/${encodeURIComponent(ids.batchIds[batch.id])}/finish`, { finishedAt: batch.finishedAt }, options.signal);
    } catch {
      // The import already succeeded; a failed finish is reported nowhere.
    }
  }

  return { failed, imported };
}
