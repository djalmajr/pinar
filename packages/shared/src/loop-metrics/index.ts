export const DEFAULT_LOOP_METRICS_OPT_IN = false;

export const LOOP_METRIC_AGENTS = ["claude", "codex", "cursor", "grok"] as const;
export type LoopMetricAgent = (typeof LOOP_METRIC_AGENTS)[number];

export const LOOP_METRIC_EVENTS = [
  "accepted",
  "correction_ready",
  "handoff",
  "relocation_failed",
  "reopened",
] as const;

export type LoopMetricEventName = (typeof LOOP_METRIC_EVENTS)[number];

export const LOOP_METRIC_CONFIDENCE = ["ambiguous", "exact", "probable", "unresolved"] as const;
export type LoopMetricConfidence = (typeof LOOP_METRIC_CONFIDENCE)[number];

export const LOOP_METRIC_ALLOWED_KEYS = [
  "agent",
  "degraded",
  "durationMs",
  "event",
  "locationConfidence",
] as const;

export const LOOP_METRIC_FORBIDDEN_KEYS = [
  "captureId",
  "comment",
  "comments",
  "content",
  "dom",
  "html",
  "image",
  "markdown",
  "page",
  "path",
  "pin",
  "pinId",
  "pins",
  "screenshot",
  "screenshots",
  "selector",
  "selectors",
  "sessionId",
  "shot",
  "text",
  "title",
  "url",
  "urls",
] as const;

export const LOOP_METRIC_ERROR_CODES = [
  "forbidden_fields",
  "invalid_payload",
  "opt_in_off",
] as const;

export type LoopMetricErrorCode = (typeof LOOP_METRIC_ERROR_CODES)[number];

export class LoopMetricError extends Error {
  readonly code: LoopMetricErrorCode;

  constructor(code: LoopMetricErrorCode) {
    super("invalid loop metric");
    this.name = "LoopMetricError";
    this.code = code;
  }
}

export interface LoopMetric {
  agent?: LoopMetricAgent;
  degraded?: boolean;
  durationMs?: number;
  event: LoopMetricEventName;
  locationConfidence?: LoopMetricConfidence;
}

export type LoopMetricPlan =
  | { events: LoopMetric[]; send: true }
  | { reason: LoopMetricErrorCode; send: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopMetricEventName(value: unknown): value is LoopMetricEventName {
  return typeof value === "string" && (LOOP_METRIC_EVENTS as readonly string[]).includes(value);
}

function isLoopMetricAgent(value: unknown): value is LoopMetricAgent {
  return typeof value === "string" && (LOOP_METRIC_AGENTS as readonly string[]).includes(value);
}

function isConfidence(value: unknown): value is LoopMetricConfidence {
  return typeof value === "string" && (LOOP_METRIC_CONFIDENCE as readonly string[]).includes(value);
}

function looksLikeContent(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:")) return true;
  if (trimmed.includes("{") || trimmed.includes("<")) return true;
  return false;
}

export function loopMetricHasForbiddenFields(value: unknown): boolean {
  if (!isRecord(value)) return true;
  const keys = Object.keys(value);
  if (keys.some((key) => (LOOP_METRIC_FORBIDDEN_KEYS as readonly string[]).includes(key))) return true;
  if (keys.some((key) => !(LOOP_METRIC_ALLOWED_KEYS as readonly string[]).includes(key))) return true;
  return Object.values(value).some(looksLikeContent);
}

export function sanitizeLoopMetric(value: unknown): LoopMetric {
  if (loopMetricHasForbiddenFields(value) || !isRecord(value) || !isLoopMetricEventName(value.event)) {
    throw new LoopMetricError("forbidden_fields");
  }
  const metric: LoopMetric = { event: value.event };
  if (value.agent !== undefined) {
    if (!isLoopMetricAgent(value.agent)) throw new LoopMetricError("invalid_payload");
    metric.agent = value.agent;
  }
  if (value.degraded !== undefined) {
    if (typeof value.degraded !== "boolean") throw new LoopMetricError("invalid_payload");
    metric.degraded = value.degraded;
  }
  if (value.durationMs !== undefined) {
    const durationMs = value.durationMs;
    if (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs < 0 || durationMs > 86_400_000) {
      throw new LoopMetricError("invalid_payload");
    }
    metric.durationMs = durationMs;
  }
  if (value.locationConfidence !== undefined) {
    if (!isConfidence(value.locationConfidence)) throw new LoopMetricError("invalid_payload");
    metric.locationConfidence = value.locationConfidence;
  }
  return metric;
}

export function planLoopMetricRequest(optIn: unknown, events: unknown): LoopMetricPlan {
  if (optIn !== true) return { reason: "opt_in_off", send: false };
  if (!Array.isArray(events) || events.length === 0) return { reason: "invalid_payload", send: false };
  try {
    return { events: events.map(sanitizeLoopMetric), send: true };
  } catch (error) {
    if (error instanceof LoopMetricError) return { reason: error.code, send: false };
    return { reason: "invalid_payload", send: false };
  }
}

export function loopMetricErrorBody(error: LoopMetricError) {
  return { error: error.code, ok: false as const };
}

export function loopMetricHttpStatus(error: LoopMetricError) {
  if (error.code === "opt_in_off") return 200;
  if (error.code === "forbidden_fields") return 400;
  return 400;
}
