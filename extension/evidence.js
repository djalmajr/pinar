// Technical evidence store (Visual Context v1 `pin.evidence`, DJA-174).
// Isolated world companion of evidence-hook.js: keeps a bounded ring buffer
// of the facts the hook reports for this frame, remembers the user's recent
// interactions with page elements, and at pin time filters and grades them.
// Grades are computed, never inferred:
//   after_interaction  the fact happened within the window after the user
//                      clicked or typed into the pinned element
//   same_page          the fact happened on this page during the session
// Keep the limits in sync with EVIDENCE_LIMITS in packages/shared.
(() => {
  const VERSION = 1;
  const EVENT = "pinar:evidence";
  const LIMITS = Object.freeze({
    interactionWindowMs: 2_000,
    maxBytes: 48_000,
    maxInteractions: 50,
    maxItems: 40,
    maxMessageLength: 500,
    maxStackLength: 1_200,
    maxUrlLength: 500,
    ringSize: 200,
  });
  const KINDS = new Set(["console_error", "cors", "error", "http", "network", "unhandled_rejection"]);

  function clip(value, max) {
    const text = String(value ?? "");
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function createStore({ now = () => Date.now(), origin = () => location.origin, frame = () => (window === window.top ? "top" : "child") } = {}) {
    const facts = [];
    const interactions = [];
    let sessionStartedAt = now();

    function record(raw) {
      let fact = raw;
      if (typeof raw === "string") {
        try {
          fact = JSON.parse(raw);
        } catch {
          return false;
        }
      }
      if (!fact || typeof fact !== "object" || !KINDS.has(fact.kind)) return false;
      const entry = {
        at: Number.isFinite(fact.at) ? fact.at : now(),
        kind: fact.kind,
      };
      if (typeof fact.message === "string" && fact.message) entry.message = clip(fact.message, LIMITS.maxMessageLength);
      if (typeof fact.method === "string" && fact.method) entry.method = fact.method.toUpperCase();
      if (typeof fact.stack === "string" && fact.stack) entry.stack = clip(fact.stack, LIMITS.maxStackLength);
      if (Number.isFinite(fact.status)) entry.status = Math.trunc(fact.status);
      if (typeof fact.url === "string" && fact.url) entry.url = fact.url;
      facts.push(entry);
      if (facts.length > LIMITS.ringSize) facts.splice(0, facts.length - LIMITS.ringSize);
      return true;
    }

    function interact(target, at = now()) {
      if (!target || typeof target !== "object") return;
      interactions.push({ at, target });
      if (interactions.length > LIMITS.maxInteractions) interactions.splice(0, interactions.length - LIMITS.maxInteractions);
    }

    function related(element, target) {
      if (!element || !target) return false;
      if (element === target) return true;
      try {
        return Boolean(element.contains?.(target) || target.contains?.(element));
      } catch {
        return false;
      }
    }

    function lastInteractionWith(element) {
      for (let index = interactions.length - 1; index >= 0; index -= 1) {
        if (related(element, interactions[index].target)) return interactions[index].at;
      }
      return null;
    }

    function grade(at, interactionAt) {
      if (interactionAt !== null && at >= interactionAt && at - interactionAt <= LIMITS.interactionWindowMs) {
        return "after_interaction";
      }
      return "same_page";
    }

    /**
     * @param {Element | null} element pinned element, null for area pins
     * @param {{ redactUrl?: (url: string) => string, until?: number }} [options]
     */
    function collect(element, options = {}) {
      const until = options.until ?? now();
      const redactUrl = options.redactUrl || ((url) => url);
      const interactionAt = element ? lastInteractionWith(element) : null;
      const pageOrigin = origin();
      const frameName = frame();
      const items = [];
      for (const fact of facts) {
        if (fact.at < sessionStartedAt || fact.at > until) continue;
        const item = {
          at: new Date(fact.at).toISOString(),
          frame: frameName,
          grade: grade(fact.at, interactionAt),
          kind: fact.kind,
          origin: pageOrigin,
        };
        if (fact.message) item.message = fact.message;
        if (fact.method) item.method = fact.method;
        if (fact.stack) item.stack = fact.stack;
        if (fact.status !== undefined) item.status = fact.status;
        if (fact.url) item.url = clip(redactUrl(fact.url), LIMITS.maxUrlLength);
        items.push(item);
      }
      if (!items.length) return undefined;
      // Newest first within each grade; the strongest link stays when trimming.
      items.sort((left, right) => (left.grade === right.grade ? right.at.localeCompare(left.at) : left.grade === "after_interaction" ? -1 : 1));
      const kept = items.slice(0, LIMITS.maxItems);
      while (kept.length > 1 && JSON.stringify(kept).length > LIMITS.maxBytes) kept.pop();
      return { environment: environment(), items: kept, version: VERSION };
    }

    function reset() {
      facts.length = 0;
      interactions.length = 0;
      sessionStartedAt = now();
    }

    return Object.freeze({
      collect,
      facts,
      interact,
      interactions,
      lastInteractionWith,
      record,
      reset,
    });
  }

  function browserName() {
    const brands = navigator.userAgentData?.brands || [];
    const brand = brands.find((item) => !/not.?a.?brand|chromium/i.test(item.brand)) || brands.find((item) => /chromium/i.test(item.brand));
    if (brand) return `${brand.brand} ${brand.version}`;
    const match = navigator.userAgent?.match(/(Edg|OPR|Chrome|Firefox|Safari)\/(\d+)/);
    return match ? `${match[1] === "Edg" ? "Edge" : match[1] === "OPR" ? "Opera" : match[1]} ${match[2]}` : undefined;
  }

  function environment() {
    const env = {};
    const browser = browserName();
    if (browser) env.browser = browser;
    if (Number.isFinite(window.devicePixelRatio)) env.devicePixelRatio = window.devicePixelRatio;
    if (navigator.language) env.language = navigator.language;
    if (typeof navigator.onLine === "boolean") env.online = navigator.onLine;
    const platform = navigator.userAgentData?.platform || navigator.platform;
    if (platform) env.platform = platform;
    try {
      env.theme = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
    } catch {
      /* matchMedia may be unavailable in exotic contexts. */
    }
    if (window.innerWidth && window.innerHeight) env.viewport = { height: window.innerHeight, width: window.innerWidth };
    return env;
  }

  const store = createStore();
  const facts = [];
  // Facts reported before content.js consumed the hook are not lost: the
  // listener starts with the script, the same tick the hook is installed.
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener(EVENT, (event) => {
      store.record(typeof event.detail === "string" ? event.detail : "");
    });
  }
  void facts;

  globalThis.__pinarEvidence = Object.freeze({
    EVENT,
    LIMITS,
    VERSION,
    createStore,
    environment,
    store,
  });
})();
