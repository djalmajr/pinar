export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatViewerLink(viewerUrl) {
  const url = viewerUrl.endsWith(".md") ? viewerUrl : `${viewerUrl}.md`;
  const escapedUrl = escapeHtml(url);

  return {
    html: `<a href="${escapedUrl}">${escapedUrl}</a>`,
    plain: url,
  };
}

export function formatViewerContent(content) {
  const plain = String(content);
  return {
    html: `<pre>${escapeHtml(plain)}</pre>`,
    plain,
  };
}

function pinTitle(pin, index) {
  const kind = pin.kind === "area" ? "area" : "element";
  const label = pin.label?.trim();
  return `${index + 1}. ${kind}${label ? ` — ${label}` : ""}`;
}

function shotPlain(shot) {
  if (!shot) return [];
  if (shot.startsWith("data:")) return ["", `![Pinar pins](${shot})`];
  return [`Screenshot: ${shot}`];
}

function shotHtml(shot) {
  if (!shot) return [];
  if (shot.startsWith("data:")) {
    return [
      `<figure><img alt="Pinar pins" src="${shot}" style="max-width:100%;height:auto"/><figcaption>Colored annotation badges, not page UI</figcaption></figure>`,
    ];
  }
  return [`<p><strong>Screenshot:</strong> <code>${escapeHtml(shot)}</code></p>`];
}

function pinPlain(pin, index) {
  const lines = [`## ${pinTitle(pin, index)}`, ""];
  const pinId = pin.pinId || pin.id;
  if (pinId) lines.push(`pinId: ${pinId}`);
  lines.push(`Comment: ${pin.comment?.trim() || "(none)"}`);
  if (pin.path) lines.push(`DOM path: \`${pin.path}\``);
  if (pin.selector) lines.push(`Selector: \`${pin.selector}\``);
  if (pin.location) {
    lines.push(`Location: ${pin.location.confidence} (${pin.location.strategy})`);
    if (pin.location.warning === "cross-origin-frame") {
      lines.push("Warning: cross-origin iframe is not readable");
    }
  }
  if (pin.text) lines.push(`Visible text: ${JSON.stringify(pin.text)}`);
  if (pin.anchor) lines.push(`Pin: x=${pin.anchor.x}, y=${pin.anchor.y}`);
  if (pin.box) {
    lines.push(`Box: x=${pin.box.x}, y=${pin.box.y}, w=${pin.box.width}, h=${pin.box.height}`);
  }
  return lines.join("\n");
}

function pinHtml(pin, index) {
  const parts = [`<h2>${escapeHtml(pinTitle(pin, index))}</h2>`];
  const pinId = pin.pinId || pin.id;
  if (pinId) parts.push(`<p><strong>pinId:</strong> <code>${escapeHtml(pinId)}</code></p>`);
  parts.push(`<p><strong>Comment:</strong> ${escapeHtml(pin.comment?.trim() || "(none)")}</p>`);
  if (pin.path) {
    parts.push(`<p><strong>DOM path:</strong> <code>${escapeHtml(pin.path)}</code></p>`);
  }
  if (pin.selector) {
    parts.push(`<p><strong>Selector:</strong> <code>${escapeHtml(pin.selector)}</code></p>`);
  }
  if (pin.location) {
    parts.push(`<p><strong>Location:</strong> ${escapeHtml(pin.location.confidence)} (${escapeHtml(pin.location.strategy)})</p>`);
    if (pin.location.warning === "cross-origin-frame") {
      parts.push("<p><strong>Warning:</strong> cross-origin iframe is not readable</p>");
    }
  }
  if (pin.text) {
    parts.push(`<p><strong>Visible text:</strong> ${escapeHtml(pin.text)}</p>`);
  }
  if (pin.anchor) {
    parts.push(`<p><strong>Pin:</strong> x=${pin.anchor.x}, y=${pin.anchor.y}</p>`);
  }
  if (pin.box) {
    parts.push(
      `<p><strong>Box:</strong> x=${pin.box.x}, y=${pin.box.y}, w=${pin.box.width}, h=${pin.box.height}</p>`,
    );
  }
  return parts.join("\n");
}

function privacyLines(privacy) {
  const redacted = Array.isArray(privacy?.redacted) ? privacy.redacted.filter(Boolean) : [];
  const lines = [];
  if (redacted.length) lines.push(`Redacted: ${redacted.join(", ")}`);
  if (privacy?.unevaluated) lines.push("Warning: some regions could not be inspected");
  return lines;
}

function privacyHtml(privacy) {
  const lines = privacyLines(privacy);
  if (!lines.length) return [];
  return [`<p>${lines.map((line) => escapeHtml(line)).join("<br/>")}</p>`];
}

function shotUrlForJson(shot) {
  if (!shot || String(shot).startsWith("data:")) return null;
  return shot;
}

function handoffWarnings({ shot, warnings = [] } = {}) {
  const next = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
  if (!shot && !next.includes("screenshot_missing")) next.push("screenshot_missing");
  if (typeof shot === "string" && shot.startsWith("data:") && !next.includes("screenshot_inline")) {
    next.push("screenshot_inline");
  }
  return [...new Set(next)];
}

