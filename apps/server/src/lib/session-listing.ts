import type { PageInfo } from "@pinar/shared";

const EMPTY_SESSIONS: never[] = [];

export function flattenCollectionSessions<T>(
  collections: readonly { sessions: readonly T[] }[] | undefined,
): T[] {
  if (!collections?.length) return EMPTY_SESSIONS as T[];
  if (collections.length === 1) return collections[0].sessions as T[];
  return collections.flatMap((collection) => collection.sessions as T[]);
}

function trimmed(value?: string) {
  return value?.trim() || "";
}

function isGenericPinarTitle(title: string, url: string) {
  if (title.toLowerCase() !== "pinar") return false;
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "pinar.dev" || host.endsWith(".pinar.dev");
  } catch {
    return false;
  }
}

export function sessionListingCopy(page: PageInfo) {
  const url = trimmed(page.url);
  const rawTitle = trimmed(page.title);
  const title = rawTitle && !isGenericPinarTitle(rawTitle, url) ? rawTitle : "";
  return {
    description: trimmed(page.description),
    title,
    url,
  };
}
