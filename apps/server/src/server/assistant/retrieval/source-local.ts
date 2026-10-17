// PinSource over the local history database (F3 contract §3.2, decision
// A20). The local app is single-person: every session is accessible.
//
// - listSessions lists only sessions with at least one pin, newest first
//   (the history order, created_at DESC), so an empty session is never
//   pending. Local sessions have no update time, so updatedAt is the
//   session's createdAt: a session never indexed is stale, and edits reach
//   the index through the write queue (runtime-local.ts).
// - session returns the session even without pins, so indexing a session
//   whose last pin was removed clears its entries. Pins without an id are
//   left out and a repeated pin id keeps its first pin, so pins and pinIds
//   always line up.
// - shot reads the canonical shot file of the session's shot identity,
//   <shotsRoot>/<safeShotName(shotId or session id)>, never the stored
//   shotPath. The mime type comes from the file's signature (PNG, JPEG or
//   WebP); any other content, a missing file or a non-file is no shot.

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Pin } from "@pinar/shared";
import { safeShotName } from "@pinar/cli/shots";
import { sessionShotIdentity } from "../../local-session-files";
import type { PinDocumentInput } from "./document";
import type { PinSource } from "./index";

export interface LocalPinSourceSession {
  createdAt: string;
  id: string;
  page: { title?: string; url?: string };
  pins: Pin[];
  shotId?: string | null;
}

/** The history database methods the pin source reads (apps/cli/src/history.mjs). */
export interface LocalPinSourceDatabase {
  getSession(id: string): LocalPinSourceSession | null;
  listPinComments(captureId: string): Array<{ actorLabel: string; body: string; pinId: string }>;
  listSessions(options: { limit: number; offset: number; query: string }): LocalPinSourceSession[];
}

type ShotMimeType = "image/png" | "image/jpeg" | "image/webp";

// History rows read per page while skipping sessions without pins.
const SCAN_PAGE_SIZE = 100;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
}

// The image type from the file signature, or null for anything else.
export function shotMimeType(bytes: Uint8Array): ShotMimeType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "RIFF" <size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

// The pins that can be indexed, each with its id, in session order.
function indexablePins(session: LocalPinSourceSession): Array<{ pin: Pin; pinId: string }> {
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

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function localPinSource(db: LocalPinSourceDatabase, shotsRoot: string): PinSource {
  return {
    async listSessions({ limit, offset }) {
      const wanted = Math.max(0, Math.trunc(offset)) + Math.max(0, Math.trunc(limit));
      const withPins: Array<{ id: string; updatedAt: string }> = [];
      for (let scanned = 0; withPins.length < wanted; scanned += SCAN_PAGE_SIZE) {
        const page = db.listSessions({ limit: SCAN_PAGE_SIZE, offset: scanned, query: "" });
        for (const session of page) {
          if (indexablePins(session).length > 0) withPins.push({ id: session.id, updatedAt: session.createdAt });
        }
        if (page.length < SCAN_PAGE_SIZE) break;
      }
      return withPins.slice(Math.max(0, Math.trunc(offset)), wanted);
    },

    async session(id) {
      const session = db.getSession(id);
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
      for (const comment of db.listPinComments(sessionId)) {
        const list = byPin.get(comment.pinId) ?? [];
        list.push({ author: comment.actorLabel, body: comment.body });
        byPin.set(comment.pinId, list);
      }
      return byPin;
    },

    async shot(sessionId) {
      const session = db.getSession(sessionId);
      if (!session) return null;
      const path = join(shotsRoot, safeShotName(sessionShotIdentity(session)));
      try {
        if (!(await stat(path)).isFile()) return null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      const bytes = new Uint8Array(await readFile(path));
      const mimeType = shotMimeType(bytes);
      return mimeType ? { bytes, mimeType } : null;
    },
  };
}
