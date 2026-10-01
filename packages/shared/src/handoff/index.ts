import {
  encodeVisualCaptureJson,
  formatVisualContextMarkdown,
  parseVisualCapture,
  type VisualCapture,
  type VisualPin,
} from "../visual-context/index.js";
import {
  acceptedDiagnosis,
  reproductionForHandoff,
  type EvidenceGrade,
  type EvidenceItem,
} from "../visual-context/fields.js";
import { translations } from "../i18n/index.js";
import type { SupportedLanguage } from "../types/index.js";

export const HANDOFF_AGENTS = ["cursor", "claude", "codex", "grok"] as const;
export type HandoffAgent = (typeof HANDOFF_AGENTS)[number];

export const HANDOFF_JSON_FENCE = "pinar-visual-context";

export const DEGRADED_HANDOFF_WARNINGS = [
  "screenshot_missing",
  "helper_unavailable",
  "viewer_unavailable",
] as const;

// Compact projection budgets (Unicode code points / distinct errors). The
// extension mirror in extension/format.js keeps equivalent helpers: test the
// parity in handoff.test.ts before changing either side.
export const COMPACT_INNER_TEXT_MAX = 120;
export const COMPACT_EVIDENCE_MESSAGE_MAX = 200;
export const COMPACT_EVIDENCE_MAX_ITEMS = 3;

/**
 * Flattens whitespace (Unicode included) and limits the text to `max` Unicode
 * code points, ending with an ellipsis when cut. Empty text becomes undefined
 * so the field is omitted. Never apply this to comments, IDs, URLs, selectors
 * or DOM paths.
 */
export function compactText(value: string | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const flat = value.replace(/\s+/gu, " ").trim();
  if (!flat) return undefined;
  const codePoints = Array.from(flat);
  if (codePoints.length <= max) return flat;
  return `${codePoints.slice(0, max - 1).join("")}…`;
}

function evidenceSignature(item: Pick<EvidenceItem, "at" | "frame" | "grade" | "kind" | "message" | "method" | "origin" | "status" | "url">) {
  return [
    item.kind,
    item.grade,
    item.origin,
    item.frame ?? "",
    item.method ?? "",
    item.status ?? "",
    item.url ?? "",
    item.message ?? "",
  ].join("\u0000");
}

/**
 * Compact projection of technical evidence: after_interaction errors come
 * first, the original order is kept within each grade, occurrences that differ
 * only by unpublished details (timestamp, stack) collapse into one, and at most
 * COMPACT_EVIDENCE_MAX_ITEMS distinct errors remain. `environment` and `stack`
 * are omitted (they stay in the full context) and `stack` is excluded from the
 * dedupe signature: differences in data the projection never publishes must not
 * consume slots. Dedupe runs on the full message before the
 * COMPACT_EVIDENCE_MESSAGE_MAX cut so distinct messages that share a prefix are
 * never merged. The input is never mutated; `at`, `origin` and `version` stay
 * because the parser requires them.
 */
export function compactEvidence(evidence: VisualPin["evidence"]): { items: Array<Partial<EvidenceItem>>; version: number } | undefined {
  if (!evidence || !evidence.items.length) return undefined;
  const rank = (grade: EvidenceGrade) => (grade === "after_interaction" ? 0 : 1);
  const ordered = [...evidence.items].sort((a, b) => rank(a.grade) - rank(b.grade));
  const seen = new Set<string>();
  const items: Array<Partial<EvidenceItem>> = [];
  for (const item of ordered) {
    if (!item.at || !item.origin) continue;
    const signature = evidenceSignature(item);
    if (seen.has(signature)) continue;
    seen.add(signature);
    const next: Partial<EvidenceItem> = { at: item.at, grade: item.grade, kind: item.kind, origin: item.origin };
    if (item.frame) next.frame = item.frame;
    if (item.method) next.method = item.method;
    if (item.status !== undefined) next.status = item.status;
    if (item.url) next.url = item.url;
    const message = compactText(item.message, COMPACT_EVIDENCE_MESSAGE_MAX);
    if (message) next.message = message;
    items.push(next);
    if (items.length >= COMPACT_EVIDENCE_MAX_ITEMS) break;
  }
  if (!items.length) return undefined;
  return { items, version: evidence.version };
}

/** Only a cross-origin iframe location is carried: the DOM is not readable and the agent must not hunt for a selector that does not exist. */
export function compactLocation(pin: VisualPin): VisualPin["location"] {
  if (pin.location?.warning !== "cross-origin-frame") return undefined;
  return pin.location;
}

