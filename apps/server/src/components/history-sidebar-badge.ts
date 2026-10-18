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
