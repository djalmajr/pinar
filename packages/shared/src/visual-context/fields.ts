/**
 * Optional, versioned fields that ride on Visual Context v1 pins and captures.
 * Every reader tolerates their absence; every normalizer drops an invalid
 * value instead of failing the capture, so an old agent or an old viewer keeps
 * working on a payload that carries a field it does not understand.
 */
import type { VisualFingerprint } from "../locators/types.js";
import type { Session } from "../types/index.js";

export const ELEMENT_SNAPSHOT_VERSION = 1 as const;
export const PIN_COMPONENT_VERSION = 1 as const;
export const PIN_DIAGNOSIS_VERSION = 1 as const;
export const PIN_EVIDENCE_VERSION = 1 as const;
export const REPRODUCTION_VERSION = 1 as const;

export const SNAPSHOT_LIMITS = {
  maxAttrLength: 300,
  maxBytes: 96_000,
  maxDepth: 12,
  maxNodes: 400,
  maxSiblings: 12,
  maxSvgLength: 4_000,
  maxTextLength: 400,
} as const;

export const EVIDENCE_LIMITS = {
  interactionWindowMs: 2_000,
  maxBytes: 48_000,
  maxItems: 40,
  maxMessageLength: 500,
  maxStackLength: 1_200,
  maxUrlLength: 500,
} as const;

export const REPRODUCTION_LIMITS = {
  maxSteps: 60,
  maxThumbnailLength: 40_000,
  maxValueLength: 200,
} as const;

export const COMPONENT_TARGETS = ["html", "react-tailwind", "preact-htm"] as const;
export type ComponentTarget = (typeof COMPONENT_TARGETS)[number];

export const DIAGNOSIS_CONFIDENCES = ["high", "medium", "low"] as const;
export type DiagnosisConfidence = (typeof DIAGNOSIS_CONFIDENCES)[number];

export const EVIDENCE_GRADES = ["after_interaction", "same_page"] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

