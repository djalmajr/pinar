// The base row reserves room for three digits, so a larger count shows as
// "999+" and the row widens its reservation (see collectionButtonClass). The
// full number stays in the badge's title and accessible label.
export const SIDEBAR_COUNT_CAP = 999;

export function sidebarCountText(count: number) {
  return count > SIDEBAR_COUNT_CAP ? `${SIDEBAR_COUNT_CAP}+` : String(count);
}

interface CollectionBadgeState {
  // The row renders the ⋮ actions button at the right edge.
  hasActions: boolean;
  menuActionFocused: boolean;
  menuOpen: boolean;
}

// The count and the ⋮ button share the row's right edge. Below `md` the
// button is always visible (touch has no hover), so the count sits left of it
// (right-7 clears the size-6 button at right-1). From `md` up the count keeps
// the right edge and gives way to the button on hover or focus. SidebarMenuBadge
// merges these over its own `right-1`.
export function collectionBadgeClass({ hasActions, menuActionFocused, menuOpen }: CollectionBadgeState) {
  if (!hasActions) return "";
  const classes = ["right-7", "md:right-1", "md:group-hover/menu-item:opacity-0"];
  if (menuOpen || menuActionFocused) classes.push("md:opacity-0");
  return classes.join(" ");
}

// Below `md` the row's label reserves room for the shifted count and the ⋮
// button: 28px to clear the button, plus the widest count, "999+" (~39px),
// and a gap.
// The base button only reserves pr-9 for a count at the right edge, enough for
// three digits. A "999+" count there (from `md` up, or always on a row without
// actions) needs pr-12: 4px from the edge, ~39px, and a gap.
export function collectionButtonClass({ count, hasActions }: { count: number; hasActions: boolean }) {
  const classes: string[] = [];
  if (hasActions) classes.push("max-md:group-has-data-[sidebar=menu-badge]/menu-item:pr-18");
  if (count > SIDEBAR_COUNT_CAP)
    classes.push(`${hasActions ? "md:" : ""}group-has-data-[sidebar=menu-badge]/menu-item:pr-12`);
  return classes.join(" ");
}
