import type { Box, PageInfo, Pin, Point, PrivacyReport, RedactedCategory, Session } from "../types/index.js";
import type { PinLocation, VisualFingerprint } from "../locators/types.js";

export const VISUAL_CONTEXT_SCHEMA_VERSION = 1 as const;

export const VISUAL_CONTEXT_ERROR_CODES = [
  "invalid_payload",
  "invalid_pin",
  "missing_capture_id",
  "unsupported_schema",
] as const;

export type VisualContextErrorCode = (typeof VISUAL_CONTEXT_ERROR_CODES)[number];

export class VisualContextError extends Error {
  readonly code: VisualContextErrorCode;

  constructor(code: VisualContextErrorCode) {
    super("invalid visual context");
    this.name = "VisualContextError";
    this.code = code;
  }
}

export interface VisualViewport {
  devicePixelRatio: number;
  height: number;
  scrollX: number;
  scrollY: number;
  width: number;
}

export interface VisualLocator {
  cssSelector?: string;
  domPath?: string;
  fingerprint?: VisualFingerprint;
  innerText?: string;
  label?: string;
  tag?: string;
}

export interface VisualGeometry {
  box?: Box;
  documentBox?: Box;
  documentPoint?: Point;
  point: Point;
  viewportAnchored?: boolean;
  viewportBox?: Box;
  viewportPoint?: Point;
}

export interface VisualScreenshot {
  height?: number;
  id?: string;
  mimeType?: "image/png";
  missing: boolean;
  url?: string | null;
  width?: number;
}

export interface VisualCapabilities {
  fullPage?: boolean;
  iframe?: boolean;
}

export interface VisualPin extends Pin {
  geometry: VisualGeometry;
  locator: VisualLocator;
  pinId: string;
}

