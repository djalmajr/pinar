import {
  encodeVisualCaptureJson,
  formatVisualContextMarkdown,
  parseVisualCapture,
  type VisualCapture,
} from "../visual-context/index.js";

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
