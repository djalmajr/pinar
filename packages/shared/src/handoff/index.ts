import {
  encodeVisualCaptureJson,
  formatVisualContextMarkdown,
  parseVisualCapture,
  type VisualCapture,
} from "../visual-context/index.js";
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

export function captureForHandoffJson(capture: VisualCapture): VisualCapture {
  const url = capture.screenshot.url;
  const inline = typeof url === "string" && url.startsWith("data:");
  const warnings = inline && !capture.warnings.includes("screenshot_inline")
    ? [...capture.warnings, "screenshot_inline"]
    : capture.warnings;
  return {
    ...capture,
    screenshot: {
      ...capture.screenshot,
      url: inline ? null : url ?? null,
    },
    warnings,
  };
}

function compactPin(pin: VisualCapture["pins"][number]) {
  const selector = pin.locator.cssSelector || undefined;
  const domPath = pin.locator.domPath || undefined;
  const innerText = pin.locator.innerText || undefined;
  const locator = {
    cssSelector: selector,
    domPath,
    innerText,
  };
  const hasLocator = Object.values(locator).some((value) => value !== undefined);
  const needsGeometry = pin.kind === "area" || !hasLocator;
  return {
    box: needsGeometry ? pin.box : undefined,
    comment: pin.comment,
    coords: needsGeometry && !pin.box ? pin.coords : undefined,
    frameId: pin.frameId || undefined,
    kind: pin.kind === "area" ? "area" : undefined,
    locator: hasLocator ? locator : undefined,
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
    description: capture.page.description || undefined,
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

export interface BatchHandoffCapture {
  capture: VisualCapture;
  viewerUrl?: string | null;
}

/**
 * A batch is handed to an agent in the same shape as a single capture - one
 * instruction block, then `pinar-visual-context` fences - so whatever already
 * parses a paste keeps working when several pages arrive at once. Each fence
 * is one page and keeps its own captureId; the per-capture "full context" link
 * sits right above its fence instead of in the shared instructions.
 */
export function formatBatchHandoff(
  title: string,
  captures: BatchHandoffCapture[],
  handoffMode: "compact" | "full" = "compact",
  language: SupportedLanguage = "en",
): string {
  const t = (language && translations[language]) || translations.en;
  if (captures.length === 0) {
    return `# ${title}\n\n${t.handoff_batch_empty}\n`;
  }
  const project = handoffMode === "full" ? captureForHandoffJson : compactCaptureForHandoff;
  const anyScreenshot = captures.some(({ capture }) => Boolean(capture.screenshot.url));
  const instructions = [
    `# ${title}`,
    "",
    fillHandoff(t.handoff_batch_instructions, { count: captures.length }),
    t.handoff_batch_blocks,
    ...(anyScreenshot ? [t.handoff_screenshot_note] : []),
  ];
  const blocks = captures.map(({ capture, viewerUrl }) => [
    `## ${capture.page.title || capture.page.url}`,
    ...(viewerUrl ? [fillHandoff(t.handoff_full_context, { url: viewerUrl })] : []),
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
