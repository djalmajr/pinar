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
// button: 28px to clear the button, plus up to three digits (~30px) and a gap.
// The base button only reserves pr-9 for a count, which a long truncated name
// runs into once the count moved left. From `md` up the base reservation stays.
export function collectionButtonClass({ hasActions }: Pick<CollectionBadgeState, "hasActions">) {
  return hasActions ? "max-md:group-has-data-[sidebar=menu-badge]/menu-item:pr-16" : "";
}
