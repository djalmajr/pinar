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

// Mirror of the compact budgets in packages/shared/src/handoff (no shared->
// extension import): keep the numbers and the helpers in sync and test the
// parity in packages/shared/src/handoff.test.ts.
const COMPACT_INNER_TEXT_MAX = 120;
const COMPACT_EVIDENCE_MESSAGE_MAX = 200;
const COMPACT_EVIDENCE_MAX_ITEMS = 3;

function compactText(value, max) {
  if (typeof value !== "string") return undefined;
  const flat = value.replace(/\s+/gu, " ").trim();
  if (!flat) return undefined;
  const codePoints = Array.from(flat);
  if (codePoints.length <= max) return flat;
  return `${codePoints.slice(0, max - 1).join("")}…`;
}

function evidenceSignature(item) {
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

function compactEvidence(evidence) {
  if (!evidence || !Array.isArray(evidence.items) || !evidence.items.length) return undefined;
  const rank = (grade) => (grade === "after_interaction" ? 0 : 1);
  const ordered = [...evidence.items].sort((a, b) => rank(a.grade) - rank(b.grade));
  const seen = new Set();
  const items = [];
  for (const item of ordered) {
    if (!item.at || !item.origin) continue;
    const signature = evidenceSignature(item);
    if (seen.has(signature)) continue;
    seen.add(signature);
    const next = { at: item.at, grade: item.grade, kind: item.kind, origin: item.origin };
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

function compactLocation(location) {
  if (!location || location.warning !== "cross-origin-frame") return undefined;
  const next = { confidence: location.confidence, evidence: location.evidence, score: location.score, strategy: location.strategy, warning: location.warning };
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }
  return next;
}

function compactPinForHandoff(pin) {
  const selector = pin.selector || pin.locator?.cssSelector || undefined;
  // The selector and the DOM path are complementary locators: keep both when
  // they differ, and emit an identical pair only once.
  const rawDomPath = pin.path || pin.domPath || pin.locator?.domPath || undefined;
  const domPath = rawDomPath && rawDomPath !== selector ? rawDomPath : undefined;
  const innerText = compactText(pin.text || pin.innerText || pin.locator?.innerText, COMPACT_INNER_TEXT_MAX);
  const locator = {};
  if (selector) locator.cssSelector = selector;
  if (domPath) locator.domPath = domPath;
  if (innerText) locator.innerText = innerText;
  // Text alone cannot locate an element: geometry stays for areas and for
  // pins without a selector or DOM path, even when innerText is present.
  const hasLocator = Boolean(selector || domPath);
  const area = pin.kind === "area" || pin.type === "area";
  const needsGeometry = area || !hasLocator;
  const box = pin.box || pin.areaBox;
  // Mirrors compactPin in packages/shared/src/handoff: the snapshot stays
  // behind the viewer link; an accepted diagnosis and compacted evidence travel.
  return {
    box: needsGeometry ? box : undefined,
    comment: pin.comment || "",
    coords: needsGeometry && !box ? pin.coords : undefined,
    diagnosis: pin.diagnosis?.acceptedAt ? pin.diagnosis : undefined,
    evidence: compactEvidence(pin.evidence),
    frameId: pin.frameId || undefined,
    kind: area ? "area" : undefined,
    locator: Object.keys(locator).length ? locator : undefined,
    location: compactLocation(pin.location),
    pinId: pin.pinId || pin.id || "",
    viewportAnchored: pin.viewportAnchored || undefined,
  };
}

function reproductionForHandoff(reproduction) {
  if (!reproduction || !Array.isArray(reproduction.steps) || reproduction.steps.length === 0) return undefined;
  return {
    ...reproduction,
    steps: reproduction.steps.map(({ thumbnail, ...step }) => step),
  };
}

function structuredHandoff({
  capabilities,
  captureId,
  page = {},
  pins = [],
  privacy,
  reproduction,
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
      // page.description is generic page metadata: it stays out of the prompt.
      ...(page.title ? { title: page.title } : {}),
      url: page.url || "",
    },
    pins: pins.map(compactPinForHandoff),
    privacy: privacy?.redacted?.length || privacy?.unevaluated ? privacy : undefined,
    reproduction: reproductionForHandoff(reproduction),
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
  reproduction,
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
    pins: pins.map((pin) => ({
      ...pin,
      diagnosis: pin.diagnosis?.acceptedAt ? pin.diagnosis : undefined,
      pinId: pin.pinId || pin.id || "",
    })),
    privacy,
    reproduction: reproductionForHandoff(reproduction),
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
  handoff_instructions: "The pin notes below may ask for a change or an explanation. Use selector and DOM path as complementary locators.",
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
 *   reproduction?: object,
 *   schemaVersion?: number,
 *   shot?: string,
 *   includeScreenshot?: boolean,
 *   handoffMode?: "compact" | "full",
 *   viewport?: object,
 *   viewerUrl?: string,
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
  reproduction,
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
    reproduction,
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
  if (typeof input.viewerContent === "string") {
    return formatViewerContent(input.viewerContent);
  }
  return formatClipboard(input);
}
