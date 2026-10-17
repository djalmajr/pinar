// The candidates of a new capture's filing (F3.5 contract §1 and §3.1):
// the person's collections, the protected Inbox left out by the sources,
// each labelled "Project / Collection" with up to 3 titles of its most
// recent sessions as examples and the time of its last capture.
//
// Labels are one line and at most FILING_LABEL_MAX_CHARS characters. A label
// already taken (by an earlier collection, or FILING_NONE_OPTION) gets the
// first free suffix " (2)", " (3)", ..., clipping the base so the label
// still fits; the collections' order decides which one keeps the plain
// label, so the same order always gives the same labels.

import { clipText, oneLine } from "../assistant/retrieval/document";
import { FILING_NONE_OPTION, type FilingCandidate } from "./constants";

export const FILING_LABEL_MAX_CHARS = 200;
export const FILING_EXAMPLE_TITLES = 3;
// Sessions per collection whose index entries make its centroid.
export const FILING_CENTROID_SESSIONS = 50;

export interface FilingCollection {
  collectionId: string;
  collectionName: string;
  projectName: string;
}

export interface FilingRecentSession {
  collectionId: string;
  createdAt: string;
  id: string;
  title: string;
}

/** One unique label per collection, in the collections' order. */
export function filingLabels(collections: FilingCollection[]): string[] {
  const taken = new Set<string>([FILING_NONE_OPTION]);
  return collections.map(({ collectionName, projectName }) => {
    const base = `${oneLine(projectName)} / ${oneLine(collectionName)}`;
    let label = clipText(base, FILING_LABEL_MAX_CHARS);
    for (let copy = 2; taken.has(label); copy += 1) {
      const suffix = ` (${copy})`;
      label = `${clipText(base, FILING_LABEL_MAX_CHARS - suffix.length)}${suffix}`;
    }
    taken.add(label);
    return label;
  });
}

/**
 * The candidates of `collections`, in their order. `sessions` are the
 * recent sessions of those collections, newest first: the first ones give
 * the examples (blank titles skipped) and the first one the lastUsedAt.
 */
export function filingCandidates(collections: FilingCollection[], sessions: FilingRecentSession[]): FilingCandidate[] {
  const byCollection = new Map<string, FilingRecentSession[]>();
  for (const session of sessions) {
    const group = byCollection.get(session.collectionId) ?? [];
    group.push(session);
    byCollection.set(session.collectionId, group);
  }
  const labels = filingLabels(collections);
  return collections.map(({ collectionId }, index) => {
    const recent = byCollection.get(collectionId) ?? [];
    return {
      collectionId,
      examples: recent
        .map((session) => oneLine(session.title))
        .filter((title) => title !== "")
        .slice(0, FILING_EXAMPLE_TITLES),
      label: labels[index]!,
      lastUsedAt: recent[0]?.createdAt || null,
    };
  });
}
