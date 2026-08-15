import type { Pin, PageInfo } from "../types/index.js";

export function formatClipboardText(
  page: PageInfo,
  pins: Pin[],
  shotPath?: string | null,
  viewerUrl?: string | null
): string {
  const parts: string[] = [];

  parts.push(`Page: ${page.title || "(untitled)"}`);
  parts.push(`URL: ${page.url || "(unknown)"}`);
  if (viewerUrl) {
    parts.push(`Viewer: ${viewerUrl}`);
  }
  if (shotPath) {
    parts.push(`Screenshot: ${shotPath}`);
  }
  parts.push("");

  pins.forEach((pin) => {
    parts.push(`Pin #${pin.number}:`);
    parts.push(`Comment: ${pin.comment}`);
    if (pin.domPath) parts.push(`DOM: ${pin.domPath}`);
    if (pin.selector) parts.push(`Selector: ${pin.selector}`);
    if (pin.innerText) parts.push(`Text: "${pin.innerText.replace(/\n+/g, " ").trim()}"`);
    parts.push("");
  });

  return parts.join("\n").trim();
}

export function formatClipboardHtml(
  page: PageInfo,
  pins: Pin[],
  shotPath?: string | null,
  viewerUrl?: string | null
): string {
  const lines: string[] = [];
  lines.push(`<div data-pinar="bundle">`);
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
    lines.push(`<li>`);
    lines.push(`<strong>${escapeHtml(pin.comment)}</strong><br/>`);
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
