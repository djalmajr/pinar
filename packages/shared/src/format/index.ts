import type { Pin, PageInfo } from "../types/index.js";
import { formatVisualContextMarkdown, parseVisualCapture } from "../visual-context/index.js";

export function formatClipboardText(
  page: PageInfo,
  pins: Pin[],
  shotPath?: string | null,
  viewerUrl?: string | null,
  captureId?: string,
): string {
  const capture = parseVisualCapture({
    captureId: captureId || "clipboard",
    page,
    pins,
    screenshot: { missing: !shotPath, url: shotPath || null },
  }, captureId || "clipboard");
  return formatVisualContextMarkdown(capture, viewerUrl);
}

export function formatClipboardHtml(
  page: PageInfo,
  pins: Pin[],
  shotPath?: string | null,
  viewerUrl?: string | null,
  captureId?: string,
): string {
  const lines: string[] = [];
  lines.push(`<div data-pinar="bundle">`);
  if (captureId) {
    lines.push(`<p><strong>schemaVersion:</strong> 1<br/><strong>captureId:</strong> ${escapeHtml(captureId)}</p>`);
  }
  lines.push(`<h3>${escapeHtml(page.title || "Page")}</h3>`);
  lines.push(`<p><strong>URL:</strong> <a href="${escapeHtml(page.url)}">${escapeHtml(page.url)}</a></p>`);
  if (viewerUrl) {
    lines.push(`<p><strong>Viewer:</strong> <a href="${escapeHtml(viewerUrl)}">${escapeHtml(viewerUrl)}</a></p>`);
  }
  if (shotPath) {
    lines.push(`<p><strong>Screenshot:</strong> <code>${escapeHtml(shotPath)}</code></p>`);
  }
  lines.push(`<ol>`);
  pins.forEach((pin) => {
    const pinId = pin.pinId || pin.id;
    lines.push(`<li>`);
    lines.push(`<strong>${escapeHtml(pin.comment)}</strong><br/>`);
    if (pinId) lines.push(`<small>pinId: <code>${escapeHtml(pinId)}</code></small><br/>`);
    if (pin.selector) lines.push(`<small><code>${escapeHtml(pin.selector)}</code></small>`);
    lines.push(`</li>`);
  });
  lines.push(`</ol>`);
  lines.push(`</div>`);
  return lines.join("\n");
}

function escapeHtml(str: string): string {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m] || m));
}
