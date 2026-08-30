export const WORKSPACE_TREE_POLL_MS = 3_000;

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
