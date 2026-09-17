// Chrome refuses content-script injection on its own surfaces. Deciding up
// front keeps the click a deliberate no-op there and lets a rejection on an
// ordinary page stay loud, since that one is a real defect.
const UNINJECTABLE_URL = /^(?:chrome|chrome-extension|chrome-untrusted|devtools|edge|about|view-source):|^https:\/\/chromewebstore\.google\.com\//i;

export function canInjectInto(tabUrl) {
  return typeof tabUrl === "string" && tabUrl !== "" && !UNINJECTABLE_URL.test(tabUrl);
}

/** Tab-level close after a successful copy. Must reach every frame. */
export function afterCopyAction(ok) {
  if (ok) return { type: "session:end" };
  return { hidden: false, type: "overlays:hidden" };
}

export function endTabPins(tabPins, tabId) {
  if (tabId != null) tabPins.delete(tabId);
}

export function pinFrameIds(pins = []) {
  return [...new Set(pins.map((pin) => pin.frameId).filter(Number.isInteger))];
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

// Runs in the page's MAIN world before the content scripts, so the page's own
// console.error calls and failed requests reach the evidence store.
export const EVIDENCE_HOOK_FILES = ["evidence-hook.js"];

export const CONTENT_INJECTION_FILES = [
  "coordinates.js",
  "frame-path.js",
  "locators.js",
  "privacy.js",
  "snapshot.js",
  "evidence.js",
  "keyboard.js",
  "content.js",
];
