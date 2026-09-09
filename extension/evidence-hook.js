// Technical evidence hook (DJA-174). Runs in the page's MAIN world, where the
// page's own console.error calls, uncaught errors, rejected promises and
// fetch/XHR failures are visible. It never stores anything itself: each fact
// is handed to the isolated world (extension/evidence.js) as a JSON string on
// a DOM event, and the pin decides later what is relevant. No console.log,
// no console.warn, no request or response bodies.
(() => {
  if (globalThis.__pinarEvidenceHook) return;
  const EVENT = "pinar:evidence";
  const MAX_TEXT = 500;
  const MAX_STACK = 1_200;

  function clip(value, max) {
    const text = String(value ?? "");
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function describe(value) {
    if (value instanceof Error) return value.message || value.name;
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function stackOf(value) {
    return value instanceof Error && typeof value.stack === "string" ? clip(value.stack, MAX_STACK) : undefined;
  }

  function emit(fact) {
    try {
      document.dispatchEvent(new CustomEvent(EVENT, { detail: JSON.stringify({ at: Date.now(), ...fact }) }));
    } catch {
      /* A detached document has nobody to tell. */
    }
  }

  function requestUrl(input) {
    try {
      if (typeof input === "string") return new URL(input, location.href).href;
      if (input instanceof URL) return input.href;
      if (input && typeof input.url === "string") return new URL(input.url, location.href).href;
    } catch {
      /* Unparseable request targets are reported without a URL. */
    }
    return "";
  }

  function crossOrigin(url) {
    try {
      return new URL(url).origin !== location.origin;
    } catch {
      return false;
    }
  }

  window.addEventListener("error", (event) => {
    if (!(event instanceof ErrorEvent)) {
      // Resource errors (img, script) arrive as plain events on the target.
      const target = event.target;
      const url = target?.src || target?.href;
      if (typeof url === "string" && url) emit({ kind: "network", message: `Failed to load ${target.tagName?.toLowerCase() || "resource"}`, url });
      return;
    }
    emit({
      kind: "error",
      message: clip(event.message || describe(event.error), MAX_TEXT),
      stack: stackOf(event.error),
      url: event.filename || undefined,
    });
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    emit({
      kind: "unhandled_rejection",
      message: clip(describe(event.reason), MAX_TEXT),
      stack: stackOf(event.reason),
    });
  });

  const originalError = console.error;
  console.error = function pinarConsoleError(...args) {
    try {
      emit({
        kind: "console_error",
        message: clip(args.map(describe).join(" "), MAX_TEXT),
        stack: args.map(stackOf).find(Boolean),
      });
    } catch {
      /* Never let telemetry break the page's own logging. */
    }
    return originalError.apply(this, args);
  };

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = function pinarFetch(input, init) {
      const url = requestUrl(input);
      const method = String(init?.method || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
      return originalFetch.call(this, input, init).then((response) => {
        if (response && response.status >= 400) emit({ kind: "http", method, status: response.status, url });
        return response;
      }, (error) => {
        emit({
          kind: error instanceof TypeError && crossOrigin(url) ? "cors" : "network",
          message: clip(describe(error), MAX_TEXT),
          method,
          url,
        });
        throw error;
      });
    };
  }

  const XHR = globalThis.XMLHttpRequest;
  if (XHR?.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function pinarOpen(method, url, ...rest) {
      this.__pinarRequest = { method: String(method || "GET").toUpperCase(), url: requestUrl(url) };
      return open.call(this, method, url, ...rest);
    };
    XHR.prototype.send = function pinarSend(...args) {
      const request = this.__pinarRequest || { method: "GET", url: "" };
      this.addEventListener("loadend", () => {
        if (this.status >= 400) emit({ kind: "http", method: request.method, status: this.status, url: request.url });
        else if (this.status === 0) {
          emit({
            kind: crossOrigin(request.url) ? "cors" : "network",
            message: "Request failed",
            method: request.method,
            url: request.url,
          });
        }
      }, { once: true });
      return send.apply(this, args);
    };
  }

  globalThis.__pinarEvidenceHook = Object.freeze({ EVENT, installedAt: Date.now() });
})();
