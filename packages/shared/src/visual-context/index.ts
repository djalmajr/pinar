import type { Box, PageInfo, Pin, Point, Session } from "../types/index.js";

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
  const locator: VisualLocator = {
    cssSelector: asString(value.selector) || undefined,
    domPath: asString(value.domPath) || asString(value.path) || undefined,
    innerText: asString(value.innerText) || asString(value.text) || undefined,
    label: asString(value.label) || undefined,
    tag: asString(value.tag) || undefined,
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
    frameId: asFiniteNumber(value.frameId),
    geometry,
    id: pinId,
    innerText: locator.innerText,
    kind,
    label: locator.label,
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
  return {
    height: asFiniteNumber(nested.height),
    id: asString(nested.id) || asString(record.shotId) || captureId,
    mimeType: "image/png",
    missing: nested.missing === true || !url,
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

  return {
    capabilities: {
      fullPage: capabilities.fullPage === true,
      iframe: capabilities.iframe === true || pins.some(pinLooksLikeIframe),
    },
    captureId,
    createdAt: asString(input.createdAt) || undefined,
    page: {
      title: asString(pageRecord.title),
      url: asString(pageRecord.url),
      viewport: viewport
        ? { dpr: viewport.devicePixelRatio, height: viewport.height, width: viewport.width }
        : undefined,
    },
    pins,
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

export function captureFromSession(session: Session, extras: { shotPath?: string | null } = {}): VisualCapture {
  const shotUrl = extras.shotPath ?? session.shotUrl ?? null;
  return parseVisualCapture({
    captureId: session.captureId || session.id,
    createdAt: session.createdAt,
    page: session.page,
    pins: session.pins,
    schemaVersion: session.schemaVersion,
    screenshot: {
      id: session.shotId || session.id,
      missing: !shotUrl,
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
    `URL: ${capture.page.url || "(unknown)"}`,
  ];
  if (viewerUrl) lines.push(`Viewer: ${viewerUrl}`);
  if (capture.screenshot.url) lines.push(`Screenshot: ${capture.screenshot.url}`);
  if (capture.viewport) {
    lines.push(
      `Viewport: ${capture.viewport.width}x${capture.viewport.height} dpr=${capture.viewport.devicePixelRatio}`,
    );
  }
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
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function visualContextErrorBody(error: unknown) {
  const code = error instanceof VisualContextError ? error.code : "invalid_payload";
  return { code, error: "invalid visual context" };
}
