/** Tab-level close after a successful copy. Must reach every frame. */
export function afterCopyAction(ok) {
  if (ok) return { type: "session:end" };
  return { hidden: false, type: "overlays:hidden" };
}

export function endTabPins(tabPins, tabId) {
  if (tabId != null) tabPins.delete(tabId);
}

export function planSessionEnd(tabId) {
  if (tabId == null) return { ok: false, error: "missing tab" };
  return {
    clearPins: true,
    dismissAllFrames: true,
    ok: true,
    tabId,
  };
}
