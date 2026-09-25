import type { AuthSession } from "@pinar/shared";
import { isRecord } from "./api-data";

export interface CollaboratorRecord {
  createdAt?: string;
  email: string;
  id: string;
  role?: string;
  status: "accepted" | "pending";
}

export interface CollectionInvitationRecord {
  collectionId: string;
  collectionName: string;
  createdAt?: string;
  id: string;
  ownerEmail: string;
}

export interface SharedCollectionRecord {
  createdAt?: string;
  id: string;
  isSuspended?: boolean;
  name: string;
  ownerEmail?: string;
  role?: string;
  sessionCount?: number;
  status?: "active" | "suspended";
  updatedAt?: string;
}

export function canManageCollectionCollaborators(
  session: AuthSession | null,
  runtime: "cloud" | "local",
): boolean {
  if (runtime !== "cloud") return false;
  if (!session || session.kind !== "account") return false;
  return session.plan === "pro";
}

export function parseCollaboratorsResponse(data: unknown): CollaboratorRecord[] | null {
  if (!isRecord(data) || data.ok !== true) return null;
  if (!Array.isArray(data.collaborators)) return null;
  const list: CollaboratorRecord[] = [];
  for (const item of data.collaborators) {
    if (isRecord(item)) {
      const id = String(item.id ?? item.membershipId ?? "").trim();
      const email = String(item.email ?? "").trim();
      if (id && email) {
        const rawStatus = String(item.status ?? "pending").toLowerCase();
        const status = rawStatus === "accepted" ? "accepted" : "pending";
        list.push({
          createdAt: typeof item.createdAt === "string" ? item.createdAt : typeof item.invitedAt === "string" ? item.invitedAt : undefined,
          email,
          id,
          role: typeof item.role === "string" ? item.role : undefined,
          status,
        });
      }
    }
  }
  return list;
}

export function parseInvitationsResponse(data: unknown): CollectionInvitationRecord[] | null {
  if (!isRecord(data) || data.ok !== true) return null;
  if (!Array.isArray(data.invitations)) return null;
  const list: CollectionInvitationRecord[] = [];
  for (const item of data.invitations) {
    if (isRecord(item)) {
      const id = String(item.id ?? item.invitationId ?? item.membershipId ?? "").trim();
      const collectionId = String(item.collectionId ?? item.collection_id ?? "").trim();
      if (id && collectionId) {
        const collectionName = String(item.collectionName ?? item.collection_name ?? item.name ?? "Coleção").trim();
        const ownerEmail = String(item.ownerEmail ?? item.owner_email ?? item.invitedBy ?? item.owner ?? "").trim();
        list.push({
          collectionId,
          collectionName: collectionName || "Coleção",
          createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
          id,
          ownerEmail,
        });
      }
    }
  }
  return list;
}

export function parseSharedCollectionsResponse(data: unknown): SharedCollectionRecord[] | null {
  if (!isRecord(data) || data.ok !== true) return null;
  if (!Array.isArray(data.collections)) return null;
  const list: SharedCollectionRecord[] = [];
  for (const item of data.collections) {
    if (isRecord(item)) {
      const id = String(item.id ?? "").trim();
      const name = String(item.name ?? "Coleção compartilhada").trim();
      if (id) {
        const sessionCount = typeof item.sessionCount === "number"
          ? item.sessionCount
          : typeof item.sessionsCount === "number"
            ? item.sessionsCount
            : Array.isArray(item.sessions)
              ? item.sessions.length
              : undefined;
        const rawStatus = typeof item.status === "string" ? item.status.toLowerCase() : undefined;
        const isSuspended = rawStatus === "suspended"
          || item.suspended === true
          || item.isSuspended === true
          || (typeof item.ownerPlan === "string" && item.ownerPlan !== "pro" && item.ownerPlan !== "");
        const status: "active" | "suspended" = isSuspended ? "suspended" : "active";

        list.push({
          createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
          id,
          isSuspended,
          name: name || "Coleção compartilhada",
          ownerEmail: typeof item.ownerEmail === "string" ? item.ownerEmail : typeof item.owner_email === "string" ? item.owner_email : undefined,
          role: typeof item.role === "string" ? item.role : "reviewer",
          sessionCount,
          status,
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined,
        });
      }
    }
  }
  return list;
}

export async function fetchCollectionCollaborators(collectionId: string): Promise<CollaboratorRecord[]> {
  const response = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/collaborators`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("fetch_collaborators_failed");
  const data: unknown = await response.json();
  const parsed = parseCollaboratorsResponse(data);
  if (!parsed) throw new Error("invalid_collaborators_response");
  return parsed;
}

export type CollaboratorInviteFailure =
  | "invite_self"
  | "invite_exists"
  | "invite_pro_required"
  | "invite_collaborator_failed";

const COLLABORATOR_INVITE_FAILURES: ReadonlyArray<{
  error: string;
  failure: Exclude<CollaboratorInviteFailure, "invite_collaborator_failed">;
  status: number;
}> = [
  { error: "Cannot invite yourself", failure: "invite_self", status: 400 },
  { error: "Pro plan required to invite collaborators", failure: "invite_pro_required", status: 403 },
  { error: "Collaborator already invited or accepted", failure: "invite_exists", status: 409 },
];

export function collaboratorInviteFailure(status: number, payload: unknown): CollaboratorInviteFailure {
  const error = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : "";
  return COLLABORATOR_INVITE_FAILURES.find((item) => item.status === status && item.error === error)?.failure
    ?? "invite_collaborator_failed";
}

export async function inviteCollectionCollaborator(collectionId: string, email: string): Promise<void> {
  const response = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/collaborators`, {
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.ok) return;
  const payload: unknown = await response.json().catch(() => null);
  throw new Error(collaboratorInviteFailure(response.status, payload));
}

export async function revokeCollectionCollaborator(collectionId: string, membershipId: string): Promise<void> {
  const response = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/collaborators/${encodeURIComponent(membershipId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("revoke_collaborator_failed");
}

export async function fetchCollectionInvitations(): Promise<CollectionInvitationRecord[]> {
  const response = await fetch("/api/collection-invitations", { cache: "no-store" });
  if (!response.ok) throw new Error("fetch_invitations_failed");
  const data: unknown = await response.json();
  const parsed = parseInvitationsResponse(data);
  if (!parsed) throw new Error("invalid_invitations_response");
  return parsed;
}

export async function acceptCollectionInvitation(invitationId: string): Promise<{ collectionId?: string; ok: boolean }> {
  const response = await fetch(`/api/collection-invitations/${encodeURIComponent(invitationId)}/accept`, {
    method: "POST",
  });
  if (!response.ok) throw new Error("accept_invitation_failed");
  const data: unknown = await response.json().catch(() => ({ ok: true }));
  const collectionId = isRecord(data) && typeof data.collectionId === "string" ? data.collectionId : undefined;
  return { collectionId, ok: true };
}

export async function fetchSharedCollections(): Promise<SharedCollectionRecord[]> {
  const response = await fetch("/api/shared-collections", { cache: "no-store" });
  if (!response.ok) throw new Error("fetch_shared_collections_failed");
  const data: unknown = await response.json();
  const parsed = parseSharedCollectionsResponse(data);
  if (!parsed) throw new Error("invalid_shared_collections_response");
  return parsed;
}
