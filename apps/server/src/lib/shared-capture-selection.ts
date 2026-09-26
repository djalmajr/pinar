import type { SessionGroup } from "./session-groups";
import { isRecord } from "./api-data";
import { isActiveShareToken } from "./share-links";

export interface SharedCaptureTarget {
  captureId: string;
  groupId: string;
}

interface SharedCaptureSelection {
  directlySharedCaptureIds: ReadonlySet<string>;
  groups: SessionGroup[];
  selectedGroupIds: ReadonlySet<string>;
  visibleGroupIds: ReadonlySet<string>;
}

export function directSessionShareIds(tokens: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const token of tokens) {
    if (!isRecord(token) || token.resourceType !== "session" || typeof token.resourceId !== "string") continue;
    if (isActiveShareToken(token)) ids.add(token.resourceId);
  }
  return ids;
}

export function selectedSharedCaptures({
  directlySharedCaptureIds,
  groups,
  selectedGroupIds,
  visibleGroupIds,
}: SharedCaptureSelection): SharedCaptureTarget[] {
  const seen = new Set<string>();
  const targets: SharedCaptureTarget[] = [];
  for (const group of groups) {
    if (!visibleGroupIds.has(group.id) || !selectedGroupIds.has(group.id)) continue;
    for (const capture of group.captures ?? [group]) {
      if (!directlySharedCaptureIds.has(capture.id) || seen.has(capture.id)) continue;
      seen.add(capture.id);
      targets.push({ captureId: capture.id, groupId: group.id });
    }
  }
  return targets;
}
