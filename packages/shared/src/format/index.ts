import type { Pin, PageInfo } from "../types/index.js";
import { formatHandoffBundle } from "../handoff/index.js";
import { parseVisualCapture } from "../visual-context/index.js";

export function formatClipboardText(
  page: PageInfo,
  pins: Pin[],
  shotPath?: string | null,
  viewerUrl?: string | null,
  captureId?: string,
  includeScreenshot = true,
): string {
  const id = captureId || "clipboard";
  const capture = parseVisualCapture({
    captureId: id,
    page,
    pins,
    screenshot: {
      missing: includeScreenshot ? !shotPath : false,
      url: includeScreenshot ? shotPath || null : null,
    },
  }, id);
  return formatHandoffBundle(capture, viewerUrl).plain;
}

export function formatClipboardHtml(
  page: PageInfo,
  pins: Pin[],
  shotPath?: string | null,
  viewerUrl?: string | null,
  captureId?: string,
  includeScreenshot = true,
): string {
  const id = captureId || "clipboard";
  const deliveredShot = includeScreenshot ? shotPath : null;
  const capture = parseVisualCapture({
    captureId: id,
    page,
    pins,
    screenshot: {
      missing: includeScreenshot ? !shotPath : false,
      url: deliveredShot || null,
    },
  }, id);
  const bundle = formatHandoffBundle(capture, viewerUrl);
  const lines: string[] = [];
  lines.push(`<div data-pinar="bundle">`);
  lines.push(`<p><strong>schemaVersion:</strong> 1<br/><strong>captureId:</strong> ${escapeHtml(capture.captureId)}</p>`);
  lines.push(`<h3>${escapeHtml(page.title || "Page")}</h3>`);
  lines.push(`<p><strong>URL:</strong> <a href="${escapeHtml(page.url)}">${escapeHtml(page.url)}</a></p>`);
  if (viewerUrl) {
    lines.push(`<p><strong>Viewer:</strong> <a href="${escapeHtml(viewerUrl)}">${escapeHtml(viewerUrl)}</a></p>`);
  }
  if (deliveredShot) {
    lines.push(`<p><strong>Screenshot:</strong> <code>${escapeHtml(deliveredShot)}</code></p>`);
  }
  lines.push(`<ol>`);
  capture.pins.forEach((pin) => {
    lines.push(`<li>`);
    lines.push(`<strong>${escapeHtml(pin.comment)}</strong><br/>`);
    lines.push(`<small>pinId: <code>${escapeHtml(pin.pinId)}</code></small><br/>`);
    if (pin.locator.cssSelector) lines.push(`<small><code>${escapeHtml(pin.locator.cssSelector)}</code></small>`);
    lines.push(`</li>`);
  });
  lines.push(`</ol>`);
  lines.push(`<pre data-pinar="pinar-visual-context">${escapeHtml(bundle.json)}</pre>`);
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
