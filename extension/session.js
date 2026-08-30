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

export const PINAR_HELPER_PORT_START = 17373;
export const PINAR_HELPER_PORT_END = 17382;
export const CONTENT_INJECTION_FILES = [
  "coordinates.js",
  "frame-path.js",
  "locators.js",
  "privacy.js",
  "keyboard.js",
  "content.js",
];

export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function isHelperPort(port) {
  return Number.isInteger(port) && port >= PINAR_HELPER_PORT_START && port <= PINAR_HELPER_PORT_END;
}

export function isPinarAppUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      return parsed.hostname === "pinar.dev" || parsed.hostname.endsWith(".pinar.dev");
    }
    if (parsed.protocol !== "http:") return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return false;
    return isHelperPort(Number(parsed.port || 80));
  } catch {
    return false;
  }
}

export function isPinarHelperOrigin(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return false;
    return isHelperPort(Number(parsed.port || 80));
  } catch {
    return false;
  }
}

export function isTransientTabUrl(tabUrl) {
  return !tabUrl || tabUrl === "about:blank";
}

export function tabUrlAllowedForSession(pageUrl, tabUrl) {
  const pageOrigin = originOf(pageUrl);
  const tabOrigin = originOf(tabUrl);
  return Boolean(pageOrigin && tabOrigin && pageOrigin === tabOrigin);
}

export function selectHydrateSession(requestedSessionId, session) {
  if (!requestedSessionId || !session) return null;
  if (session.id !== requestedSessionId && session.captureId !== requestedSessionId) return null;
  return {
    session,
    sessionId: session.id || requestedSessionId,
  };
}

export function planSessionReopen({ appUrl, requestedSessionId, session }) {
  if (!isPinarAppUrl(appUrl)) return { ok: false, error: "untrusted_app" };
  const selected = selectHydrateSession(requestedSessionId, session);
  if (!selected) return { ok: false, error: "session_mismatch" };
  const pageUrl = selected.session.page?.url;
  if (!pageUrl) return { ok: false, error: "missing_page" };
  return {
    ok: true,
    origin: originOf(pageUrl),
    pageUrl,
    sessionId: selected.sessionId,
  };
}

export function bindTabHydration(map, tabId, binding) {
  if (tabId == null) return false;
  map.set(tabId, binding);
  return true;
}

export function hydrationForTab(map, tabId) {
  return map.get(tabId) || null;
}

export function dropHydrationIfTabLeftOrigin(hydrations, tabPins, tabId, tabUrl) {
  const binding = hydrations.get(tabId);
  if (!binding) return { dropped: false };
  if (isTransientTabUrl(tabUrl)) return { dropped: false };
  if (tabUrlAllowedForSession(binding.pageUrl, tabUrl)) return { dropped: false };
  hydrations.delete(tabId);
  tabPins.delete(tabId);
  return { dropped: true, reason: "origin_mismatch" };
}

export function hydratePayloadForBinding(binding, requestedSessionId) {
  if (!binding?.payload?.session) return null;
  return selectHydrateSession(requestedSessionId || binding.sessionId, binding.payload.session);
}