export interface VisualCapture {
  capabilities?: VisualCapabilities;
  captureId: string;
  createdAt?: string;
  page: PageInfo;
  pins: VisualPin[];
  privacy?: PrivacyReport;
  schemaVersion: typeof VISUAL_CONTEXT_SCHEMA_VERSION;
  screenshot: VisualScreenshot;
  viewport?: VisualViewport;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asPoint(value: unknown): Point | undefined {
  if (!isRecord(value)) return undefined;
  const x = asFiniteNumber(value.x);
  const y = asFiniteNumber(value.y);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

function asBox(value: unknown): Box | undefined {
  const point = asPoint(value);
  if (!point || !isRecord(value)) return undefined;
  const width = asFiniteNumber(value.width);
  const height = asFiniteNumber(value.height);
  if (width === undefined || height === undefined) return undefined;
  return { ...point, width, height };
}

export function stableLegacyPinId(captureId: string, number: number) {
  return `${captureId}:p${number}`;
}

function pinNumber(value: Record<string, unknown>, index: number) {
  const number = asFiniteNumber(value.number);
  return number && number > 0 ? Math.trunc(number) : index + 1;
}

function pinKind(value: Record<string, unknown>): VisualPin["kind"] {
  if (value.kind === "area" || value.type === "area") return "area";
  return "element";
}

function pinType(value: Record<string, unknown>): VisualPin["type"] {
  if (value.type === "area" || value.kind === "area") return "area";
  return "point";
}

function asFingerprint(value: unknown): VisualFingerprint | undefined {
  if (!isRecord(value)) return undefined;
  const classes = Array.isArray(value.classes)
    ? value.classes.filter((item): item is string => typeof item === "string")
    : undefined;
  const fingerprint: VisualFingerprint = {
    classes: classes?.length ? classes : undefined,
    id: asString(value.id) || undefined,
    name: asString(value.name) || undefined,
    nthOfType: asFiniteNumber(value.nthOfType),
    role: asString(value.role) || undefined,
    tag: asString(value.tag) || undefined,
    testId: asString(value.testId) || undefined,
    text: asString(value.text) || undefined,
  };
  if (!Object.values(fingerprint).some((item) => item != null && item !== "")) return undefined;
  return fingerprint;
}

function asLocation(value: unknown): PinLocation | undefined {
  if (!isRecord(value)) return undefined;
  const confidence = value.confidence;
  const strategy = value.strategy;
  if (
    confidence !== "exact"
    && confidence !== "probable"
    && confidence !== "ambiguous"
    && confidence !== "unresolved"
  ) return undefined;
  if (
    strategy !== "stable-selector"
    && strategy !== "structure"
    && strategy !== "semantic"
    && strategy !== "geometry"
    && strategy !== "none"
  ) return undefined;
  return {
    confidence,
    evidence: Array.isArray(value.evidence)
      ? value.evidence.filter((item): item is string => typeof item === "string")
      : [],
    score: asFiniteNumber(value.score) ?? 0,
    strategy,
    warning: value.warning === "cross-origin-frame" ? "cross-origin-frame" : undefined,
  };
}

export function normalizePin(value: unknown, captureId: string, index: number): VisualPin {
  if (!isRecord(value)) throw new VisualContextError("invalid_pin");
  const number = pinNumber(value, index);
  const kind = pinKind(value);
  const type = pinType(value);
  const existingId = asString(value.pinId) || asString(value.id);
  const pinId = existingId || stableLegacyPinId(captureId, number);
  const viewportPoint = asPoint(value.anchor);
  const documentPoint = asPoint(value.documentAnchor);
  const coords = asPoint(value.coords) || documentPoint || viewportPoint || asPoint(value.box) || { x: 0, y: 0 };
  const viewportBox = asBox(value.box);
  const documentBox = asBox(value.documentBox) || asBox(value.areaBox) || (kind === "area" ? viewportBox : undefined);
  const nestedLocator = isRecord(value.locator) ? value.locator : {};
  const fingerprint = asFingerprint(value.fingerprint) || asFingerprint(nestedLocator.fingerprint);
  const location = asLocation(value.location);
  const locator: VisualLocator = {
    cssSelector: asString(value.selector) || asString(nestedLocator.cssSelector) || undefined,
    domPath: asString(value.domPath) || asString(value.path) || asString(nestedLocator.domPath) || undefined,
    fingerprint,
    innerText: asString(value.innerText) || asString(value.text) || asString(nestedLocator.innerText) || undefined,
    label: asString(value.label) || asString(nestedLocator.label) || undefined,
    tag: asString(value.tag) || asString(nestedLocator.tag) || undefined,
  };
  const geometry: VisualGeometry = {
    box: documentBox || viewportBox,
    documentBox,
    documentPoint,
    point: coords,
    viewportAnchored: value.viewportAnchored === true,
    viewportBox,
    viewportPoint,
  };

  return {
    ...value,
    anchor: viewportPoint || coords,
    areaBox: documentBox,
    box: viewportBox,
    color: asString(value.color) || undefined,
    comment: asString(value.comment),
    coords,
    documentAnchor: documentPoint,
    documentBox,
    domPath: locator.domPath,
    fingerprint,
    frameId: asFiniteNumber(value.frameId),
    geometry,
    id: pinId,
    innerText: locator.innerText,
    kind,
    label: locator.label,
    location,
    locator,
    number,
    path: asString(value.path) || locator.domPath,
    pinId,
    scroll: asPoint(value.scroll),
    selector: locator.cssSelector,
    tag: locator.tag,
    text: asString(value.text) || locator.innerText,
    type,
    viewportAnchored: geometry.viewportAnchored,
  } as VisualPin;
}

function viewportFrom(value: unknown, page: Record<string, unknown>): VisualViewport | undefined {
  const pageViewport = isRecord(page.viewport) ? page.viewport : {};
  const record = isRecord(value) ? value : pageViewport;
  const width = asFiniteNumber(record.width) ?? asFiniteNumber(pageViewport.width);
  const height = asFiniteNumber(record.height) ?? asFiniteNumber(pageViewport.height);
  if (width === undefined || height === undefined) return undefined;
  return {
    devicePixelRatio: asFiniteNumber(record.devicePixelRatio)
      ?? asFiniteNumber(record.dpr)
      ?? asFiniteNumber(pageViewport.devicePixelRatio)
      ?? asFiniteNumber(pageViewport.dpr)
      ?? 1,
    height,
    scrollX: asFiniteNumber(record.scrollX) ?? asFiniteNumber(pageViewport.scrollX) ?? 0,
    scrollY: asFiniteNumber(record.scrollY) ?? asFiniteNumber(pageViewport.scrollY) ?? 0,
    width,
  };
}

function screenshotFrom(record: Record<string, unknown>, captureId: string): VisualScreenshot {
  const nested = isRecord(record.screenshot) ? record.screenshot : {};
  const rawUrl = asString(nested.url)
    || asString(record.shotUrl)
    || asString(record.shotPath)
    || asString(record.shot);
  const isDataUrl = rawUrl.startsWith("data:");
  const url = !rawUrl || isDataUrl ? null : rawUrl;
  const explicitMissing = nested.missing;
  return {
    height: asFiniteNumber(nested.height),
    id: asString(nested.id) || asString(record.shotId) || captureId,
    mimeType: "image/png",
    missing: explicitMissing === false ? false : explicitMissing === true || !url,
    url,
    width: asFiniteNumber(nested.width),
  };
}

function captureIdFrom(record: Record<string, unknown>, fallback?: string) {
  const captureId = asString(record.captureId) || asString(record.id) || fallback || "";
  if (!captureId) throw new VisualContextError("missing_capture_id");
  return captureId;
}

function pinLooksLikeIframe(pin: VisualPin) {
  if (typeof pin.frameId === "number") return true;
  const path = pin.locator.domPath || pin.path || "";
  return /\biframe\b/i.test(path);
}

function asPrivacy(value: unknown): PrivacyReport | undefined {
  if (!isRecord(value)) return undefined;
  const allowed = [
    "password",
    "token",
    "secret-query",
    "secret-hash",
    "payment",
    "otp",
    "email",
    "unevaluated",
  ];
  const redacted = Array.isArray(value.redacted)
    ? value.redacted.filter((item): item is RedactedCategory =>
      typeof item === "string" && allowed.includes(item))
    : [];
  const unevaluated = value.unevaluated === true || redacted.includes("unevaluated");
  const categories = unevaluated && !redacted.includes("unevaluated")
    ? [...redacted, "unevaluated" as const]
    : redacted;
  if (!categories.length && !unevaluated) return undefined;
  return { redacted: categories, unevaluated };
}

export function parseVisualCapture(input: unknown, fallbackCaptureId?: string): VisualCapture {
  if (!isRecord(input)) throw new VisualContextError("invalid_payload");
  if (
    input.schemaVersion != null
    && input.schemaVersion !== VISUAL_CONTEXT_SCHEMA_VERSION
    && input.schemaVersion !== 0
  ) {
    throw new VisualContextError("unsupported_schema");
  }
  if (input.pins != null && !Array.isArray(input.pins)) throw new VisualContextError("invalid_payload");
  const captureId = captureIdFrom(input, fallbackCaptureId);
  const pageRecord = isRecord(input.page) ? input.page : {};
  const pins = (input.pins ?? []).map((pin, index) => normalizePin(pin, captureId, index));
  const capabilities = isRecord(input.capabilities) ? input.capabilities : {};
  const warnings = Array.isArray(input.warnings)
    ? input.warnings.filter((item): item is string => typeof item === "string")
    : [];
  const screenshot = screenshotFrom(input, captureId);
  if (screenshot.missing) warnings.push("screenshot_missing");
  const viewport = viewportFrom(input.viewport, pageRecord);
  const privacy = asPrivacy(input.privacy);
  if (privacy?.redacted.some((item) => item !== "unevaluated")) warnings.push("privacy_redacted");
  if (privacy?.unevaluated) warnings.push("privacy_unevaluated");

  return {
    capabilities: {
      fullPage: capabilities.fullPage === true,
      iframe: capabilities.iframe === true || pins.some(pinLooksLikeIframe),
    },
    captureId,
    createdAt: asString(input.createdAt) || undefined,
    page: {
      ...(asString(pageRecord.description).trim()
        ? { description: asString(pageRecord.description).trim() }
        : {}),
      title: asString(pageRecord.title),
      url: asString(pageRecord.url),
      viewport: viewport
        ? { dpr: viewport.devicePixelRatio, height: viewport.height, width: viewport.width }
        : undefined,
    },
    pins,
    privacy,
    schemaVersion: VISUAL_CONTEXT_SCHEMA_VERSION,
    screenshot,
    viewport,
    warnings: [...new Set(warnings)],
  };
}

export function encodeVisualCaptureJson(capture: VisualCapture) {
  return JSON.stringify({
    capabilities: capture.capabilities,
    captureId: capture.captureId,
    createdAt: capture.createdAt,
    page: capture.page,
    pins: capture.pins,
    privacy: capture.privacy,
    schemaVersion: capture.schemaVersion,
    screenshot: capture.screenshot,
    viewport: capture.viewport,
    warnings: capture.warnings,
  });
}

export function decodeVisualCaptureJson(raw: string | null | undefined, fallbackCaptureId: string) {
  if (!raw) return parseVisualCapture({ captureId: fallbackCaptureId, pins: [] }, fallbackCaptureId);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return parseVisualCapture({ captureId: fallbackCaptureId, pins: [] }, fallbackCaptureId);
  }
  try {
    if (Array.isArray(parsed)) {
      return parseVisualCapture({ captureId: fallbackCaptureId, pins: parsed }, fallbackCaptureId);
    }
    return parseVisualCapture(parsed, fallbackCaptureId);
  } catch {
    return parseVisualCapture({ captureId: fallbackCaptureId, pins: [] }, fallbackCaptureId);
  }
}

export function sessionDeliversScreenshot(session?: Pick<Session, "includeScreenshot"> | null) {
  return session?.includeScreenshot !== false;
}

export function screenshotDeliveryEnabled(
  preference?: boolean | null,
  session?: Pick<Session, "includeScreenshot"> | null,
) {
  if (typeof preference === "boolean") return preference;
  return sessionDeliversScreenshot(session);
}

export function captureFromSession(session: Session, extras: { shotPath?: string | null; deliverScreenshot?: boolean } = {}): VisualCapture {
  const storedUrl = extras.shotPath ?? session.shotUrl ?? null;
  const deliver = extras.deliverScreenshot ?? true;
  const shotUrl = deliver ? storedUrl : null;
  return parseVisualCapture({
    captureId: session.captureId || session.id,
    createdAt: session.createdAt,
    page: session.page,
    pins: session.pins,
    privacy: session.privacy,
    schemaVersion: session.schemaVersion,
    screenshot: {
      id: session.shotId || session.id,
      missing: deliver ? !shotUrl : false,
      url: shotUrl,
    },
  }, session.id);
}

export function sessionFromCapture(capture: VisualCapture, extras: Partial<Session> = {}): Session {
  return {
    ...extras,
    captureId: capture.captureId,
    createdAt: extras.createdAt || capture.createdAt || new Date().toISOString(),
    id: extras.id || capture.captureId,
    page: capture.page,
    pinCount: capture.pins.length,
    pins: capture.pins,
    privacy: capture.privacy,
    schemaVersion: capture.schemaVersion,
    shotId: extras.shotId || capture.screenshot.id,
    shotUrl: extras.shotUrl !== undefined ? extras.shotUrl : capture.screenshot.url,
  };
}

export function knownPinFields(pin: Pin | VisualPin) {
  return {
    comment: pin.comment,
    coords: pin.coords,
    domPath: pin.domPath || pin.path,
    kind: pin.kind,
    number: pin.number,
    pinId: pin.pinId || pin.id,
    selector: pin.selector,
    text: pin.innerText || pin.text,
    type: pin.type,
  };
}

export function formatVisualContextMarkdown(capture: VisualCapture, viewerUrl?: string | null) {
  const lines = [
    `schemaVersion: ${capture.schemaVersion}`,
    `captureId: ${capture.captureId}`,
    `Page: ${capture.page.title || "(untitled)"}`,
    ...(capture.page.description ? [`Description: ${capture.page.description}`] : []),
    `URL: ${capture.page.url || "(unknown)"}`,
  ];
  if (viewerUrl) lines.push(`Viewer: ${viewerUrl}`);
  if (capture.screenshot.url) lines.push(`Screenshot: ${capture.screenshot.url}`);
  if (capture.privacy?.redacted.length) {
    lines.push(`Redacted: ${capture.privacy.redacted.join(", ")}`);
  }
  if (capture.privacy?.unevaluated) {
    lines.push("Warning: some regions could not be inspected");
  }
  if (capture.viewport) {
    lines.push(
      `Viewport: ${capture.viewport.width}x${capture.viewport.height} dpr=${capture.viewport.devicePixelRatio}`,
    );
  }
  const capabilityLabels = [
    capture.capabilities?.fullPage ? "fullPage" : "",
    capture.capabilities?.iframe ? "iframe" : "",
  ].filter(Boolean);
  if (capabilityLabels.length) lines.push(`Capabilities: ${capabilityLabels.join(", ")}`);
  if (capture.warnings.length) lines.push(`Warnings: ${capture.warnings.join(", ")}`);
  lines.push("");
  for (const [index, pin] of capture.pins.entries()) {
    lines.push(`Pin #${pin.number || index + 1}:`);
    lines.push(`pinId: ${pin.pinId}`);
    lines.push(`Comment: ${pin.comment}`);
    if (pin.locator.domPath) lines.push(`DOM: ${pin.locator.domPath}`);
    if (pin.locator.cssSelector) lines.push(`Selector: ${pin.locator.cssSelector}`);
    if (pin.locator.innerText) {
      lines.push(`Text: "${pin.locator.innerText.replace(/\n+/g, " ").trim()}"`);
    }
    if (pin.location) {
      lines.push(`Location: ${pin.location.confidence} (${pin.location.strategy})`);
      if (pin.location.warning === "cross-origin-frame") {
        lines.push("Warning: cross-origin iframe is not readable");
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function visualContextErrorBody(error: unknown) {
  const code = error instanceof VisualContextError ? error.code : "invalid_payload";
  return { code, error: "invalid visual context" };
}
