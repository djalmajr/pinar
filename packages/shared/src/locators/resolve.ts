import { escapeCssIdent, normalizeVisibleText, parseSimpleSelector, splitChildSelector, splitFrameDomPath } from "./css.js";
import { FRAME_BOUNDARY } from "./types.js";
import type {
  LocateBox,
  LocateCandidateView,
  LocateElement,
  LocateInput,
  LocateResult,
  LocateRoot,
  LocateStrategy,
  PinLocation,
  VisualFingerprint,
} from "./types.js";

interface Ranked {
  element: LocateElement;
  evidence: string[];
  score: number;
  strategy: LocateStrategy;
}

const STRATEGY_ORDER: LocateStrategy[] = ["stable-selector", "structure", "semantic", "geometry"];

function queryAll(root: LocateRoot, selector: string): LocateElement[] {
  if (!selector) return [];
  try {
    return [...root.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function uniqueQuery(root: LocateRoot, selector: string) {
  const matches = queryAll(root, selector);
  return matches.length === 1 ? matches[0] : null;
}

function walk(element: LocateElement | null, out: LocateElement[] = []): LocateElement[] {
  if (!element) return out;
  out.push(element);
  for (const child of element.children) walk(child, out);
  return out;
}

function allElements(root: LocateRoot) {
  return walk(root.body ?? root.querySelector("html") ?? root.querySelector("body"));
}

function identity(element: LocateElement) {
  return element.getAttribute("data-key")
    || (element.id ? `#${element.id}` : "")
    || element.getAttribute("data-testid")
    || `${element.tagName.toLowerCase()}:${normalizeVisibleText(element.textContent).slice(0, 32)}`;
}

function fingerprintOf(input: LocateInput): VisualFingerprint {
  return {
    ...input.fingerprint,
    tag: input.fingerprint?.tag || input.tag,
    text: input.fingerprint?.text || normalizeVisibleText(input.innerText),
  };
}

function isPositionalSelector(selector: string) {
  return /:nth-(?:of-type|child)\s*\(/i.test(selector);
}

function lookalikeCount(root: LocateRoot, fingerprint: VisualFingerprint) {
  const text = fingerprint.text;
  const tag = fingerprint.tag;
  const classes = fingerprint.classes || [];
  if (!text && !classes.length) return 0;
  return allElements(root).filter((element) => {
    if (tag && element.tagName.toLowerCase() !== tag) return false;
    if (text && normalizeVisibleText(element.textContent) !== text) return false;
    if (classes.length && classes.some((name) => !element.classList.contains(name))) return false;
    return true;
  }).length;
}

function fingerprintDisagrees(element: LocateElement, fingerprint: VisualFingerprint) {
  if (fingerprint.id && element.id === fingerprint.id) return false;
  if (fingerprint.testId) {
    const testId = element.getAttribute("data-testid") || element.getAttribute("data-test");
    if (testId === fingerprint.testId) return false;
  }
  const text = normalizeVisibleText(element.textContent);
  if (fingerprint.text && text && fingerprint.text !== text) return true;
  if (fingerprint.classes?.length && fingerprint.classes.every((name) => !element.classList.contains(name))) {
    return true;
  }
  return false;
}

function uniqueCssScore(
  root: LocateRoot,
  element: LocateElement,
  fingerprint: VisualFingerprint,
  selector: string,
) {
  let score = 0.94;
  if (fingerprint.id && element.id && element.id !== fingerprint.id) score = Math.min(score, 0.28);
  if (fingerprint.id && !element.id) score = Math.min(score, 0.55);
  if (fingerprint.testId) {
    const testId = element.getAttribute("data-testid") || element.getAttribute("data-test");
    if (testId && testId !== fingerprint.testId) score = Math.min(score, 0.28);
  }
  const text = normalizeVisibleText(element.textContent);
  if (fingerprint.text && text && fingerprint.text !== text) score = Math.min(score, 0.28);
  if (fingerprint.classes?.length) {
    const hits = fingerprint.classes.filter((name) => element.classList.contains(name)).length;
    if (hits === 0) score = Math.min(score, 0.4);
  }
  if (isPositionalSelector(selector)) {
    if (lookalikeCount(root, fingerprint) > 1) return Math.min(score, 0.4);
    score = Math.min(score, 0.74);
  }
  return score;
}

function boxOf(element: LocateElement): LocateBox {
  const rect = element.getBoundingClientRect();
  return {
    height: rect.height,
    width: rect.width,
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
  };
}

function centerDistance(a: LocateBox, b: LocateBox) {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function iou(a: LocateBox, b: LocateBox) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const x = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const overlap = x * y;
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

function stableSelectors(input: LocateInput) {
  const fingerprint = fingerprintOf(input);
  const selectors: Array<{ evidence: string; selector: string }> = [];
  if (fingerprint.id) {
    selectors.push({ evidence: "id", selector: `#${escapeCssIdent(fingerprint.id)}` });
  }
  if (fingerprint.testId) {
    selectors.push({
      evidence: "testid",
      selector: `[data-testid="${fingerprint.testId.replaceAll('"', '\\"')}"]`,
    });
  }
  if (fingerprint.name && fingerprint.tag) {
    selectors.push({
      evidence: "name",
      selector: `${fingerprint.tag}[name="${fingerprint.name.replaceAll('"', '\\"')}"]`,
    });
  }
  if (input.cssSelector) selectors.push({ evidence: "css", selector: input.cssSelector });
  return selectors;
}

function stableSelectorCandidates(root: LocateRoot, input: LocateInput): Ranked[] {
  const ranked: Ranked[] = [];
  const fingerprint = fingerprintOf(input);
  for (const candidate of stableSelectors(input)) {
    const matches = queryAll(root, candidate.selector);
    if (matches.length === 1) {
      const element = matches[0];
      const score = candidate.evidence === "css"
        ? uniqueCssScore(root, element, fingerprint, candidate.selector)
        : 1;
      ranked.push({
        element,
        evidence: [`unique ${candidate.evidence} selector`],
        score,
        strategy: "stable-selector",
      });
    } else if (matches.length > 1) {
      for (const element of matches) {
        ranked.push({
          element,
          evidence: [`ambiguous ${candidate.evidence} selector (${matches.length})`],
          score: 0.4,
          strategy: "stable-selector",
        });
      }
    }
  }
  return ranked;
}

function childMatches(parent: LocateElement, part: string) {
  return [...parent.children].filter((child) => {
    const parsed = parseSimpleSelector(part);
    if (!parsed) return false;
    if (parsed.tag && child.tagName.toLowerCase() !== parsed.tag) return false;
    if (parsed.id && child.id !== parsed.id) return false;
    if (parsed.classes.some((name) => !child.classList.contains(name))) return false;
    if (parsed.attr) {
      const actual = child.getAttribute(parsed.attr.name);
      if (parsed.attr.value === undefined) {
        if (actual == null) return false;
      } else if (actual !== parsed.attr.value) return false;
    }
    if (parsed.nthOfType) {
      const tag = child.tagName.toLowerCase();
      let index = 0;
      for (const sibling of parent.children) {
        if (sibling.tagName.toLowerCase() !== tag) continue;
        index += 1;
        if (sibling === child) return index === parsed.nthOfType;
      }
      return false;
    }
    return true;
  });
}

function structureCandidates(root: LocateRoot, input: LocateInput): Ranked[] {
  const path = splitFrameDomPath(input.domPath || "").at(-1) || input.domPath || "";
  let parts = splitChildSelector(path);
  while (parts[0] && /^(html|body)([#.:[]|$)/i.test(parts[0])) parts = parts.slice(1);
  if (!parts.length) return [];
  let current = queryAll(root, parts[0] || "");
  for (const part of parts.slice(1)) {
    const next: LocateElement[] = [];
    for (const node of current) next.push(...childMatches(node, part));
    current = next;
    if (!current.length) break;
  }
  const fingerprint = fingerprintOf(input);
  const onlyNth = Boolean(parseSimpleSelector(parts.at(-1) || "")?.nthOfType)
    && !fingerprint.id
    && !fingerprint.testId;
  const twins = lookalikeCount(root, fingerprint);
  return current.map((element) => {
    let score = 0.42;
    if (current.length === 1) {
      if (fingerprintDisagrees(element, fingerprint)) score = 0.38;
      else if (onlyNth && twins > 1) score = 0.4;
      else if (onlyNth) score = 0.74;
      else score = 0.92;
    }
    return {
      element,
      evidence: current.length === 1 ? ["unique DOM path"] : [`${current.length} DOM path matches`],
      score,
      strategy: "structure" as const,
    };
  });
}

function semanticCandidates(root: LocateRoot, input: LocateInput): Ranked[] {
  const fingerprint = fingerprintOf(input);
  const text = fingerprint.text;
  const tag = fingerprint.tag;
  const name = fingerprint.name;
  const role = fingerprint.role;
  if (!text && !name && !role) return [];
  const matches = allElements(root).filter((element) => {
    if (tag && element.tagName.toLowerCase() !== tag) return false;
    if (role && element.getAttribute("role") !== role) return false;
    if (name) {
      const actual = element.getAttribute("aria-label") || element.getAttribute("name") || "";
      if (actual !== name) return false;
    }
    if (text && normalizeVisibleText(element.textContent) !== text) return false;
    return true;
  });
  const uniqueSignals = [text, name, role].filter(Boolean).length;
  return matches.map((element) => ({
    element,
    evidence: [
      text ? "visible text" : "",
      name ? "accessible name" : "",
      role ? "role" : "",
    ].filter(Boolean),
    score: matches.length === 1 ? (uniqueSignals > 1 ? 0.8 : 0.7) : 0.52,
    strategy: "semantic" as const,
  }));
}

function geometryCandidates(root: LocateRoot, input: LocateInput): Ranked[] {
  const box = input.geometry?.box;
  if (!box) return [];
  const fingerprint = fingerprintOf(input);
  const tag = fingerprint.tag;
  const twins = lookalikeCount(root, fingerprint);
  const pool = allElements(root).filter((element) => {
    if (tag && element.tagName.toLowerCase() !== tag) return false;
    const next = boxOf(element);
    return next.width > 0 && next.height > 0;
  });
  return pool.map((element) => {
    const next = boxOf(element);
    const overlap = iou(box, next);
    const distance = centerDistance(box, next);
    let score = overlap >= 0.45
      ? 0.5 + overlap * 0.2
      : Math.max(0, 0.48 - distance / 400);
    if (twins > 1) score = Math.min(score, 0.4);
    return {
      element,
      evidence: overlap >= 0.45 ? [`geometry iou ${overlap.toFixed(2)}`] : [`geometry distance ${Math.round(distance)}`],
      score,
      strategy: "geometry" as const,
    };
  }).filter((item) => item.score >= 0.35);
}

function merge(ranked: Ranked[]): Ranked[] {
  const best = new Map<LocateElement, Ranked>();
  for (const item of ranked) {
    const current = best.get(item.element);
    if (!current || item.score > current.score) best.set(item.element, item);
  }
  return [...best.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return STRATEGY_ORDER.indexOf(left.strategy) - STRATEGY_ORDER.indexOf(right.strategy);
  });
}

function view(item: Ranked): LocateCandidateView {
  return {
    evidence: item.evidence,
    key: identity(item.element),
    score: item.score,
    strategy: item.strategy,
  };
}

function unresolved(evidence: string[], warning?: LocateResult["warning"]): LocateResult {
  return {
    candidates: [],
    confidence: "unresolved",
    element: null,
    evidence,
    score: 0,
    strategy: "none",
    warning,
  };
}

function classify(ranked: Ranked[], warning?: LocateResult["warning"]): LocateResult {
  const viable = ranked.filter((item) => item.score >= 0.5);
  if (!viable.length) return unresolved(["no viable locator match"], warning);
  const top = viable[0];
  const runner = viable[1];
  const competing = runner && top.score - runner.score < 0.12;
  if (competing) {
    return {
      candidates: viable.slice(0, 5).map(view),
      confidence: "ambiguous",
      element: null,
      evidence: ["competing candidates", ...top.evidence],
      score: top.score,
      strategy: top.strategy,
      warning,
    };
  }
  let confidence: LocateResult["confidence"] = "probable";
  if (top.strategy === "stable-selector" && top.score >= 0.9) confidence = "exact";
  else if (top.strategy === "structure" && top.score >= 0.9) confidence = "exact";
  else if (top.score >= 0.55) confidence = "probable";
  else return unresolved(["score below relocation threshold"], warning);
  if (top.strategy === "geometry" || top.strategy === "semantic") confidence = "probable";
  return {
    candidates: viable.slice(0, 5).map(view),
    confidence,
    element: top.element,
    evidence: top.evidence,
    score: top.score,
    strategy: top.strategy,
    warning,
  };
}

function resolveFrameChain(root: LocateRoot, input: LocateInput): { root: LocateRoot; warning?: LocateResult["warning"] } {
  const frames = splitFrameDomPath(input.domPath || "");
  if (frames.length <= 1) return { root };
  let current = root;
  for (const selector of frames.slice(0, -1)) {
    const iframe = uniqueQuery(current, selector) ?? queryAll(current, selector)[0];
    if (!iframe) return { root: current };
    if (!iframe.contentDocument) return { root: current, warning: "cross-origin-frame" };
    current = iframe.contentDocument;
  }
  return { root: current };
}

export function resolveLocator(root: LocateRoot, input: LocateInput): LocateResult {
  if (input.kind === "area") return unresolved(["area pins are not element targets"]);
  const chain = resolveFrameChain(root, input);
  if (chain.warning === "cross-origin-frame") {
    return unresolved(["iframe contentDocument is not readable"], "cross-origin-frame");
  }
  const scoped = chain.root;
  const inFrame = { ...input, domPath: splitFrameDomPath(input.domPath || "").at(-1) || input.domPath };
  const ranked = merge([
    ...stableSelectorCandidates(scoped, inFrame),
    ...structureCandidates(scoped, inFrame),
    ...semanticCandidates(scoped, inFrame),
    ...geometryCandidates(scoped, inFrame),
  ]);
  return classify(ranked, chain.warning);
}

export function locateResultMeta(result: LocateResult): PinLocation {
  return {
    confidence: result.confidence,
    evidence: result.evidence,
    score: result.score,
    strategy: result.strategy,
    warning: result.warning,
  };
}

export { FRAME_BOUNDARY };
