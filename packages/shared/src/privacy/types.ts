export const REDACTION_PLACEHOLDER = "[redacted]";

export const REDACTED_CATEGORIES = [
  "password",
  "token",
  "secret-query",
  "secret-hash",
  "payment",
  "otp",
  "email",
  "unevaluated",
] as const;

export type RedactedCategory = (typeof REDACTED_CATEGORIES)[number];

export const DEFAULT_SENSITIVE_QUERY_KEYS = [
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
] as const;

export interface FieldAttrs {
  ariaLabel?: string;
  autocomplete?: string;
  id?: string;
  inputMode?: string;
  name?: string;
  role?: string;
  type?: string;
}

export interface SensitiveFieldSample {
  attrs: FieldAttrs;
  value?: string;
}

export interface PrivacyReport {
  redacted: RedactedCategory[];
  unevaluated: boolean;
}

export interface MaskRegion {
  box: {
    height: number;
    width: number;
    x: number;
    y: number;
  };
  category: RedactedCategory | "manual";
  id: string;
  source: "auto" | "user";
  unevaluated?: boolean;
}

export interface SanitizeCaptureInput {
  fields?: SensitiveFieldSample[];
  page?: {
    title?: string;
    url?: string;
    [key: string]: unknown;
  };
  pins?: unknown[];
  unevaluated?: boolean;
  warnings?: string[];
}

export interface SanitizeOptions {
  extraQueryKeys?: string[];
  extraHashKeys?: string[];
}

export interface SanitizeCaptureResult {
  page: {
    title: string;
    url: string;
    [key: string]: unknown;
  };
  pins: unknown[];
  privacy: PrivacyReport;
  warnings: string[];
}
