import {
  DEFAULT_SENSITIVE_QUERY_KEYS,
  type FieldAttrs,
  type RedactedCategory,
  REDACTED_CATEGORIES,
} from "./types.js";

const PASSWORD_AUTOCOMPLETE = /(?:^|[\s-])(?:current|new|one-time)?-?password(?:$|[\s-])/i;
const OTP_AUTOCOMPLETE = /one-time-code|otp/i;
const PAYMENT_AUTOCOMPLETE = /^cc-|^cc_|card(?:-number)?|cvv|cvc/i;
const TOKEN_NAME = /token|secret|api[_-]?key|authorization|auth[_-]?token|bearer|jwt|private[_-]?key/i;
const PAYMENT_NAME = /card(?:[_-]?number)?|credit[_-]?card|cvv|cvc|csc/i;
const OTP_NAME = /otp|one[_-]?time|totp|2fa|mfa/i;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const KEY_PATTERN =
  /\b(?:sk_live_|sk_test_|rk_live_|rk_test_|ghp_|gho_|github_pat_|xox[baprs]-|AIza)[A-Za-z0-9_\-]{8,}\b/g;

export function parseExtraKeys(raw?: string | string[]) {
  const values = Array.isArray(raw) ? raw : String(raw || "").split(/[\s,;]+/);
  return [...new Set(values.map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

export function sensitiveKeySet(extraKeys: string[] = []) {
  return new Set<string>([
    ...DEFAULT_SENSITIVE_QUERY_KEYS,
    ...extraKeys.map((item) => item.toLowerCase()),
  ]);
}

export function classifyFieldAttrs(attrs: FieldAttrs = {}): RedactedCategory | null {
  const type = String(attrs.type || "").toLowerCase();
  const autocomplete = String(attrs.autocomplete || "").toLowerCase();
  const haystack = [attrs.name, attrs.id, attrs.ariaLabel, attrs.role].filter(Boolean).join(" ");

  if (type === "password" || PASSWORD_AUTOCOMPLETE.test(autocomplete)) return "password";
  if (OTP_AUTOCOMPLETE.test(autocomplete) || OTP_NAME.test(haystack)) return "otp";
  if (PAYMENT_AUTOCOMPLETE.test(autocomplete) || PAYMENT_NAME.test(haystack)) return "payment";
  if (type === "email" || autocomplete === "email" || autocomplete.endsWith(" email")) return "email";
  if (TOKEN_NAME.test(haystack)) return "token";
  if (type === "hidden" && TOKEN_NAME.test(haystack)) return "token";
  return null;
}

export function looksLikeSecret(value: string) {
  const text = String(value || "");
  if (text.length < 12) return false;
  JWT_PATTERN.lastIndex = 0;
  KEY_PATTERN.lastIndex = 0;
  return JWT_PATTERN.test(text) || KEY_PATTERN.test(text);
}

export function collectSecretPatterns(value: string) {
  const text = String(value || "");
  const found: string[] = [];
  for (const pattern of [JWT_PATTERN, KEY_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match[0]) found.push(match[0]);
    }
  }
  return found;
}

export function mergeCategories(lists: Iterable<RedactedCategory | null | undefined>) {
  const present = new Set<RedactedCategory>();
  for (const item of lists) {
    if (item && (REDACTED_CATEGORIES as readonly string[]).includes(item)) present.add(item);
  }
  return REDACTED_CATEGORIES.filter((item) => present.has(item));
}
