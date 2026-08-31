import {
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from "@dnd-kit/core";
import type { PointerEvent as ReactPointerEvent } from "react";

export const SESSION_DND_TYPE = "session";
export const COLLECTION_DND_TYPE = "collection";
export const SESSION_DRAG_PREFIX = "session:";

export function sessionDragId(sessionId: string) {
  return `${SESSION_DRAG_PREFIX}${sessionId}`;
}

export function sessionIdsForDrop(
  draggedSessionId: string,
  selectedIds: ReadonlySet<string>,
) {
  if (selectedIds.has(draggedSessionId) && selectedIds.size > 1) {
    return [...selectedIds];
  }
  return [draggedSessionId];
}

export function collectionIdFromOver(
  overId: string | number | undefined | null,
  collectionIds: ReadonlySet<string>,
) {
  if (overId == null) return null;
  const id = String(overId);
  return collectionIds.has(id) ? id : null;
}

export function isSessionDragData(
  data: unknown,
): data is { sessionIds: string[]; title?: string; type: typeof SESSION_DND_TYPE } {
  if (!data || typeof data !== "object") return false;
  const record = data as { sessionIds?: unknown; type?: unknown };
  return record.type === SESSION_DND_TYPE
    && Array.isArray(record.sessionIds)
    && record.sessionIds.every((id) => typeof id === "string" && id.length > 0);
}

export function shouldStartWorkspaceDrag(event: Event) {
  const target = event.target;
  if (!target || typeof (target as { closest?: unknown }).closest !== "function") return true;
  return !(target as Element).closest("input, textarea, [data-no-dnd], [data-slot=checkbox]");
}

export class WorkspacePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: ReactPointerEvent) => {
        if (!nativeEvent.isPrimary || nativeEvent.button !== 0) return false;
        return shouldStartWorkspaceDrag(nativeEvent);
      },
    },
  ];
}

export function workspaceCollisionDetection(
  args: Parameters<CollisionDetection>[0],
) {
  if (isSessionDragData(args.active.data.current)) {
    const pointerHits = pointerWithin(args);
    if (pointerHits.length > 0) return pointerHits;
    return rectIntersection(args);
  }
  return closestCenter(args);
}
