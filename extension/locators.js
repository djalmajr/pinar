(() => {
  const FRAME_BOUNDARY = " ::frame:: ";
  const STRATEGY_ORDER = ["stable-selector", "structure", "semantic", "geometry"];
  const SIMPLE_SELECTOR =
    /^(?<tag>[a-z][\w-]*)?(?<id>#[^\s.#:[]+)?(?<classes>(?:\.[^\s.#:[]+)*)?(?<attr>\[[^\]]+\])?(?<nth>:nth-of-type\(\d+\))?$/i;

  function escapeCssIdent(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
    return String(value).replace(/[^\w-]/g, (char) => `\\${char}`);
  }

  function splitFrameDomPath(path = "") {
    return String(path)
      .split(FRAME_BOUNDARY)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function normalizeVisibleText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  function isStableClassName(name) {
    if (!name) return false;
    if (/[_-][a-f0-9]{5,}$/i.test(name)) return false;
    if (name.length >= 8 && /\d/.test(name) && /[A-Z]/.test(name) && /[a-z]/.test(name)) return false;
    return true;
  }

  function parseSimpleSelector(raw) {
    const value = String(raw || "").trim();
    if (!value) return null;
    const match = SIMPLE_SELECTOR.exec(value);
    if (!match?.groups) return null;
    const classes = match.groups.classes
      ? [...match.groups.classes.matchAll(/\.([^\s.#:[]+)/g)].map((item) => item[1] || "")
      : [];
    let attr;
    if (match.groups.attr) {
      const attrMatch = /^\[([^=\]]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]$/.exec(match.groups.attr);
      if (!attrMatch) return null;
      attr = { name: attrMatch[1], value: attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] };
    }
    const nth = match.groups.nth ? Number(match.groups.nth.replace(/\D+/g, "")) : undefined;
    return {
      attr,
      classes: classes.filter(Boolean),
      id: match.groups.id ? match.groups.id.slice(1) : undefined,
      nthOfType: Number.isFinite(nth) ? nth : undefined,
      tag: match.groups.tag?.toLowerCase(),
    };
  }

  function splitChildSelector(selector) {
    return String(selector || "")
      .split(/\s*>\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function queryAll(root, selector) {
    if (!selector || !root?.querySelectorAll) return [];
    try {
      return [...root.querySelectorAll(selector)];
    } catch {
      return [];
    }
  }

  function uniqueQuery(root, selector) {
    const matches = queryAll(root, selector);
    return matches.length === 1 ? matches[0] : null;
  }

  function walk(element, out = []) {
    if (!element) return out;
    out.push(element);
    for (const child of element.children || []) walk(child, out);
    return out;
  }

  function allElements(root) {
    return walk(root.body || root.documentElement || root.querySelector?.("body"));
  }

  function identity(element) {
    return element.getAttribute?.("data-key")
      || (element.id ? `#${element.id}` : "")
      || element.getAttribute?.("data-testid")
      || `${element.tagName?.toLowerCase()}:${normalizeVisibleText(element.innerText || element.textContent).slice(0, 32)}`;
  }

  function fingerprintOf(input = {}) {
    return {
      ...input.fingerprint,
      tag: input.fingerprint?.tag || input.tag,
      text: input.fingerprint?.text || normalizeVisibleText(input.innerText),
    };
  }

  function isPositionalSelector(selector) {
    return /:nth-(?:of-type|child)\s*\(/i.test(selector);
  }

  function lookalikeCount(root, fingerprint) {
    const text = fingerprint.text;
    const tag = fingerprint.tag;
    const classes = fingerprint.classes || [];
    if (!text && !classes.length) return 0;
    return allElements(root).filter((element) => {
      if (tag && element.tagName.toLowerCase() !== tag) return false;
      if (text && normalizeVisibleText(element.innerText || element.textContent) !== text) return false;
      if (classes.length && classes.some((name) => !element.classList.contains(name))) return false;
      return true;
    }).length;
  }

  function fingerprintDisagrees(element, fingerprint) {
    if (fingerprint.id && element.id === fingerprint.id) return false;
    if (fingerprint.testId) {
      const testId = element.getAttribute("data-testid") || element.getAttribute("data-test");
      if (testId === fingerprint.testId) return false;
    }
    const text = normalizeVisibleText(element.innerText || element.textContent);
    if (fingerprint.text && text && fingerprint.text !== text) return true;
    if (fingerprint.classes?.length && fingerprint.classes.every((name) => !element.classList.contains(name))) {
      return true;
    }
    return false;
  }

  function uniqueCssScore(root, element, fingerprint, selector) {
    let score = 0.94;
    if (fingerprint.id && element.id && element.id !== fingerprint.id) score = Math.min(score, 0.28);
    if (fingerprint.id && !element.id) score = Math.min(score, 0.55);
    const testId = element.getAttribute?.("data-testid") || element.getAttribute?.("data-test");
    if (fingerprint.testId && testId && testId !== fingerprint.testId) score = Math.min(score, 0.28);
    const text = normalizeVisibleText(element.innerText || element.textContent);
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

  function boxOf(element) {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width, x: rect.x ?? rect.left, y: rect.y ?? rect.top };
  }

  function centerDistance(a, b) {
    return Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));
  }

  function iou(a, b) {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const overlap = x * y;
    const union = a.width * a.height + b.width * b.height - overlap;
    return union > 0 ? overlap / union : 0;
  }

  function nthOfType(element) {
    const parent = element.parentElement;
    if (!parent) return 1;
    const tag = element.tagName.toLowerCase();
    let index = 0;
    for (const child of parent.children) {
      if (child.tagName.toLowerCase() !== tag) continue;
      index += 1;
      if (child === element) return index;
    }
    return index || 1;
  }

  function captureFingerprint(element) {
    return {
      classes: [...(element.classList || [])].filter(isStableClassName),
      id: element.id || undefined,
      name: element.getAttribute("aria-label") || element.getAttribute("name") || undefined,
      nthOfType: nthOfType(element),
      role: element.getAttribute("role") || undefined,
      tag: element.tagName.toLowerCase(),
      testId: element.getAttribute("data-testid") || element.getAttribute("data-test") || undefined,
      text: normalizeVisibleText(element.innerText || element.textContent),
    };
  }

  function stableSelector(root, element) {
    const fingerprint = captureFingerprint(element);
    const candidates = [];
    if (fingerprint.id) candidates.push(`#${escapeCssIdent(fingerprint.id)}`);
    if (fingerprint.testId) candidates.push(`[data-testid="${fingerprint.testId.replaceAll('"', '\\"')}"]`);
    if (fingerprint.name && fingerprint.tag) {
      candidates.push(`${fingerprint.tag}[name="${fingerprint.name.replaceAll('"', '\\"')}"]`);
    }
    for (const selector of candidates) {
      const matches = queryAll(root, selector);
      if (matches.length === 1 && matches[0] === element) return selector;
    }
    return null;
  }

  function stableSelectors(input) {
    const fingerprint = fingerprintOf(input);
    const selectors = [];
    if (fingerprint.id) selectors.push({ evidence: "id", selector: `#${escapeCssIdent(fingerprint.id)}` });
    if (fingerprint.testId) {
      selectors.push({ evidence: "testid", selector: `[data-testid="${fingerprint.testId.replaceAll('"', '\\"')}"]` });
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

  function stableSelectorCandidates(root, input) {
    const ranked = [];
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

  function childMatches(parent, part) {
    const parsed = parseSimpleSelector(part);
    if (!parsed) return [];
    return [...parent.children].filter((child) => {
      if (parsed.tag && child.tagName.toLowerCase() !== parsed.tag) return false;
      if (parsed.id && child.id !== parsed.id) return false;
      if (parsed.classes.some((name) => !child.classList.contains(name))) return false;
      if (parsed.attr) {
        const actual = child.getAttribute(parsed.attr.name);
        if (parsed.attr.value === undefined) {
          if (actual == null) return false;
        } else if (actual !== parsed.attr.value) return false;
      }
      if (parsed.nthOfType) return nthOfType(child) === parsed.nthOfType;
      return true;
    });
  }

  function structureCandidates(root, input) {
    const path = splitFrameDomPath(input.domPath || "").at(-1) || input.domPath || "";
    let parts = splitChildSelector(path);
    while (parts[0] && /^(html|body)([#.:[]|$)/i.test(parts[0])) parts = parts.slice(1);
    if (!parts.length) return [];
    let current = queryAll(root, parts[0]);
    for (const part of parts.slice(1)) {
      const next = [];
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
        strategy: "structure",
      };
    });
  }

  function semanticCandidates(root, input) {
    const fingerprint = fingerprintOf(input);
    const { name, role, tag, text } = fingerprint;
    if (!text && !name && !role) return [];
    const matches = allElements(root).filter((element) => {
      if (tag && element.tagName.toLowerCase() !== tag) return false;
      if (role && element.getAttribute("role") !== role) return false;
      if (name) {
        const actual = element.getAttribute("aria-label") || element.getAttribute("name") || "";
        if (actual !== name) return false;
      }
      if (text && normalizeVisibleText(element.innerText || element.textContent) !== text) return false;
      return true;
    });
    const uniqueSignals = [text, name, role].filter(Boolean).length;
    return matches.map((element) => ({
      element,
      evidence: [text ? "visible text" : "", name ? "accessible name" : "", role ? "role" : ""].filter(Boolean),
      score: matches.length === 1 ? (uniqueSignals > 1 ? 0.8 : 0.7) : 0.52,
      strategy: "semantic",
    }));
  }

  function geometryCandidates(root, input) {
    const box = input.geometry?.box;
    if (!box) return [];
    const fingerprint = fingerprintOf(input);
    const tag = fingerprint.tag;
    const twins = lookalikeCount(root, fingerprint);
    return allElements(root).flatMap((element) => {
      if (tag && element.tagName.toLowerCase() !== tag) return [];
      const next = boxOf(element);
      if (!(next.width > 0 && next.height > 0)) return [];
      const overlap = iou(box, next);
      const distance = centerDistance(box, next);
      let score = overlap >= 0.45 ? 0.5 + overlap * 0.2 : Math.max(0, 0.48 - distance / 400);
      if (twins > 1) score = Math.min(score, 0.4);
      if (score < 0.35) return [];
      return [{
        element,
        evidence: overlap >= 0.45 ? [`geometry iou ${overlap.toFixed(2)}`] : [`geometry distance ${Math.round(distance)}`],
        score,
        strategy: "geometry",
      }];
    });
  }

  function merge(ranked) {
    const best = new Map();
    for (const item of ranked) {
      const current = best.get(item.element);
      if (!current || item.score > current.score) best.set(item.element, item);
    }
    return [...best.values()].sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return STRATEGY_ORDER.indexOf(left.strategy) - STRATEGY_ORDER.indexOf(right.strategy);
    });
  }

  function view(item) {
    return { evidence: item.evidence, key: identity(item.element), score: item.score, strategy: item.strategy };
  }

  function unresolved(evidence, warning) {
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

  function classify(ranked, warning) {
    const viable = ranked.filter((item) => item.score >= 0.5);
    if (!viable.length) return unresolved(["no viable locator match"], warning);
    const top = viable[0];
    const runner = viable[1];
    if (runner && top.score - runner.score < 0.12) {
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
    let confidence = "probable";
    if (top.strategy === "stable-selector" && top.score >= 0.9) confidence = "exact";
    else if (top.strategy === "structure" && top.score >= 0.9) confidence = "exact";
    else if (top.score < 0.55) return unresolved(["score below relocation threshold"], warning);
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

  function resolveFrameChain(root, input) {
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

  function resolveLocator(root, input = {}) {
    if (input.kind === "area") return unresolved(["area pins are not element targets"]);
    const chain = resolveFrameChain(root, input);
    if (chain.warning === "cross-origin-frame") {
      return unresolved(["iframe contentDocument is not readable"], "cross-origin-frame");
    }
    const inFrame = { ...input, domPath: splitFrameDomPath(input.domPath || "").at(-1) || input.domPath };
    return classify(merge([
      ...stableSelectorCandidates(chain.root, inFrame),
      ...structureCandidates(chain.root, inFrame),
      ...semanticCandidates(chain.root, inFrame),
      ...geometryCandidates(chain.root, inFrame),
    ]), chain.warning);
  }

  function locateResultMeta(result) {
    return {
      confidence: result.confidence,
      evidence: result.evidence,
      score: result.score,
      strategy: result.strategy,
      warning: result.warning,
    };
  }

  function isPendingLocation(location) {
    return location?.confidence === "ambiguous" || location?.confidence === "unresolved";
  }

  globalThis.__pinarLocators = Object.freeze({
    FRAME_BOUNDARY,
    captureFingerprint,
    isPendingLocation,
    locateResultMeta,
    resolveLocator,
    splitFrameDomPath,
    stableSelector,
  });
})();
