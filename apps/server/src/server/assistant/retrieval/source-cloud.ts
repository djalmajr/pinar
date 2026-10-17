// PinSource of one Cloud principal (F3 contract §3.3, decision A20), over
// the narrow data access cloud-api.ts builds from its own access functions
// (CloudPinSourceData), so the rules stay the ones the rest of the Cloud
// uses:
// - listSessions lists, newest first, the principal's own sessions with at
//   least one pin and, for a search, the sessions with pins of the
//   collections where the principal is an accepted collaborator (the rule
//   of mcpSessionSummaries and findAccessibleSession). At most
//   PIN_SEARCH_MAX_SESSIONS sessions are listed, read once per source.
//   updatedAt is the newest of the session's createdAt and its newest
//   conversation comment: Cloud sessions keep no update time, and without a
//   write queue a new comment would otherwise never reach the index.
// - session(id) asks the data access again, so a session the principal can
//   no longer see is null; comments and shot read only a session that
//   session(id) finds now (checked once per source).
// - shot reads the bucket object; the mime type comes from the bytes (PNG,
//   JPEG or WebP), anything else is no shot.
//
// owners() maps every listed session to its owner (the session's user):
// the store of each owner (cloudPinIndexStore) holds that session's
// entries.
//
// The pin rules (pins without an id left out, a repeated id keeps its
// first pin, the document fields) and the image signatures are the same as
// in source-local.ts, which cannot be imported here: it reads the local
// file system.

import type { Pin } from "@pinar/shared";
import type { PinDocumentInput } from "./document";
import { PIN_SEARCH_MAX_SESSIONS, type PinSource } from "./index";

export interface CloudPinSessionRow {
  createdAt: string;
  id: string;
  ownerId: string;
}

export interface CloudPinSourceSession {
  createdAt: string;
  id: string;
  page: { title?: string; url?: string };
  pins: Pin[];
}

/** The Cloud reads behind a pin source; cloud-api.ts implements it per principal. */
export interface CloudPinSourceData {
  /** Sessions with pins the principal owns, newest first, at most `limit`. */
  ownedSessions(limit: number): Promise<CloudPinSessionRow[]>;
  /** Sessions with pins of the collections the principal collaborates on (accepted), newest first, at most `limit`. */
  sharedSessions(limit: number): Promise<CloudPinSessionRow[]>;
  /** The session when the principal can see it now, else null. */
  session(id: string): Promise<CloudPinSourceSession | null>;
  /** Conversation comments of the session, oldest first. */
  comments(sessionId: string): Promise<Array<{ actorLabel: string; body: string; pinId: string }>>;
  /** The newest conversation comment time of each session that has one. */
  latestCommentAt(sessionIds: string[]): Promise<Map<string, string>>;
  /** The screenshot bytes, or null without a bucket or an object. */
  shot(sessionId: string): Promise<Uint8Array | null>;
}

export interface CloudPinSource extends PinSource {
  /** Session id → owner id of every listed session. */
  owners(): Promise<Map<string, string>>;
}

type ShotMimeType = "image/png" | "image/jpeg" | "image/webp";

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
}

function shotMimeType(bytes: Uint8Array): ShotMimeType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

function indexablePins(session: CloudPinSourceSession): Array<{ pin: Pin; pinId: string }> {
  const seen = new Set<string>();
  const pins: Array<{ pin: Pin; pinId: string }> = [];
  for (const pin of session.pins ?? []) {
    const pinId = pin.pinId || pin.id;
    if (!pinId || seen.has(pinId)) continue;
    seen.add(pinId);
    pins.push({ pin, pinId });
  }
  return pins;
}

function documentPin(pin: Pin): PinDocumentInput["pin"] {
  const result: PinDocumentInput["pin"] = { comment: typeof pin.comment === "string" ? pin.comment : "", number: pin.number };
  for (const key of ["innerText", "label", "selector", "tag", "text"] as const) {
    const value = pin[key];
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

// Newest first; equal times by id, so the order is stable across reads.
function newestFirst(left: CloudPinSessionRow, right: CloudPinSessionRow): number {
  return right.createdAt.localeCompare(left.createdAt) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function cloudPinSource(data: CloudPinSourceData): CloudPinSource {
  let listed: Promise<Array<{ id: string; ownerId: string; updatedAt: string }>> | null = null;
  const visible = new Map<string, Promise<CloudPinSourceSession | null>>();

  // The accessible sessions with pins, read once per source.
  function accessible() {
    listed ??= (async () => {
      const [owned, shared] = await Promise.all([
        data.ownedSessions(PIN_SEARCH_MAX_SESSIONS),
        data.sharedSessions(PIN_SEARCH_MAX_SESSIONS),
      ]);
      const seen = new Set<string>();
      const rows = [...owned, ...shared].sort(newestFirst).filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      }).slice(0, PIN_SEARCH_MAX_SESSIONS);
      const commented = await data.latestCommentAt(rows.map((row) => row.id));
      return rows.map((row) => {
        const comment = commented.get(row.id);
        return { id: row.id, ownerId: row.ownerId, updatedAt: comment && comment > row.createdAt ? comment : row.createdAt };
      });
    })();
    return listed;
  }

  // The session as the data access sees it now, checked once per source.
  function current(id: string) {
    let session = visible.get(id);
    if (!session) {
      session = data.session(id);
      visible.set(id, session);
    }
    return session;
  }

  return {
    async listSessions({ limit, offset }) {
      const start = Math.max(0, Math.trunc(offset));
      const rows = await accessible();
      return rows.slice(start, start + Math.max(0, Math.trunc(limit))).map(({ id, updatedAt }) => ({ id, updatedAt }));
    },

    async owners() {
      return new Map((await accessible()).map((row) => [row.id, row.ownerId]));
    },

    async session(id) {
      const session = await current(id);
      if (!session) return null;
      const pins = indexablePins(session);
      return {
        id: session.id,
        page: { title: session.page?.title ?? "", url: session.page?.url ?? "" },
        pinIds: pins.map((item) => item.pinId),
        pins: pins.map((item) => documentPin(item.pin)),
      };
    },

    async comments(sessionId) {
      const byPin = new Map<string, Array<{ author: string; body: string }>>();
      if (!(await current(sessionId))) return byPin;
      for (const comment of await data.comments(sessionId)) {
        const list = byPin.get(comment.pinId) ?? [];
        list.push({ author: comment.actorLabel, body: comment.body });
        byPin.set(comment.pinId, list);
      }
      return byPin;
    },

    async shot(sessionId) {
      if (!(await current(sessionId))) return null;
      const bytes = await data.shot(sessionId);
      if (!bytes) return null;
      const mimeType = shotMimeType(bytes);
      return mimeType ? { bytes, mimeType } : null;
    },
  };
}
