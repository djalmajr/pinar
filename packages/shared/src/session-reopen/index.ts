export const PINAR_REOPEN_SESSION_EVENT = "pinar:reopen-session";
export const PINAR_REOPEN_SESSION_RESULT_EVENT = "pinar:reopen-session:result";
export const PINAR_HELPER_PORT_START = 17373;
export const PINAR_HELPER_PORT_END = 17382;

export type LocationHistorySource = "locator" | "manual";

export interface LocationHistoryEntry {
  at: string;
  confidence: "ambiguous" | "exact" | "probable" | "unresolved";
  source: LocationHistorySource;
  strategy?: string;
}

export interface HistoricalPin {
  anchor?: { x: number; y: number };
  box?: { height: number; width: number; x: number; y: number };
  fingerprint?: unknown;
  historicalAnchor?: { x: number; y: number };
  historicalBox?: { height: number; width: number; x: number; y: number };
  location?: {
    confidence: LocationHistoryEntry["confidence"];
    evidence?: string[];
    score?: number;
    strategy?: string;
    warning?: string;
  };
  locationHistory?: LocationHistoryEntry[];
  path?: string;
  selector?: string;
}

export interface ReopenSessionLike {
  captureId?: string;
  id?: string;
  page?: { url?: string };
}

export function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function isHelperPort(port: number) {
  return Number.isInteger(port) && port >= PINAR_HELPER_PORT_START && port <= PINAR_HELPER_PORT_END;
}

export function isPinarAppUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      return parsed.hostname === "pinar.dev" || parsed.hostname.endsWith(".pinar.dev");
    }
    if (parsed.protocol !== "http:") return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return false;
    const port = Number(parsed.port || 80);
    return isHelperPort(port);
  } catch {
    return false;
  }
}

export function isPinarHelperOrigin(url: string) {
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

export function isTransientTabUrl(tabUrl: string) {
  return !tabUrl || tabUrl === "about:blank";
}

export function tabUrlAllowedForSession(pageUrl: string, tabUrl: string) {
  const pageOrigin = originOf(pageUrl);
  const tabOrigin = originOf(tabUrl);
  return Boolean(pageOrigin && tabOrigin && pageOrigin === tabOrigin);
}

export function selectHydrateSession(requestedSessionId: string, session: ReopenSessionLike | null | undefined) {
  if (!requestedSessionId || !session) return null;
  if (session.id !== requestedSessionId && session.captureId !== requestedSessionId) return null;
  return {
    session,
    sessionId: session.id || requestedSessionId,
  };
}

export function planSessionReopen(input: {
  appUrl: string;
  requestedSessionId: string;
  session: ReopenSessionLike | null | undefined;
}) {
  if (!isPinarAppUrl(input.appUrl)) return { ok: false as const, error: "untrusted_app" };
  const selected = selectHydrateSession(input.requestedSessionId, input.session);
  if (!selected) return { ok: false as const, error: "session_mismatch" };
  const pageUrl = selected.session.page?.url;
  if (!pageUrl) return { ok: false as const, error: "missing_page" };
  return {
    ok: true as const,
    origin: originOf(pageUrl),
    pageUrl,
    sessionId: selected.sessionId,
  };
}

export function bindTabHydration<T>(
  map: Map<number, T>,
  tabId: number | null | undefined,
  binding: T,
) {
  if (tabId == null) return false;
  map.set(tabId, binding);
  return true;
}

export function dropHydrationIfTabLeftOrigin<T extends { pageUrl: string }>(
  hydrations: Map<number, T>,
  tabPins: Map<number, unknown>,
  tabId: number,
  tabUrl: string,
) {
  const binding = hydrations.get(tabId);
  if (!binding) return { dropped: false as const };
  if (isTransientTabUrl(tabUrl)) return { dropped: false as const };
  if (tabUrlAllowedForSession(binding.pageUrl, tabUrl)) return { dropped: false as const };
  hydrations.delete(tabId);
  tabPins.delete(tabId);
  return { dropped: true as const, reason: "origin_mismatch" as const };
}

export function withHistoricalAnchor<T extends HistoricalPin>(pin: T): T {
  return {
    ...pin,
    historicalAnchor: pin.historicalAnchor || pin.anchor,
    historicalBox: pin.historicalBox || pin.box,
  };
}

export function appendLocationHistory(
  history: LocationHistoryEntry[] | undefined,
  entry: LocationHistoryEntry,
) {
  return [...(history || []), entry];
}

export function applyLocatorToPin<T extends HistoricalPin>(
  pin: T,
  located: {
    anchor?: HistoricalPin["anchor"];
    at?: string;
    box?: HistoricalPin["box"];
    location: NonNullable<HistoricalPin["location"]>;
  },
): T {
  const frozen = withHistoricalAnchor(pin);
  const pending = located.location.confidence === "ambiguous" || located.location.confidence === "unresolved";
  const next: T = {
    ...frozen,
    location: located.location,
    locationHistory: appendLocationHistory(frozen.locationHistory, {
      at: located.at || new Date().toISOString(),
      confidence: located.location.confidence,
      source: "locator",
      strategy: located.location.strategy,
    }),
  };
  if (pending || !located.box) return next;
  return {
    ...next,
    anchor: located.anchor || next.anchor,
    box: located.box,
  };
}

export function applyManualReposition<T extends HistoricalPin>(
  pin: T,
  placed: {
    anchor?: HistoricalPin["anchor"];
    at?: string;
    box: NonNullable<HistoricalPin["box"]>;
  },
): T {
  const frozen = withHistoricalAnchor(pin);
  const anchor = placed.anchor || {
    x: placed.box.x + placed.box.width / 2,
    y: placed.box.y + placed.box.height / 2,
  };
  return {
    ...frozen,
    anchor,
    box: placed.box,
    location: {
      confidence: "exact",
      evidence: ["manual-reposition"],
      score: 1,
      strategy: "geometry",
    },
    locationHistory: appendLocationHistory(frozen.locationHistory, {
      at: placed.at || new Date().toISOString(),
      confidence: "exact",
      source: "manual",
      strategy: "geometry",
    }),
  };
}

export function historicalFieldsUntouched(original: HistoricalPin, next: HistoricalPin) {
  return original.selector === next.selector
    && original.path === next.path
    && original.fingerprint === next.fingerprint
    && JSON.stringify(original.historicalAnchor || original.anchor) === JSON.stringify(next.historicalAnchor)
    && JSON.stringify(original.historicalBox || original.box) === JSON.stringify(next.historicalBox);
}

export function requestReopenSession(sessionId: string, target: EventTarget = globalThis) {
  target.dispatchEvent(new CustomEvent(PINAR_REOPEN_SESSION_EVENT, { detail: { sessionId } }));
}