function structuredHandoff({
  capabilities,
  captureId,
  page = {},
  pins = [],
  privacy,
  schemaVersion,
  shot,
  warnings,
} = {}) {
  return JSON.stringify({
    capabilities: capabilities || { fullPage: false, iframe: false },
    captureId: captureId || "",
    page: { title: page.title || "", url: page.url || "" },
    pins: pins.map((pin) => ({
      comment: pin.comment || "",
      pinId: pin.pinId || pin.id || "",
      locator: {
        cssSelector: pin.selector || pin.locator?.cssSelector || "",
        domPath: pin.path || pin.locator?.domPath || "",
        innerText: pin.text || pin.locator?.innerText || "",
      },
    })),
    privacy: privacy || undefined,
    schemaVersion: schemaVersion || 1,
    screenshot: { missing: !shot, url: shotUrlForJson(shot) },
    warnings: handoffWarnings({ shot, warnings }),
  });
}

/**
 * @param {{
 *   capabilities?: { fullPage?: boolean, iframe?: boolean },
 *   captureId?: string,
 *   page?: { title?: string, url?: string },
 *   pins?: object[],
 *   privacy?: { redacted?: string[], unevaluated?: boolean },
 *   schemaVersion?: number,
 *   sentAt?: string,
 *   shot?: string,
 *   viewerUrl?: string,
 *   warnings?: string[],
 * }} [input]
 */
export function formatClipboard({
  capabilities,
  captureId,
  page = {},
  pins = [],
  privacy,
  schemaVersion,
  sentAt,
  shot,
  viewerUrl,
  warnings,
} = {}) {
  const when = sentAt || new Date().toISOString();
  const url = page.url || "(unknown)";
  const title = page.title || "(untitled)";
  const finalViewer = viewerUrl ? (viewerUrl.endsWith(".md") ? viewerUrl : `${viewerUrl}.md`) : null;
  const resolvedWarnings = handoffWarnings({ shot, warnings });
  const capabilityLabels = [
    capabilities?.fullPage ? "fullPage" : "",
    capabilities?.iframe ? "iframe" : "",
  ].filter(Boolean);
  const header = [
    "# Visual feedback",
    "",
    ...(captureId ? [`schemaVersion: ${schemaVersion || 1}`, `captureId: ${captureId}`] : []),
    `URL: ${url}`,
    `Title: ${title}`,
    `Copied: ${when}`,
    `Pins: ${pins.length}`,
    ...privacyLines(privacy),
    ...shotPlain(shot),
    ...(finalViewer ? [`Viewer: ${finalViewer}`] : []),
    ...(capabilityLabels.length ? [`Capabilities: ${capabilityLabels.join(", ")}`] : []),
    ...(resolvedWarnings.length ? [`Warnings: ${resolvedWarnings.join(", ")}`] : []),
    "",
    "Each pin is an instruction about that DOM node. Use the DOM path and selector to find the matching source.",
    "Colored numbered bubbles in the screenshot are annotation overlays, not part of the page.",
  ];
  const pinBlocks = pins.map((pin, index) => pinPlain(pin, index)).join("\n\n");
  const json = structuredHandoff({
    capabilities,
    captureId,
    page,
    pins,
    privacy,
    schemaVersion,
    shot,
    warnings: resolvedWarnings,
  });
  const plain = `${[...header, "", pinBlocks].join("\n")}\n\n\`\`\`pinar-visual-context\n${json}\n\`\`\`\n`;

  const htmlParts = [
    `<meta charset="utf-8"/>`,
    `<h1>Visual feedback</h1>`,
    ...(captureId
      ? [`<p><strong>schemaVersion:</strong> ${escapeHtml(String(schemaVersion || 1))}<br/><strong>captureId:</strong> ${escapeHtml(captureId)}</p>`]
      : []),
    `<p><strong>URL:</strong> ${escapeHtml(url)}<br/><strong>Title:</strong> ${escapeHtml(title)}<br/><strong>Copied:</strong> ${escapeHtml(when)}</p>`,
    ...privacyHtml(privacy),
    ...shotHtml(shot),
    ...(finalViewer ? [`<p><strong>Viewer:</strong> <a href="${escapeHtml(finalViewer)}">${escapeHtml(finalViewer)}</a></p>`] : []),
    ...(resolvedWarnings.length
      ? [`<p><strong>Warnings:</strong> ${escapeHtml(resolvedWarnings.join(", "))}</p>`]
      : []),
    `<p>Each pin is an instruction about that DOM node. Use the DOM path and selector to find the matching source.</p>`,
    `<p>Colored numbered bubbles in the screenshot are annotation overlays, not part of the page.</p>`,
  ];
  pins.forEach((pin, index) => {
    htmlParts.push(pinHtml(pin, index));
  });
  htmlParts.push(`<pre data-pinar="pinar-visual-context">${escapeHtml(json)}</pre>`);

  return { html: htmlParts.join("\n"), plain };
}

export function formatClipboardPayload(input = {}) {
  if (typeof input.viewerContent === "string" && !input.captureId) {
    return formatViewerContent(input.viewerContent);
  }
  return formatClipboard(input);
}
