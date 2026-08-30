import { classifyFieldAttrs, collectSecretPatterns, looksLikeSecret, mergeCategories, sensitiveKeySet } from "./classify.js";
import {
  REDACTION_PLACEHOLDER,
  type PrivacyReport,
  type RedactedCategory,
  type SanitizeCaptureInput,
  type SanitizeCaptureResult,
  type SanitizeOptions,
} from "./types.js";

const MIN_SECRET_LENGTH = 4;

function uniqueSecrets(values: Iterable<string>) {
  const seen = new Set<string>();
  const secrets: string[] = [];
  for (const value of values) {
    const secret = String(value || "");
    if (secret.length < MIN_SECRET_LENGTH || seen.has(secret)) continue;
    seen.add(secret);
    secrets.push(secret);
  }
  secrets.sort((left, right) => right.length - left.length);
  return secrets;
}

export function redactString(value: string, secrets: string[]) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (!secret || !text.includes(secret)) continue;
    text = text.split(secret).join(REDACTION_PLACEHOLDER);
  }
  return text;
}

export function sanitizeValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, secrets));
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      record[key] = sanitizeValue(item, secrets);
    }
    return record;
  }
  return value;
}

function hashAsParams(hash: string) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.includes("=")) return null;
  try {
    return new URLSearchParams(raw);
  } catch {
    return null;
  }
}

export function sanitizeUrl(raw: string, extraKeys: string[] = []) {
  const secrets: string[] = [];
  const redacted: RedactedCategory[] = [];
  const keys = sensitiveKeySet(extraKeys);
  const fallback = { redacted, secrets, url: String(raw || "") };
  if (!raw) return fallback;
  let parsed: URL;
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

  return {
    redacted: mergeCategories(redacted),
    secrets: uniqueSecrets(secrets),
    url: parsed.toString(),
  };
}

function collectFromFields(fields: SanitizeCaptureInput["fields"] = []) {
  const secrets: string[] = [];
  const redacted: RedactedCategory[] = [];
  for (const field of fields) {
    const category = classifyFieldAttrs(field.attrs);
    if (!category) continue;
    redacted.push(category);
    if (field.value) secrets.push(field.value);
  }
  return { redacted, secrets };
}

function collectFromUnknown(value: unknown, secrets: string[]) {
  if (typeof value === "string") {
    secrets.push(...collectSecretPatterns(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFromUnknown(item, secrets);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectFromUnknown(item, secrets);
  }
}

export function privacyWarnings(report: PrivacyReport) {
  const warnings: string[] = [];
  if (report.redacted.some((item) => item !== "unevaluated")) warnings.push("privacy_redacted");
  if (report.unevaluated) warnings.push("privacy_unevaluated");
  return warnings;
}

export function sanitizeCapture(
  input: SanitizeCaptureInput = {},
  options: SanitizeOptions = {},
): SanitizeCaptureResult {
  const pageIn = input.page && typeof input.page === "object" ? { ...input.page } : {};
  const extraKeys = [...(options.extraQueryKeys ?? []), ...(options.extraHashKeys ?? [])];
  const urlResult = sanitizeUrl(typeof pageIn.url === "string" ? pageIn.url : "", extraKeys);
  const fieldResult = collectFromFields(input.fields);
  const patternSecrets: string[] = [...urlResult.secrets];
    collectFromUnknown(pageIn.title, patternSecrets);
    collectFromUnknown(pageIn.description, patternSecrets);
  collectFromUnknown(input.pins, patternSecrets);
  const secrets = uniqueSecrets([...urlResult.secrets, ...fieldResult.secrets, ...patternSecrets]);

  const unevaluated = input.unevaluated === true;
  const redacted = mergeCategories([
    ...urlResult.redacted,
    ...fieldResult.redacted,
    ...(unevaluated ? ["unevaluated" as const] : []),
  ]);
  const privacy: PrivacyReport = { redacted, unevaluated };
  const page = sanitizeValue({
    ...pageIn,
    ...(typeof pageIn.description === "string" ? { description: pageIn.description } : {}),
    title: typeof pageIn.title === "string" ? pageIn.title : "",
    url: urlResult.url,
  }, secrets) as SanitizeCaptureResult["page"];
  page.title = typeof page.title === "string" ? page.title : "";
  page.url = typeof page.url === "string" ? page.url : urlResult.url;
  if (typeof page.description === "string") page.description = page.description.trim();
  else delete page.description;

  const pins = sanitizeValue(input.pins ?? [], secrets) as unknown[];
  const warnings = [...new Set([
    ...(Array.isArray(input.warnings) ? input.warnings.filter((item): item is string => typeof item === "string") : []),
    ...privacyWarnings(privacy),
  ])];

  return { page, pins, privacy, warnings };
}