export const EVIDENCE_KINDS = [
  "console_error",
  "cors",
  "error",
  "http",
  "network",
  "unhandled_rejection",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const REPRODUCTION_STEP_KINDS = ["click", "input", "key", "navigate", "scroll", "wait"] as const;
export type ReproductionStepKind = (typeof REPRODUCTION_STEP_KINDS)[number];

export interface SnapshotNode {
  attrs?: Record<string, string>;
  children?: SnapshotNode[];
  styles?: Record<string, string>;
  svg?: string;
  tag: string;
  text?: string;
  truncated?: boolean;
}

export interface SnapshotFont {
  family: string;
  src?: string;
  style?: string;
  weight?: string;
}

export interface SnapshotIcon {
  kind: "class" | "svg";
  name: string;
}

export interface SnapshotContext {
  parent?: SnapshotNode;
  siblings?: SnapshotNode[];
}

export interface ElementSnapshot {
  bytes?: number;
  context?: SnapshotContext;
  fonts: SnapshotFont[];
  icons: SnapshotIcon[];
  nodeCount: number;
  root: SnapshotNode;
  truncated: boolean;
  version: typeof ELEMENT_SNAPSHOT_VERSION;
}

export interface EvidenceEnvironment {
  browser?: string;
  devicePixelRatio?: number;
  language?: string;
  online?: boolean;
  platform?: string;
  theme?: "dark" | "light";
  viewport?: { height: number; width: number };
}

export interface EvidenceItem {
  at: string;
  frame?: string;
  grade: EvidenceGrade;
  kind: EvidenceKind;
  message?: string;
  method?: string;
  origin: string;
  stack?: string;
  status?: number;
  url?: string;
}

export interface PinEvidence {
  environment?: EvidenceEnvironment;
  items: EvidenceItem[];
  version: typeof PIN_EVIDENCE_VERSION;
}

export interface PinDiagnosis {
  acceptedAt?: string;
  cause: string;
  confidence: DiagnosisConfidence;
  edited?: boolean;
  fix: string;
  model?: string;
  properties: string[];
  version: typeof PIN_DIAGNOSIS_VERSION;
}

export interface ComponentFile {
  content: string;
  path: string;
}

export interface PinComponent {
  dependencies: string[];
  files: ComponentFile[];
  generatedAt: string;
  model?: string;
  notes: string[];
  preview?: string;
  target: ComponentTarget;
  version: typeof PIN_COMPONENT_VERSION;
}

export interface ReproductionLocator {
  cssSelector?: string;
  domPath?: string;
  fingerprint?: VisualFingerprint;
  innerText?: string;
  tag?: string;
}

export interface ReproductionStep {
  at: string;
  kind: ReproductionStepKind;
  locator?: ReproductionLocator;
  redacted?: boolean;
  thumbnail?: string;
  title?: string;
  url?: string;
  value?: string;
}

export interface ReproductionGenerated {
  generatedAt: string;
  model?: string;
  steps: string[];
  test: string;
}

export interface Reproduction {
  generated?: ReproductionGenerated;
  startedAt: string;
  steps: ReproductionStep[];
  version: typeof REPRODUCTION_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function asOptionalText(value: unknown, max: number) {
  const text = asText(value, max);
  return text ? text : undefined;
}

function asFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function asStringMap(value: unknown, maxEntries: number, maxLength: number) {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .slice(0, maxEntries)
    .map(([key, item]) => [key.slice(0, 80), item.slice(0, maxLength)] as const);
  if (!entries.length) return undefined;
  return Object.fromEntries(entries);
}

function isTag(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/i.test(value);
}

function asSnapshotNode(value: unknown, depth: number, budget: { nodes: number }): SnapshotNode | undefined {
  if (!isRecord(value) || !isTag(value.tag) || budget.nodes <= 0) return undefined;
  budget.nodes -= 1;
  const node: SnapshotNode = { tag: value.tag.toLowerCase() };
  const attrs = asStringMap(value.attrs, 40, SNAPSHOT_LIMITS.maxAttrLength);
  const styles = asStringMap(value.styles, 120, SNAPSHOT_LIMITS.maxAttrLength);
  const text = asOptionalText(value.text, SNAPSHOT_LIMITS.maxTextLength);
  const svg = asOptionalText(value.svg, SNAPSHOT_LIMITS.maxSvgLength);
  if (attrs) node.attrs = attrs;
  if (styles) node.styles = styles;
  if (text) node.text = text;
  if (svg) node.svg = svg;
  if (value.truncated === true) node.truncated = true;
  if (Array.isArray(value.children) && depth < SNAPSHOT_LIMITS.maxDepth) {
    const children = value.children
      .map((child) => asSnapshotNode(child, depth + 1, budget))
      .filter((child): child is SnapshotNode => Boolean(child));
    if (children.length) node.children = children;
    if (children.length < value.children.length) node.truncated = true;
  } else if (Array.isArray(value.children) && value.children.length) {
    node.truncated = true;
  }
  return node;
}

function countNodes(node: SnapshotNode): number {
  return 1 + (node.children ?? []).reduce((total, child) => total + countNodes(child), 0);
}

function hasTruncatedNode(node: SnapshotNode): boolean {
  return node.truncated === true || (node.children ?? []).some(hasTruncatedNode);
}

export function asElementSnapshot(value: unknown): ElementSnapshot | undefined {
  if (!isRecord(value) || value.version !== ELEMENT_SNAPSHOT_VERSION) return undefined;
  const budget = { nodes: SNAPSHOT_LIMITS.maxNodes };
  const root = asSnapshotNode(value.root, 0, budget);
  if (!root) return undefined;
  const fonts = Array.isArray(value.fonts)
    ? value.fonts
      .filter(isRecord)
      .map((font): SnapshotFont | null => {
        const family = asText(font.family, 120).trim();
        if (!family) return null;
        const entry: SnapshotFont = { family };
        const src = asOptionalText(font.src, SNAPSHOT_LIMITS.maxAttrLength);
        const style = asOptionalText(font.style, 24);
        const weight = asOptionalText(font.weight, 24);
        if (src && /^https?:\/\//.test(src)) entry.src = src;
        if (style) entry.style = style;
        if (weight) entry.weight = weight;
        return entry;
      })
      .filter((font): font is SnapshotFont => font !== null)
      .slice(0, 24)
    : [];
  const icons = Array.isArray(value.icons)
    ? value.icons
      .filter(isRecord)
      .map((icon): SnapshotIcon | null => {
        const name = asText(icon.name, 120).trim();
        if (!name || (icon.kind !== "class" && icon.kind !== "svg")) return null;
        return { kind: icon.kind, name };
      })
      .filter((icon): icon is SnapshotIcon => icon !== null)
      .slice(0, 40)
    : [];
  const snapshot: ElementSnapshot = {
    fonts,
    icons,
    nodeCount: countNodes(root),
    root,
    truncated: value.truncated === true || budget.nodes <= 0 || hasTruncatedNode(root),
    version: ELEMENT_SNAPSHOT_VERSION,
  };
  const bytes = asFinite(value.bytes);
  if (bytes !== undefined && bytes >= 0) snapshot.bytes = Math.trunc(bytes);
  if (isRecord(value.context)) {
    const contextBudget = { nodes: SNAPSHOT_LIMITS.maxSiblings + 1 };
    const context: SnapshotContext = {};
    const parent = asSnapshotNode({ ...(isRecord(value.context.parent) ? value.context.parent : {}), children: undefined }, SNAPSHOT_LIMITS.maxDepth, contextBudget);
    if (parent) context.parent = parent;
    if (Array.isArray(value.context.siblings)) {
      const siblings = value.context.siblings
        .slice(0, SNAPSHOT_LIMITS.maxSiblings)
        .map((sibling) => asSnapshotNode({ ...(isRecord(sibling) ? sibling : {}), children: undefined }, SNAPSHOT_LIMITS.maxDepth, { nodes: 1 }))
        .filter((sibling): sibling is SnapshotNode => Boolean(sibling));
      if (siblings.length) context.siblings = siblings;
    }
    if (context.parent || context.siblings) snapshot.context = context;
  }
  return snapshot;
}

function asEvidenceEnvironment(value: unknown): EvidenceEnvironment | undefined {
  if (!isRecord(value)) return undefined;
  const environment: EvidenceEnvironment = {};
  const browser = asOptionalText(value.browser, 120);
  const language = asOptionalText(value.language, 32);
  const platform = asOptionalText(value.platform, 64);
  const devicePixelRatio = asFinite(value.devicePixelRatio);
  if (browser) environment.browser = browser;
  if (devicePixelRatio !== undefined) environment.devicePixelRatio = devicePixelRatio;
  if (language) environment.language = language;
  if (typeof value.online === "boolean") environment.online = value.online;
  if (platform) environment.platform = platform;
  if (value.theme === "dark" || value.theme === "light") environment.theme = value.theme;
  if (isRecord(value.viewport)) {
    const height = asFinite(value.viewport.height);
    const width = asFinite(value.viewport.width);
    if (height !== undefined && width !== undefined) environment.viewport = { height, width };
  }
  return Object.keys(environment).length ? environment : undefined;
}

export function asEvidenceItem(value: unknown): EvidenceItem | undefined {
  if (!isRecord(value)) return undefined;
  const at = asText(value.at, 40);
  const origin = asText(value.origin, 200);
  if (!at || !origin) return undefined;
  if (!(EVIDENCE_GRADES as readonly unknown[]).includes(value.grade)) return undefined;
  if (!(EVIDENCE_KINDS as readonly unknown[]).includes(value.kind)) return undefined;
  const item: EvidenceItem = {
    at,
    grade: value.grade as EvidenceGrade,
    kind: value.kind as EvidenceKind,
    origin,
  };
  const frame = asOptionalText(value.frame, 200);
  const message = asOptionalText(value.message, EVIDENCE_LIMITS.maxMessageLength);
  const method = asOptionalText(value.method, 12);
  const stack = asOptionalText(value.stack, EVIDENCE_LIMITS.maxStackLength);
  const status = asFinite(value.status);
  const url = asOptionalText(value.url, EVIDENCE_LIMITS.maxUrlLength);
  if (frame) item.frame = frame;
  if (message) item.message = message;
  if (method) item.method = method.toUpperCase();
  if (stack) item.stack = stack;
  if (status !== undefined && status >= 0) item.status = Math.trunc(status);
  if (url) item.url = url;
  return item;
}

/** A pin without technical facts has no evidence field at all. */
export function asPinEvidence(value: unknown): PinEvidence | undefined {
  if (!isRecord(value) || value.version !== PIN_EVIDENCE_VERSION) return undefined;
  const items = Array.isArray(value.items)
    ? value.items
      .map(asEvidenceItem)
      .filter((item): item is EvidenceItem => Boolean(item))
      .slice(0, EVIDENCE_LIMITS.maxItems)
    : [];
  if (!items.length) return undefined;
  const evidence: PinEvidence = { items, version: PIN_EVIDENCE_VERSION };
  const environment = asEvidenceEnvironment(value.environment);
  if (environment) evidence.environment = environment;
  return evidence;
}

export function asPinDiagnosis(value: unknown): PinDiagnosis | undefined {
  if (!isRecord(value) || value.version !== PIN_DIAGNOSIS_VERSION) return undefined;
  const cause = asText(value.cause, 1_200).trim();
  const fix = asText(value.fix, 4_000).trim();
  if (!cause || !(DIAGNOSIS_CONFIDENCES as readonly unknown[]).includes(value.confidence)) return undefined;
  const diagnosis: PinDiagnosis = {
    cause,
    confidence: value.confidence as DiagnosisConfidence,
    fix,
    properties: asStringList(value.properties, 12, 80),
    version: PIN_DIAGNOSIS_VERSION,
  };
  const acceptedAt = asOptionalText(value.acceptedAt, 40);
  const model = asOptionalText(value.model, 120);
  if (acceptedAt) diagnosis.acceptedAt = acceptedAt;
  if (value.edited === true) diagnosis.edited = true;
  if (model) diagnosis.model = model;
  return diagnosis;
}

export function isComponentTarget(value: unknown): value is ComponentTarget {
  return (COMPONENT_TARGETS as readonly unknown[]).includes(value);
}

export function asPinComponent(value: unknown): PinComponent | undefined {
  if (!isRecord(value) || value.version !== PIN_COMPONENT_VERSION) return undefined;
  if (!isComponentTarget(value.target)) return undefined;
  const files = Array.isArray(value.files)
    ? value.files
      .filter(isRecord)
      .map((file): ComponentFile | null => {
        const path = asText(file.path, 200).trim();
        const content = typeof file.content === "string" ? file.content.slice(0, 60_000) : "";
        if (!path || !content || path.includes("..") || path.startsWith("/")) return null;
        return { content, path };
      })
      .filter((file): file is ComponentFile => file !== null)
      .slice(0, 12)
    : [];
  if (!files.length) return undefined;
  const component: PinComponent = {
    dependencies: asStringList(value.dependencies, 20, 120),
    files,
    generatedAt: asText(value.generatedAt, 40) || new Date(0).toISOString(),
    notes: asStringList(value.notes, 12, 400),
    target: value.target,
    version: PIN_COMPONENT_VERSION,
  };
  const model = asOptionalText(value.model, 120);
  const preview = typeof value.preview === "string" ? value.preview.slice(0, 80_000) : "";
  if (model) component.model = model;
  if (preview) component.preview = preview;
  return component;
}

function asReproductionLocator(value: unknown): ReproductionLocator | undefined {
  if (!isRecord(value)) return undefined;
  const locator: ReproductionLocator = {};
  const cssSelector = asOptionalText(value.cssSelector, 500);
  const domPath = asOptionalText(value.domPath, 2_000);
  const innerText = asOptionalText(value.innerText, 200);
  const tag = asOptionalText(value.tag, 64);
  if (cssSelector) locator.cssSelector = cssSelector;
  if (domPath) locator.domPath = domPath;
  if (isRecord(value.fingerprint)) locator.fingerprint = value.fingerprint as VisualFingerprint;
  if (innerText) locator.innerText = innerText;
  if (tag) locator.tag = tag;
  return Object.keys(locator).length ? locator : undefined;
}

export function asReproductionStep(value: unknown): ReproductionStep | undefined {
  if (!isRecord(value)) return undefined;
  const at = asText(value.at, 40);
  if (!at || !(REPRODUCTION_STEP_KINDS as readonly unknown[]).includes(value.kind)) return undefined;
  const step: ReproductionStep = { at, kind: value.kind as ReproductionStepKind };
  const locator = asReproductionLocator(value.locator);
  const thumbnail = typeof value.thumbnail === "string"
    && value.thumbnail.startsWith("data:image/")
    && value.thumbnail.length <= REPRODUCTION_LIMITS.maxThumbnailLength
    ? value.thumbnail
    : undefined;
  const title = asOptionalText(value.title, 200);
  const url = asOptionalText(value.url, 2_000);
  const stepValue = asOptionalText(value.value, REPRODUCTION_LIMITS.maxValueLength);
  if (locator) step.locator = locator;
  if (value.redacted === true) step.redacted = true;
  if (thumbnail) step.thumbnail = thumbnail;
  if (title) step.title = title;
  if (url) step.url = url;
  if (stepValue) step.value = stepValue;
  return step;
}

export function asReproduction(value: unknown): Reproduction | undefined {
  if (!isRecord(value) || value.version !== REPRODUCTION_VERSION) return undefined;
  const steps = Array.isArray(value.steps)
    ? value.steps
      .map(asReproductionStep)
      .filter((step): step is ReproductionStep => Boolean(step))
      .slice(0, REPRODUCTION_LIMITS.maxSteps)
    : [];
  if (!steps.length) return undefined;
  const reproduction: Reproduction = {
    startedAt: asText(value.startedAt, 40) || steps[0].at,
    steps,
    version: REPRODUCTION_VERSION,
  };
  if (isRecord(value.generated)) {
    const generatedSteps = asStringList(value.generated.steps, 60, 400);
    const test = typeof value.generated.test === "string" ? value.generated.test.slice(0, 20_000) : "";
    if (generatedSteps.length && test) {
      reproduction.generated = {
        generatedAt: asText(value.generated.generatedAt, 40) || new Date(0).toISOString(),
        steps: generatedSteps,
        test,
      };
      const model = asOptionalText(value.generated.model, 120);
      if (model) reproduction.generated.model = model;
    }
  }
  return reproduction;
}

/** Clipboard projection: the timeline without its per-step thumbnails. */
export function reproductionForHandoff(reproduction: Reproduction | undefined): Reproduction | undefined {
  if (!reproduction) return undefined;
  return {
    ...reproduction,
    steps: reproduction.steps.map(({ thumbnail: _thumbnail, ...step }) => step),
  };
}

/** Only a diagnosis the user accepted leaves the viewer. */
export function acceptedDiagnosis(diagnosis: PinDiagnosis | undefined): PinDiagnosis | undefined {
  return diagnosis?.acceptedAt ? diagnosis : undefined;
}

/**
 * Deterministic link between a technical event and the pinned element: the
 * event happened within the window after the user interacted with the target.
 */
export function evidenceGrade(
  eventAt: number,
  lastInteractionAt: number | null | undefined,
  windowMs: number = EVIDENCE_LIMITS.interactionWindowMs,
): EvidenceGrade {
  if (
    typeof lastInteractionAt === "number"
    && Number.isFinite(lastInteractionAt)
    && eventAt >= lastInteractionAt
    && eventAt - lastInteractionAt <= windowMs
  ) return "after_interaction";
  return "same_page";
}

export function describeEvidenceItem(item: EvidenceItem) {
  const parts: string[] = [];
  switch (item.kind) {
    case "http":
      parts.push(`${item.method || "GET"} ${item.url || ""} → ${item.status ?? "?"}`.trim());
      break;
    case "network":
      parts.push(`${item.method || "GET"} ${item.url || ""} → network failure`.trim());
      break;
    case "cors":
      parts.push(`${item.method || "GET"} ${item.url || ""} → blocked by CORS`.trim());
      break;
    case "console_error":
      parts.push(`console.error: ${item.message || ""}`.trim());
      break;
    case "unhandled_rejection":
      parts.push(`Unhandled rejection: ${item.message || ""}`.trim());
      break;
    default:
      parts.push(`Error: ${item.message || ""}`.trim());
  }
  return parts.join(" ");
}

/** Compact, readable rendering of a snapshot subtree for Markdown consumers. */
export function renderSnapshotOutline(node: SnapshotNode, depth = 0, lines: string[] = [], budget = { lines: 80 }): string[] {
  if (budget.lines <= 0) return lines;
  budget.lines -= 1;
  const indent = "  ".repeat(depth);
  const attrs = node.attrs
    ? Object.entries(node.attrs).filter(([key]) => key === "class" || key === "id" || key === "role" || key === "type" || key === "href" || key === "src").map(([key, value]) => `${key}="${value.slice(0, 60)}"`).join(" ")
    : "";
  const styles = node.styles
    ? Object.entries(node.styles).slice(0, 8).map(([key, value]) => `${key}: ${value}`).join("; ")
    : "";
  const text = node.text ? ` "${node.text.replace(/\s+/g, " ").trim().slice(0, 60)}"` : "";
  lines.push(`${indent}<${node.tag}${attrs ? ` ${attrs}` : ""}>${text}${styles ? ` { ${styles} }` : ""}${node.truncated ? " …" : ""}`);
  for (const child of node.children ?? []) renderSnapshotOutline(child, depth + 1, lines, budget);
  if (budget.lines <= 0 && depth === 0) lines.push("…");
  return lines;
}

/**
 * Viewer edits on a stored capture: an accepted diagnosis, a generated
 * component, a trimmed evidence list, an edited reproduction. `null` clears a
 * field; an invalid value rejects the whole patch.
 */
export function applySessionPatch<S extends Session>(session: S, body: Record<string, unknown>): S | null {
  const next: S = { ...session, pins: session.pins.map((pin) => ({ ...pin })) };
  if ("reproduction" in body) {
    if (body.reproduction === null) delete next.reproduction;
    else {
      const reproduction = asReproduction(body.reproduction);
      if (!reproduction) return null;
      next.reproduction = reproduction;
    }
  }
  if (body.pins !== undefined) {
    if (!Array.isArray(body.pins)) return null;
    for (const entry of body.pins) {
      if (!isRecord(entry)) return null;
      const pinId = asText(entry.pinId, 200);
      const pin = next.pins.find((item) => (item.pinId || item.id) === pinId);
      if (!pin) return null;
      if ("component" in entry) {
        if (entry.component === null) delete pin.component;
        else {
          const component = asPinComponent(entry.component);
          if (!component) return null;
          pin.component = component;
        }
      }
      if ("diagnosis" in entry) {
        if (entry.diagnosis === null) delete pin.diagnosis;
        else {
          const diagnosis = asPinDiagnosis(entry.diagnosis);
          if (!diagnosis) return null;
          pin.diagnosis = diagnosis;
        }
      }
      if ("evidence" in entry) {
        if (entry.evidence === null) delete pin.evidence;
        else {
          const evidence = asPinEvidence(entry.evidence);
          if (!evidence) return null;
          pin.evidence = evidence;
        }
      }
    }
  }
  return next;
}
