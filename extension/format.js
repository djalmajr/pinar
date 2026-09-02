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

function shotHtml(shot) {
  if (!shot) return [];
  if (shot.startsWith("data:")) {
    return [
      `<figure><img alt="Pinar pins" src="${shot}" style="max-width:100%;height:auto"/><figcaption>Colored annotation badges, not page UI</figcaption></figure>`,
    ];
  }
  return [`<p><strong>Screenshot:</strong> <code>${escapeHtml(shot)}</code></p>`];
}

function shotUrlForJson(shot) {
  if (!shot || String(shot).startsWith("data:")) return null;
  return shot;
}

function handoffWarnings({ shot, warnings = [], includeScreenshot = true } = {}) {
  const next = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
  if (includeScreenshot !== false && !shot && !next.includes("screenshot_missing")) next.push("screenshot_missing");
  if (typeof shot === "string" && shot.startsWith("data:") && !next.includes("screenshot_inline")) {
    next.push("screenshot_inline");
  }
  return [...new Set(next)];
}

function compactPinForHandoff(pin) {
  const selector = pin.selector || pin.locator?.cssSelector || undefined;
  const domPath = pin.path || pin.domPath || pin.locator?.domPath || undefined;
  const innerText = pin.text || pin.innerText || pin.locator?.innerText || undefined;
  const locator = {
    cssSelector: selector,
    domPath,
    innerText,
  };
  const hasLocator = Object.values(locator).some((value) => value !== undefined);
  const area = pin.kind === "area" || pin.type === "area";
  const needsGeometry = area || !hasLocator;
  const box = pin.box || pin.areaBox;
  return {
    box: needsGeometry ? box : undefined,
    comment: pin.comment || "",
    coords: needsGeometry && !box ? pin.coords : undefined,
    frameId: pin.frameId || undefined,
    kind: area ? "area" : undefined,
    locator: hasLocator ? locator : undefined,
    pinId: pin.pinId || pin.id || "",
    viewportAnchored: pin.viewportAnchored || undefined,
  };
}

function structuredHandoff({
  capabilities,
  captureId,
  page = {},
  pins = [],
  privacy,
  shot,
  warnings,
  includeScreenshot = true,
} = {}) {
  const deliveredShot = includeScreenshot === false ? null : shot;
  const compactCapabilities = {
    fullPage: capabilities?.fullPage || undefined,
    iframe: capabilities?.iframe || undefined,
  };
  const compactWarnings = handoffWarnings({ includeScreenshot, shot: deliveredShot, warnings });
  return JSON.stringify({
    capabilities: Object.values(compactCapabilities).some(Boolean) ? compactCapabilities : undefined,
    captureId: captureId || "",
    page: {
      ...(page.description ? { description: page.description } : {}),
      ...(page.title ? { title: page.title } : {}),
      url: page.url || "",
    },
    pins: pins.map(compactPinForHandoff),
    privacy: privacy?.redacted?.length || privacy?.unevaluated ? privacy : undefined,
    screenshot: shotUrlForJson(deliveredShot) ? { url: shotUrlForJson(deliveredShot) } : undefined,
    warnings: compactWarnings.length ? compactWarnings : undefined,
  });
}

function completeHandoff({
  capabilities,
  captureId,
  createdAt,
  page = {},
  pins = [],
  privacy,
  schemaVersion,
  shot,
  viewport,
  warnings,
  includeScreenshot = true,
} = {}) {
  const deliveredShot = includeScreenshot === false ? null : shot;
  const resolvedWarnings = handoffWarnings({ includeScreenshot, shot: deliveredShot, warnings });
  return JSON.stringify({
    capabilities,
    captureId: captureId || "",
    createdAt,
    page,
    pins: pins.map((pin) => ({ ...pin, pinId: pin.pinId || pin.id || "" })),
    privacy,
    schemaVersion: schemaVersion || 1,
    screenshot: {
      missing: includeScreenshot === false ? false : !deliveredShot,
      url: shotUrlForJson(deliveredShot),
    },
    viewport,
    warnings: resolvedWarnings,
  });
}

const DEFAULT_HANDOFF_MESSAGES = {
  handoff_instructions: "Implement the pin comments below. Use selector and DOM path as complementary locators.",
  handoff_screenshot_note: "Numbered screenshot badges are annotation overlays, not page UI.",
  handoff_full_context: "Full context (fetch only if the details above are insufficient): {url}",
};

function fillHandoff(template, vars) {
  let text = template;
  for (const [key, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${key}}`, String(value));
  }
  return text;
}

/**
 * @param {{
 *   capabilities?: { fullPage?: boolean, iframe?: boolean },
 *   captureId?: string,
 *   createdAt?: string,
 *   page?: { title?: string, url?: string },
 *   pins?: object[],
 *   privacy?: { redacted?: string[], unevaluated?: boolean },
 *   schemaVersion?: number,
 *   shot?: string,
 *   includeScreenshot?: boolean,
 *   handoffMode?: "compact" | "full",
 *   viewerUrl?: string,
 *   viewport?: object,
 *   warnings?: string[],
 *   messages?: Record<string, string>,
 * }} [input]
 */
export function formatClipboard({
  capabilities,
  captureId,
  createdAt,
  page = {},
  pins = [],
  privacy,
  schemaVersion,
  shot,
  includeScreenshot = true,
  handoffMode = "compact",
  viewport,
  viewerUrl,
  warnings,
  messages,
} = {}) {
  const finalViewer = viewerUrl ? (viewerUrl.endsWith(".md") ? viewerUrl : `${viewerUrl}.md`) : null;
  const deliveredShot = includeScreenshot === false ? null : shot;
  const resolvedWarnings = handoffWarnings({ includeScreenshot, shot: deliveredShot, warnings });
  const json = (handoffMode === "full" ? completeHandoff : structuredHandoff)({
    capabilities,
    captureId,
    createdAt,
    includeScreenshot,
    page,
    pins,
    privacy,
    schemaVersion,
    shot: deliveredShot,
    viewport,
    warnings: resolvedWarnings,
  });
  const copy = { ...DEFAULT_HANDOFF_MESSAGES, ...messages };
  const instructions = [
    copy.handoff_instructions,
    ...(deliveredShot ? [copy.handoff_screenshot_note] : []),
    ...(finalViewer ? [fillHandoff(copy.handoff_full_context, { url: finalViewer })] : []),
  ];
  const plain = `${instructions.join("\n")}\n\n\`\`\`pinar-visual-context\n${json}\n\`\`\`\n`;

  const htmlParts = [
    `<meta charset="utf-8"/>`,
    `<p>${instructions.map(escapeHtml).join("<br/>")}</p>`,
    ...shotHtml(deliveredShot),
  ];
  htmlParts.push(`<pre data-pinar="pinar-visual-context">${escapeHtml(json)}</pre>`);

  return { html: htmlParts.join("\n"), plain };
}

export function formatClipboardPayload(input = {}) {
  if (typeof input.viewerContent === "string" && !input.captureId) {
    return formatViewerContent(input.viewerContent);
  }
  return formatClipboard(input);
}
