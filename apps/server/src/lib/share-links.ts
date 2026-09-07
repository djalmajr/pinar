import type { AuthSession, Session } from "@pinar/shared";
import { isRecord, readResponseRecord } from "./api-data";
import type { PinarRuntime } from "./server-header";

export type ShareResourceType = "session" | "project" | "collection" | "batch";

export function shareMarkdownPath(sessionId: string, token?: string | null) {
  const path = `/v/${sessionId}.md`;
  if (!token) return path;
  return `${path}?token=${encodeURIComponent(token)}`;
}

export function buildShareUrl(sessionId: string, token: string, origin?: string) {
  const base = origin
    ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  return new URL(shareMarkdownPath(sessionId, token), base).toString();
}

export function isActiveShareToken(value: unknown, now = Date.now()) {
  if (!isRecord(value) || typeof value.token !== "string" || !value.token) return false;
  if (typeof value.revokedAt === "string" && value.revokedAt) return false;
  if (value.status === "revoked") return false;
  if (typeof value.expiresAt === "string" && value.expiresAt) {
    const expiresAt = Date.parse(value.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= now) return false;
  }
  return true;
}

function matchingActiveToken(
  value: unknown,
  resourceType: ShareResourceType,
  resourceId: string,
  now: number,
) {
  if (!isRecord(value)) return null;
  if (value.resourceType !== resourceType || value.resourceId !== resourceId) return null;
  if (!isActiveShareToken(value, now)) return null;
  return typeof value.token === "string" ? value.token : null;
}

export async function fetchActiveShare(
  resourceType: ShareResourceType,
  resourceId: string,
) {
  const response = await fetch("/api/shares", { cache: "no-store" });
  const data = await readResponseRecord(response);
  if (!response.ok || !data || !Array.isArray(data.tokens)) return null;
  const now = Date.now();
  for (const token of data.tokens) {
    const match = matchingActiveToken(token, resourceType, resourceId, now);
    if (match) return match;
  }
  return null;
}

export async function publishShare(
  resourceType: ShareResourceType,
  resourceId: string,
) {
  const response = await fetch("/api/shares/publish", {
    body: JSON.stringify({ resourceId, resourceType }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const data = await readResponseRecord(response);
  const shareToken = data && isRecord(data.shareToken) ? data.shareToken : null;
  if (!response.ok || !shareToken || typeof shareToken.token !== "string" || !shareToken.token) {
    throw new Error("share_publish_failed");
  }
  return shareToken.token;
}

export async function revokeShare(
  resourceType: ShareResourceType,
  resourceId: string,
) {
  const response = await fetch("/api/shares/revoke", {
    body: JSON.stringify({ resourceId, resourceType }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.ok || response.status === 404) return;
  throw new Error("share_revoke_failed");
}

export function canManageCloudShare(
  runtime: PinarRuntime,
  authSession: AuthSession | null,
  session: Pick<Session, "userId"> | null,
) {
  if (runtime !== "cloud" || !authSession || !session) return false;
  if (authSession.kind === "account") {
    return !session.userId || session.userId === authSession.userId;
  }
  if (authSession.kind === "installation") {
    return !session.userId || session.userId === authSession.installationId;
  }
  return false;
}
