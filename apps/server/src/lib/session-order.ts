export type OrderDirection = "earlier" | "later";
export type SessionOrderDirection = OrderDirection;

export function reorderIds(
  ids: readonly string[],
  activeId: string,
  direction: OrderDirection,
) {
  const from = ids.indexOf(activeId);
  const to = direction === "earlier" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const ordered = [...ids];
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  return ordered;
}

export const reorderSessionIds = reorderIds;
