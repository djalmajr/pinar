export {
  DEFAULT_SENSITIVE_QUERY_KEYS,
  REDACTED_CATEGORIES,
  REDACTION_PLACEHOLDER,
} from "./types.js";
export type {
  FieldAttrs,
  MaskRegion,
  PrivacyReport,
  RedactedCategory,
  SanitizeCaptureInput,
  SanitizeCaptureResult,
  SanitizeOptions,
  SensitiveFieldSample,
} from "./types.js";
export {
  classifyFieldAttrs,
  collectSecretPatterns,
  looksLikeSecret,
  mergeCategories,
  parseExtraKeys,
  sensitiveKeySet,
} from "./classify.js";
export {
  privacyWarnings,
  redactString,
  sanitizeCapture,
  sanitizeUrl,
  sanitizeValue,
} from "./sanitize.js";
