(() => {
  const REDACTION_PLACEHOLDER = "[redacted]";
  const REDACTED_CATEGORIES = [
    "password",
    "token",
    "secret-query",
    "secret-hash",
    "payment",
    "otp",
    "email",
    "unevaluated",
  ];
  const DEFAULT_SENSITIVE_QUERY_KEYS = [
    "access_token",
    "api-key",
    "apikey",
    "api_key",
    "auth",
    "auth_token",
    "authorization",
    "bearer",
    "client_secret",
    "code",
    "id_token",
    "jwt",
    "password",
    "passwd",
    "private_key",
    "refresh_token",
    "secret",
    "session",
    "session_id",
    "sessionid",
    "token",
  ];
  const PASSWORD_AUTOCOMPLETE = /(?:^|[\s-])(?:current|new|one-time)?-?password(?:$|[\s-])/i;
  const OTP_AUTOCOMPLETE = /one-time-code|otp/i;
  const PAYMENT_AUTOCOMPLETE = /^cc-|^cc_|card(?:-number)?|cvv|cvc/i;
  const TOKEN_NAME = /token|secret|api[_-]?key|authorization|auth[_-]?token|bearer|jwt|private[_-]?key/i;
  const PAYMENT_NAME = /card(?:[_-]?number)?|credit[_-]?card|cvv|cvc|csc/i;
  const OTP_NAME = /otp|one[_-]?time|totp|2fa|mfa/i;
  const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
  const KEY_PATTERN =
    /\b(?:sk_live_|sk_test_|rk_live_|rk_test_|ghp_|gho_|github_pat_|xox[baprs]-|AIza)[A-Za-z0-9_\-]{8,}\b/g;
  const MIN_SECRET_LENGTH = 4;
  const SENSITIVE_SELECTOR = "input, textarea, select";

  function parseExtraKeys(raw) {
    const values = Array.isArray(raw) ? raw : String(raw || "").split(/[\s,;]+/);
    return [...new Set(values.map((item) => item.trim().toLowerCase()).filter(Boolean))];
  }

  function sensitiveKeySet(extraKeys = []) {
    return new Set([...DEFAULT_SENSITIVE_QUERY_KEYS, ...extraKeys.map((item) => String(item).toLowerCase())]);
  }

  function classifyFieldAttrs(attrs = {}) {
    const type = String(attrs.type || "").toLowerCase();
    const autocomplete = String(attrs.autocomplete || "").toLowerCase();
    const haystack = [attrs.name, attrs.id, attrs.ariaLabel, attrs.role].filter(Boolean).join(" ");
    if (type === "password" || PASSWORD_AUTOCOMPLETE.test(autocomplete)) return "password";
    if (OTP_AUTOCOMPLETE.test(autocomplete) || OTP_NAME.test(haystack)) return "otp";
    if (PAYMENT_AUTOCOMPLETE.test(autocomplete) || PAYMENT_NAME.test(haystack)) return "payment";
    if (type === "email" || autocomplete === "email") return "email";
    if (TOKEN_NAME.test(haystack)) return "token";
    return null;
  }

  function looksLikeSecret(value) {
    const text = String(value || "");
    if (text.length < 12) return false;
    JWT_PATTERN.lastIndex = 0;
    KEY_PATTERN.lastIndex = 0;
    return JWT_PATTERN.test(text) || KEY_PATTERN.test(text);
  }

  function collectSecretPatterns(value) {
    const text = String(value || "");
    const found = [];
    for (const pattern of [JWT_PATTERN, KEY_PATTERN]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (match[0]) found.push(match[0]);
      }
    }
    return found;
  }

  function mergeCategories(lists) {
    const present = new Set();
    for (const item of lists) {
      if (item && REDACTED_CATEGORIES.includes(item)) present.add(item);
    }
    return REDACTED_CATEGORIES.filter((item) => present.has(item));
  }

  function uniqueSecrets(values) {
    const seen = new Set();
    const secrets = [];
    for (const value of values) {
      const secret = String(value || "");
      if (secret.length < MIN_SECRET_LENGTH || seen.has(secret)) continue;
      seen.add(secret);
      secrets.push(secret);
    }
    secrets.sort((left, right) => right.length - left.length);
    return secrets;
  }

  function redactString(value, secrets) {
    let text = String(value ?? "");
    for (const secret of secrets) {
      if (!secret || !text.includes(secret)) continue;
      text = text.split(secret).join(REDACTION_PLACEHOLDER);
    }
    return text;
  }

  function sanitizeValue(value, secrets) {
    if (typeof value === "string") return redactString(value, secrets);
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, secrets));
    if (value && typeof value === "object") {
      const record = {};
      for (const [key, item] of Object.entries(value)) record[key] = sanitizeValue(item, secrets);
      return record;
    }
    return value;
  }

  function hashAsParams(hash) {
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!raw.includes("=")) return null;
    try {
      return new URLSearchParams(raw);
    } catch {
      return null;
    }
  }

  function sanitizeUrl(raw, extraKeys = []) {
    const secrets = [];
    const redacted = [];
    const keys = sensitiveKeySet(extraKeys);
    const fallback = { redacted, secrets, url: String(raw || "") };
    if (!raw) return fallback;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return fallback;
    }
    for (const [key, value] of [...parsed.searchParams]) {
      if (!value) continue;
      if (keys.has(key.toLowerCase()) || looksLikeSecret(value)) {
        secrets.push(value);
        parsed.searchParams.set(key, REDACTION_PLACEHOLDER);
        redacted.push(keys.has(key.toLowerCase()) ? "secret-query" : "token");
      }
    }
    if (parsed.hash) {
      const params = hashAsParams(parsed.hash);
      if (params) {
        let changed = false;
        for (const [key, value] of [...params]) {
          if (!value) continue;
          if (keys.has(key.toLowerCase()) || looksLikeSecret(value)) {
            secrets.push(value);
            params.set(key, REDACTION_PLACEHOLDER);
            redacted.push("secret-hash");
            changed = true;
          }
        }
        if (changed) parsed.hash = params.toString();
      } else {
        const hash = parsed.hash.slice(1);
        if (hash && (looksLikeSecret(hash) || keys.has(hash.toLowerCase()))) {
          secrets.push(hash);
          parsed.hash = REDACTION_PLACEHOLDER;
          redacted.push("secret-hash");
        }
      }
    }
    return { redacted: mergeCategories(redacted), secrets: uniqueSecrets(secrets), url: parsed.toString() };
  }

  function collectFromFields(fields = []) {
    const secrets = [];
    const redacted = [];
    for (const field of fields) {
      const category = classifyFieldAttrs(field.attrs || {});
      if (!category) continue;
      redacted.push(category);
      if (field.value) secrets.push(field.value);
    }
    return { redacted, secrets };
  }

  function collectFromUnknown(value, secrets) {
    if (typeof value === "string") {
      secrets.push(...collectSecretPatterns(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectFromUnknown(item, secrets);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) collectFromUnknown(item, secrets);
    }
  }

  function privacyWarnings(report) {
    const warnings = [];
    if (report.redacted.some((item) => item !== "unevaluated")) warnings.push("privacy_redacted");
    if (report.unevaluated) warnings.push("privacy_unevaluated");
    return warnings;
  }

  function sanitizeCapture(input = {}, options = {}) {
    const pageIn = input.page && typeof input.page === "object" ? { ...input.page } : {};
    const extraKeys = [...(options.extraQueryKeys || []), ...(options.extraHashKeys || [])];
    const urlResult = sanitizeUrl(typeof pageIn.url === "string" ? pageIn.url : "", extraKeys);
    const fieldResult = collectFromFields(input.fields);
    const patternSecrets = [...urlResult.secrets];
    collectFromUnknown(pageIn.title, patternSecrets);
    collectFromUnknown(input.pins, patternSecrets);
    const secrets = uniqueSecrets([...urlResult.secrets, ...fieldResult.secrets, ...patternSecrets]);
    const unevaluated = input.unevaluated === true;
    const redacted = mergeCategories([
      ...urlResult.redacted,
      ...fieldResult.redacted,
      ...(unevaluated ? ["unevaluated"] : []),
    ]);
    const privacy = { redacted, unevaluated };
    const page = sanitizeValue({
      ...pageIn,
      title: typeof pageIn.title === "string" ? pageIn.title : "",
      url: urlResult.url,
    }, secrets);
    const pins = sanitizeValue(input.pins || [], secrets);
    const warnings = [...new Set([
      ...(Array.isArray(input.warnings) ? input.warnings.filter((item) => typeof item === "string") : []),
      ...privacyWarnings(privacy),
    ])];
    return { page, pins, privacy, warnings };
  }

  function fieldAttrsOf(element) {
    return {
      ariaLabel: element.getAttribute?.("aria-label") || "",
      autocomplete: element.getAttribute?.("autocomplete") || element.autocomplete || "",
      id: element.id || "",
      inputMode: element.getAttribute?.("inputmode") || "",
      name: element.getAttribute?.("name") || "",
      role: element.getAttribute?.("role") || "",
      type: (element.getAttribute?.("type") || element.type || "").toLowerCase(),
    };
  }

  function viewportBoxOf(element, offset) {
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width < 2 || rect.height < 2) return null;
    return {
      height: Math.max(1, Math.round(rect.height)),
      width: Math.max(1, Math.round(rect.width)),
      x: Math.round(rect.left + (offset?.x || 0)),
      y: Math.round(rect.top + (offset?.y || 0)),
    };
  }

  function scanDocumentTree(root, offset, into) {
    if (!root?.querySelectorAll) return;
    for (const element of root.querySelectorAll(SENSITIVE_SELECTOR)) {
      const attrs = fieldAttrsOf(element);
      const category = classifyFieldAttrs(attrs);
      if (!category) continue;
      const value = typeof element.value === "string" ? element.value : "";
      into.fields.push({ attrs, value });
      const box = viewportBoxOf(element, offset);
      if (!box) continue;
      into.masks.push({
        box,
        category,
        id: `auto:${category}:${attrs.id || attrs.name || into.masks.length}`,
        source: "auto",
      });
    }
    for (const frame of root.querySelectorAll("iframe,frame")) {
      let child = null;
      try {
        child = frame.contentDocument;
      } catch {
        child = null;
      }
      if (!child) {
        into.unevaluated = true;
        continue;
      }
      scanDocumentTree(child, {
        x: Math.round((offset?.x || 0) + (frame.getBoundingClientRect?.().left || 0)),
        y: Math.round((offset?.y || 0) + (frame.getBoundingClientRect?.().top || 0)),
      }, into);
    }
  }

  function scanSensitiveDocuments(root = document) {
    const into = { fields: [], masks: [], unevaluated: false };
    scanDocumentTree(root, { x: 0, y: 0 }, into);
    return into;
  }

  function documentBoxes(masks, scroll) {
    return (masks || []).map((mask) => ({
      ...mask,
      box: {
        ...mask.box,
        x: mask.box.x + (scroll?.x || 0),
        y: mask.box.y + (scroll?.y || 0),
      },
    }));
  }

  globalThis.__pinarPrivacy = Object.freeze({
    REDACTION_PLACEHOLDER,
    classifyFieldAttrs,
    documentBoxes,
    parseExtraKeys,
    scanSensitiveDocuments,
    sanitizeCapture,
    sanitizeUrl,
  });
})();
