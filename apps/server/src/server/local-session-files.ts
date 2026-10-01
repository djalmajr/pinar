import { existsSync, realpathSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pinarHome, shotsDir } from "@pinar/cli/paths";
import { safeShotName } from "@pinar/cli/shots";

// Session screenshot cleanup is confined to the local Pinar shots root and to
// the file the session's own shot identity owns. `shotPath` values come from
// stored session records, which an older client, a hand-edited database, or a
// corrupted store can point at any file: treat them as untrusted input. Root
// containment alone cannot prove a file belongs to the requested session, so
// the path must also match the location the local shot writer produces for
// this session's identity. Files outside the shots root, symlink escapes out
// of it, directories, and screenshots still referenced by another session
// are never removed.
export function localShotsRoot(): string {
  return resolve(shotsDir(pinarHome()));
}

export interface SessionShotRecord {
  id: string;
  shotId?: string | null;
  shotPath?: string | null;
}

export interface SessionShotStore {
  listSessions(options: { batchId?: string; collectionId?: string; limit: number; offset: number; query: string }): readonly SessionShotRecord[];
}

// The shot identity the presentation layer and the /shots/<id> serving route
// use: the stored shotId, falling back to the session id when absent.
export function sessionShotIdentity(session: SessionShotRecord): string {
  const shotId = typeof session.shotId === "string" ? session.shotId.trim() : "";
  return shotId || session.id;
}

// The one location the local shot writer produces for a shot identity:
// writeShot stores `<PINAR_HOME>/shots/<safeShotName(id)>.png`.
export function canonicalShotPath(identity: string, root = pinarHome()): string | null {
  const id = identity.trim();
  if (!id || /[\u0000-\u001f\u007f]/.test(id)) return null;
  try {
    return resolve(join(shotsDir(root), safeShotName(id)));
  } catch {
    return null;
  }
}

function isRegularFileAt(real: string): boolean {
  try {
    return statSync(real).isFile();
  } catch {
    return false;
  }
}

// Ingest validation: a client-supplied shotPath must be exactly the canonical
// shot file for the session's identity, staying inside the shots root.
export function isUsableSessionShotPath(shotPath: string, identity: string, root = pinarHome()): boolean {
  const trimmed = shotPath.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  const canonical = canonicalShotPath(identity, root);
  if (!canonical) return false;
  let lexical: string;
  try {
    lexical = resolve(trimmed);
  } catch {
    return false;
  }
  if (lexical !== canonical) return false;
  if (!existsSync(lexical)) return true;
  let real: string;
  let realCanonical: string;
  try {
    real = realpathSync(lexical);
    realCanonical = realpathSync(canonical);
  } catch {
    return false;
  }
  return real === realCanonical && isRegularFileAt(real);
}

function isInsideRoot(real: string, realRoot: string): boolean {
  return real !== realRoot && real.startsWith(realRoot + sep);
}

// Contained, ownership-checked cleanup for session deletion. Removes the
// stored shot file only when it is a regular file inside the shots root and
// is the canonical screenshot of this session's own shot identity. Corrupted,
// legacy, or shared paths are skipped (logged), so the caller can still
// delete the requested database resource, no unrelated screenshot is ever
// removed, and a metadata-only session always stays deletable. Never removes
// directories.
export async function removeSessionShotFile(store: SessionShotStore, session: SessionShotRecord): Promise<void> {
  const shotPath = typeof session.shotPath === "string" ? session.shotPath.trim() : "";
  if (!shotPath || /[\u0000-\u001f\u007f]/.test(shotPath) || !existsSync(shotPath)) return;
  const root = pinarHome();
  let lexical: string;
  try {
    lexical = resolve(shotPath);
  } catch {
    return;
  }
  let real: string;
  let realRoot: string;
  try {
    real = realpathSync(lexical);
    realRoot = realpathSync(localShotsRoot());
  } catch {
    return;
  }
  if (!isInsideRoot(real, realRoot) || !isRegularFileAt(real)) {
    console.warn("Pinar skipped session shot cleanup: stored path is not a file inside the shots root", shotPath);
    return;
  }
  const canonical = canonicalShotPath(sessionShotIdentity(session), root);
  let owned = false;
  if (canonical) {
    try {
      owned = real === realpathSync(canonical);
    } catch {
      owned = false;
    }
  }
  if (!owned) {
    console.warn("Pinar skipped session shot cleanup: stored path does not belong to the session's shot identity", shotPath);
    return;
  }
  if (referencedByOtherSession(store, session.id, real)) {
    console.warn("Pinar kept the session shot file: another session still references it", shotPath);
    return;
  }
  await rm(real, { force: true });
}

function sessionReferencesFile(session: SessionShotRecord, real: string, root: string): boolean {
  const shotPath = typeof session.shotPath === "string" ? session.shotPath.trim() : "";
  if (shotPath && !/[\u0000-\u001f\u007f]/.test(shotPath)) {
    try {
      if (existsSync(shotPath) && realpathSync(shotPath) === real) return true;
    } catch {
      // A path that cannot be resolved does not reference the file.
    }
  }
  const canonical = canonicalShotPath(sessionShotIdentity(session), root);
  if (!canonical) return false;
  try {
    return existsSync(canonical) && realpathSync(canonical) === real;
  } catch {
    return false;
  }
}

function referencedByOtherSession(store: SessionShotStore, sessionId: string, real: string): boolean {
  const root = pinarHome();
  let sessions: readonly SessionShotRecord[];
  try {
    sessions = store.listSessions({ batchId: "", collectionId: "", limit: Number.MAX_SAFE_INTEGER, offset: 0, query: "" });
  } catch {
    return false;
  }
  return sessions.some((other) => other.id !== sessionId && sessionReferencesFile(other, real, root));
}