const AGENT_PREAMBLE: Record<HandoffAgent, string> = {
  claude: "Pinar visual context for Claude. captureId and pinId identify the capture; do not rewrite them. Paste is the source of truth.",
  codex: "Pinar visual context for Codex. captureId and pinId identify the capture; do not rewrite them. Paste is the source of truth.",
  cursor: "Pinar visual context for Cursor. captureId and pinId identify the capture; do not rewrite them. Paste is the source of truth.",
  grok: "Pinar visual context for Grok. captureId and pinId identify the capture; do not rewrite them. Paste is the source of truth.",
};

export interface HandoffSemantics {
  captureId: string;
  comments: string[];
  pinIds: string[];
  url: string;
  warnings: string[];
}

export interface HandoffBundle {
  capabilities: VisualCapture["capabilities"];
  captureId: string;
  degraded: boolean;
  html: string;
  json: string;
  markdown: string;
  pinIds: string[];
  plain: string;
  warnings: string[];
}

export interface CompactHandoffBundle {
  html: string;
  json: string;
  plain: string;
}

export interface HandoffAdapterResult extends HandoffSemantics {
  agent: HandoffAgent;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fillHandoff(template: string, vars: Record<string, string | number>) {
  let text = template;
  for (const [key, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${key}}`, String(value));
  }
  return text;
}

export function isDegradedHandoff(warnings: string[] = []) {
  return warnings.some((warning) => (DEGRADED_HANDOFF_WARNINGS as readonly string[]).includes(warning));
}

// A pin whose explicit location strategy is "none" was never measured: the
// parser's zero-coordinate defaults are placeholders, not geometry, so every
// coordinate, box, anchor, and geometry field is omitted. Measured pins
// (including a legitimate origin 0,0 from geometry/stable-selector) keep all
// captured fields.
const UNMEASURED_PIN_FIELDS = [
  "anchor",
  "areaBox",
  "box",
  "coords",
  "documentAnchor",
  "documentBox",
  "geometry",
  "historicalAnchor",
  "historicalBox",
  "topBox",
] as const;

function unmeasuredPin(pin: VisualPin): VisualPin {
  if (pin.location?.strategy !== "none") return pin;
  const rest: Record<string, unknown> = { ...pin };
  for (const field of UNMEASURED_PIN_FIELDS) delete rest[field];
  return rest as unknown as VisualPin;
}

export function captureForHandoffJson(capture: VisualCapture): VisualCapture {
  const url = capture.screenshot.url;
  const inline = typeof url === "string" && url.startsWith("data:");
  const warnings = inline && !capture.warnings.includes("screenshot_inline")
    ? [...capture.warnings, "screenshot_inline"]
    : capture.warnings;
  return {
    ...capture,
    pins: capture.pins.map((pin) => ({
      ...unmeasuredPin(pin),
      diagnosis: acceptedDiagnosis(pin.diagnosis),
    })),
    reproduction: reproductionForHandoff(capture.reproduction),
    screenshot: {
      ...capture.screenshot,
      url: inline ? null : url ?? null,
    },
    warnings,
  };
}

function compactPin(pin: VisualCapture["pins"][number]) {
  const selector = pin.locator.cssSelector || undefined;
  // The selector and the DOM path are complementary locators: keep both when
  // they differ, and emit an identical pair only once.
  const domPath = pin.locator.domPath && pin.locator.domPath !== selector
    ? pin.locator.domPath
    : undefined;
  const innerText = compactText(pin.locator.innerText, COMPACT_INNER_TEXT_MAX);
  const locator: { cssSelector?: string; domPath?: string; innerText?: string } = {};
  if (selector) locator.cssSelector = selector;
  if (domPath) locator.domPath = domPath;
  if (innerText) locator.innerText = innerText;
  // Text alone cannot locate an element: geometry stays for areas and for
  // pins without a selector or DOM path, even when innerText is present. An
  // explicit "none" location is never measured, so its zero-coordinate
  // defaults are dropped instead of published.
  const hasLocator = Boolean(selector || domPath);
  const needsGeometry = pin.location?.strategy !== "none" && (pin.kind === "area" || !hasLocator);
  // The snapshot stays behind the "full context" link: the compact paste keeps
  // the small, high-signal facts (an accepted diagnosis, compacted evidence).
  return {
    box: needsGeometry ? pin.box : undefined,
    comment: pin.comment,
    coords: needsGeometry && !pin.box ? pin.coords : undefined,
    diagnosis: acceptedDiagnosis(pin.diagnosis),
    evidence: compactEvidence(pin.evidence),
    frameId: pin.frameId || undefined,
    kind: pin.kind === "area" ? "area" : undefined,
    locator: Object.keys(locator).length ? locator : undefined,
    location: compactLocation(pin),
    pinId: pin.pinId,
    viewportAnchored: pin.viewportAnchored || undefined,
  };
}

/**
 * Clipboard projection: every useful fact appears once. The richer Markdown
 * projection remains available to viewers through formatHandoffBundle.
 */
export function compactCaptureForHandoff(capture: VisualCapture) {
  const screenshotUrl = capture.screenshot.url?.startsWith("data:") ? null : capture.screenshot.url;
  const capabilities = {
    fullPage: capture.capabilities?.fullPage || undefined,
    iframe: capture.capabilities?.iframe || undefined,
  };
  const page = {
    // page.description is generic page metadata: it stays out of the prompt.
    title: capture.page.title || undefined,
    url: capture.page.url,
  };
  const privacy = capture.privacy
    && (capture.privacy.redacted.length || capture.privacy.unevaluated)
    ? capture.privacy
    : undefined;
  return {
    capabilities: Object.values(capabilities).some(Boolean) ? capabilities : undefined,
    captureId: capture.captureId,
    page,
    pins: capture.pins.map(compactPin),
    privacy,
    reproduction: reproductionForHandoff(capture.reproduction),
    screenshot: screenshotUrl ? { url: screenshotUrl } : undefined,
    warnings: capture.warnings.length ? capture.warnings : undefined,
  };
}

function structuredHandoffBundle(
  capture: VisualCapture,
  jsonCapture: unknown,
  viewerUrl?: string | null,
  language: SupportedLanguage = "en",
): CompactHandoffBundle {
  const t = (language && translations[language]) || translations.en;
  const json = JSON.stringify(jsonCapture);
  const instructions = [
    t.handoff_instructions,
    ...(capture.screenshot.url ? [t.handoff_screenshot_note] : []),
    ...(viewerUrl ? [fillHandoff(t.handoff_full_context, { url: viewerUrl })] : []),
  ].join("\n");
  const plain = `${instructions}\n\n${formatHandoffJsonFence(json)}\n`;
  const html = [
    `<meta charset="utf-8"/>`,
    `<p>${escapeHtml(instructions).replaceAll("\n", "<br/>")}</p>`,
    `<pre data-pinar="${HANDOFF_JSON_FENCE}">${escapeHtml(json)}</pre>`,
  ].join("\n");
  return { html, json, plain };
}

export function formatCompactHandoffBundle(
  capture: VisualCapture,
  viewerUrl?: string | null,
  language: SupportedLanguage = "en",
): CompactHandoffBundle {
  return structuredHandoffBundle(capture, compactCaptureForHandoff(capture), viewerUrl, language);
}

export function formatFullHandoffBundle(
  capture: VisualCapture,
  viewerUrl?: string | null,
  language: SupportedLanguage = "en",
): CompactHandoffBundle {
  return structuredHandoffBundle(capture, captureForHandoffJson(capture), viewerUrl, language);
}

// Human headings and link lines carry text taken from pages and users. A line
// break there would let the rest of the text start a heading or a fenced block
// of its own, and a false `pinar-visual-context` fence reads as another
// capture. Line terminators (including Unicode ones) become a space, so the text
// stays on its line; ordinary text is returned unchanged. The JSON fences keep
// the original values: only the human projection is normalised.
function singleLine(value: string) {
  return value.replace(/[\r\n\u000b\u000c\u0085\u2028\u2029]+/g, " ");
}

export interface BatchHandoffCapture {
  capture: VisualCapture;
  viewerUrl?: string | null;
}

/**
 * A batch is handed to an agent in the same shape as a single capture - one
 * instruction block, then `pinar-visual-context` fences - so whatever already
 * parses a paste keeps working when several pages arrive at once. Each fence
 * is one page and keeps its own captureId; viewer links are listed once in
 * the shared header in the same order as the page blocks.
 */
export function formatBatchHandoff(
  title: string,
  captures: BatchHandoffCapture[],
  handoffMode: "compact" | "full" = "compact",
  language: SupportedLanguage = "en",
): string {
  const t = (language && translations[language]) || translations.en;
  if (captures.length === 0) {
    return `# ${singleLine(title)}\n\n${t.handoff_batch_empty}\n`;
  }
  const project = handoffMode === "full" ? captureForHandoffJson : compactCaptureForHandoff;
  const anyScreenshot = captures.some(({ capture }) => Boolean(capture.screenshot.url));
  const instructions = [
    `# ${singleLine(title)}`,
    "",
    fillHandoff(t.handoff_batch_instructions, { count: captures.length }),
    t.handoff_batch_blocks,
    ...(anyScreenshot ? [t.handoff_screenshot_note] : []),
  ];
  const viewerLinks = captures.flatMap(({ viewerUrl }, index) => viewerUrl ? [`${index + 1}. ${singleLine(viewerUrl)}`] : []);
  if (viewerLinks.length) instructions.push("", t.handoff_batch_full_context, ...viewerLinks);
  const blocks = captures.map(({ capture }) => [
    `## ${singleLine(capture.page.title || capture.page.url)}`,
    "",
    formatHandoffJsonFence(JSON.stringify(project(capture))),
  ].join("\n"));
  return `${instructions.join("\n")}\n\n${blocks.join("\n\n")}\n`;
}

export function formatHandoffJsonFence(json: string) {
  return `\`\`\`${HANDOFF_JSON_FENCE}\n${json}\n\`\`\``;
}

export function formatHandoffBundle(capture: VisualCapture, viewerUrl?: string | null): HandoffBundle {
  const jsonCapture = captureForHandoffJson(capture);
  const markdown = formatVisualContextMarkdown(jsonCapture, viewerUrl);
  const json = encodeVisualCaptureJson(jsonCapture);
  const plain = `${markdown}\n\n${formatHandoffJsonFence(json)}\n`;
  const html = [
    `<meta charset="utf-8"/>`,
    `<pre>${escapeHtml(markdown)}</pre>`,
    `<pre data-pinar="${HANDOFF_JSON_FENCE}">${escapeHtml(json)}</pre>`,
  ].join("\n");
  return {
    capabilities: capture.capabilities,
    captureId: capture.captureId,
    degraded: isDegradedHandoff(jsonCapture.warnings),
    html,
    json,
    markdown,
    pinIds: capture.pins.map((pin) => pin.pinId),
    plain,
    warnings: jsonCapture.warnings,
  };
}

export function parseHandoffJson(text: string) {
  const match = String(text).match(new RegExp(`\`\`\`${HANDOFF_JSON_FENCE}\\n([\\s\\S]*?)\\n\`\`\``));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function handoffSemantics(text: string): HandoffSemantics {
  const parsed = parseHandoffJson(text);
  if (isRecord(parsed) && typeof parsed.captureId === "string") {
    const pins = Array.isArray(parsed.pins) ? parsed.pins : [];
    const page = isRecord(parsed.page) ? parsed.page : {};
    return {
      captureId: parsed.captureId,
      comments: pins.map((pin) => (isRecord(pin) && typeof pin.comment === "string" ? pin.comment : "")).filter(Boolean),
      pinIds: pins.map((pin) => {
        if (!isRecord(pin)) return "";
        return typeof pin.pinId === "string" ? pin.pinId : typeof pin.id === "string" ? pin.id : "";
      }).filter(Boolean),
      url: typeof page.url === "string" ? page.url : "",
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.filter((item): item is string => typeof item === "string")
        : [],
    };
  }
  return {
    captureId: text.match(/^captureId:\s*(\S+)/m)?.[1] ?? "",
    comments: [...text.matchAll(/^Comment:\s*(.*)$/gm)].map((match) => match[1]).filter(Boolean),
    pinIds: [...text.matchAll(/^pinId:\s*(\S+)/gm)].map((match) => match[1]),
    url: text.match(/^URL:\s*(.*)$/m)?.[1] ?? "",
    warnings: (text.match(/^Warnings:\s*(.*)$/m)?.[1] ?? "").split(/,\s*/).filter(Boolean),
  };
}

export function adaptHandoff(
  agent: HandoffAgent,
  capture: VisualCapture,
  viewerUrl?: string | null,
): HandoffAdapterResult {
  const bundle = formatHandoffBundle(capture, viewerUrl);
  const text = `${AGENT_PREAMBLE[agent]}\n\n${bundle.plain}`;
  return {
    agent,
    text,
    ...handoffSemantics(text),
  };
}

export function adaptHandoffAll(capture: VisualCapture, viewerUrl?: string | null) {
  return Object.fromEntries(
    HANDOFF_AGENTS.map((agent) => [agent, adaptHandoff(agent, capture, viewerUrl)]),
  ) as Record<HandoffAgent, HandoffAdapterResult>;
}

export function parseHandoffCapture(input: unknown, fallbackCaptureId: string) {
  return parseVisualCapture(input, fallbackCaptureId);
}
