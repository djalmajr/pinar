import type { ProjectTreeProject } from "@pinar/shared";
import { markSharedSessions } from "./share-links";

export const WORKSPACE_TREE_POLL_MS = 30_000;

export interface WorkspaceShareTokenCache {
  ready: boolean;
  tokens: unknown[];
}

export function applyRememberedShareTokens(
  projects: ProjectTreeProject[],
  cache: WorkspaceShareTokenCache,
  nextTokens: unknown[] | null,
  now = Date.now(),
): { cache: WorkspaceShareTokenCache; projects: ProjectTreeProject[] } {
  const remembered = nextTokens ? { ready: true, tokens: nextTokens } : cache;
  return {
    cache: remembered,
    projects: remembered.ready ? markSharedSessions(projects, remembered.tokens, now) : projects,
  };
}

export type WorkspaceTreeRefresh = "initial" | "focus" | "mutation" | "poll";

export interface WorkspaceTreeRefreshFlight {
  active: WorkspaceTreeRefresh | null;
  queued: WorkspaceTreeRefresh | null;
}

export function workspaceTreeRefreshIncludesMetadata(refresh: WorkspaceTreeRefresh) {
  return refresh !== "poll";
}

export function beginWorkspaceTreeRefresh(
  flight: WorkspaceTreeRefreshFlight,
  refresh: WorkspaceTreeRefresh,
): { flight: WorkspaceTreeRefreshFlight; started: boolean } {
  if (flight.active) {
    return {
      flight: {
        active: flight.active,
        queued: queueWorkspaceTreeRefresh(flight.active, flight.queued, refresh),
      },
      started: false,
    };
  }
  return { flight: { active: refresh, queued: null }, started: true };
}

export function finishWorkspaceTreeRefresh(
  flight: WorkspaceTreeRefreshFlight,
): { flight: WorkspaceTreeRefreshFlight; next: WorkspaceTreeRefresh | null } {
  if (!flight.queued) return { flight: { active: null, queued: null }, next: null };
  return { flight: { active: flight.queued, queued: null }, next: flight.queued };
}

function queueWorkspaceTreeRefresh(
  active: WorkspaceTreeRefresh,
  queued: WorkspaceTreeRefresh | null,
  incoming: WorkspaceTreeRefresh,
): WorkspaceTreeRefresh | null {
  if (incoming === "poll") return queued;
  if (incoming === "mutation") return "mutation";
  if (incoming === "focus" && active === "poll" && queued !== "mutation") return "focus";
  return queued;
}

export function projectTreeFingerprint(projects: readonly unknown[]): string {
  return JSON.stringify(projects);
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function resolveSelectedCollectionId(
  currentId: string | null,
  storedId: string | null,
  collectionIds: ReadonlySet<string>,
) {
  const preferred = currentId ?? storedId;
  if (!preferred || !collectionIds.has(preferred)) return null;
  return preferred;
}
