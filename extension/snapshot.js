// Element snapshot (Visual Context v1 `pin.snapshot`, DJA-167). Classic script:
// content scripts are loaded without modules. Serializes the pinned element's
// subtree with the computed styles that differ from the user agent defaults,
// the fonts and icons it uses, and a shallow view of its parent and siblings.
// Keep the limits in sync with SNAPSHOT_LIMITS in packages/shared.
(() => {
  const VERSION = 1;
  const LIMITS = Object.freeze({
    maxAttrLength: 300,
    maxBytes: 96_000,
    maxDepth: 12,
    maxNodes: 400,
    maxSiblings: 12,
    maxSvgLength: 4_000,
    maxTextLength: 400,
  });

  const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template", "link", "meta", "head"]);
  const INTRINSIC_TAGS = new Set(["img", "svg", "video", "canvas", "iframe", "input", "select", "textarea", "button", "progress", "meter"]);
  const ATTRIBUTES = [
    "alt",
    "aria-label",
    "checked",
    "class",
    "disabled",
    "for",
    "height",
    "href",
    "id",
    "name",
    "placeholder",
    "role",
    "src",
    "target",
    "title",
    "type",
    "width",
  ];
  const ICON_CLASS = /^(bi|fa[srlbd]?|fa-[a-z0-9-]+|heroicon|i-[a-z]|icon-|iconify|lucide|material-icons|material-symbols|mdi|ph-|ri-|tabler-icon)/;

  // Properties worth carrying: layout, box model, typography, paint, effects.
  const LAYOUT = [
    "display",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "z-index",
    "flex-direction",
    "flex-wrap",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "justify-content",
    "align-items",
    "align-self",
    "align-content",
    "row-gap",
    "column-gap",
    "grid-template-columns",
    "grid-template-rows",
    "grid-auto-flow",
    "grid-column-start",
    "grid-column-end",
    "grid-row-start",
    "grid-row-end",
    "order",
    "box-sizing",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "overflow-x",
    "overflow-y",
    "float",
    "vertical-align",
  ];
  const TYPOGRAPHY = [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-transform",
    "text-decoration-line",
    "white-space",
    "text-overflow",
    "word-break",
  ];
  const PAINT = [
    "color",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "background-repeat",
    "opacity",
    "visibility",
    "box-shadow",
    "outline-width",
    "outline-style",
    "outline-color",
    "cursor",
    "transform",
    "transition-property",
    "transition-duration",
    "object-fit",
    "list-style-type",
    "fill",
    "stroke",
  ];
  const SIDES = ["top", "right", "bottom", "left"];
  const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
  const CONTEXT_PROPERTIES = new Set([
    "display",
    "position",
    "flex-direction",
    "flex-wrap",
    "justify-content",
    "align-items",
    "align-self",
    "row-gap",
    "column-gap",
    "grid-template-columns",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "font-size",
    "line-height",
    "width",
    "height",
    "vertical-align",
  ]);

  // Generic user agent defaults, used when the isolated baseline frame is
  // unavailable (a page CSP that forbids frames, a detached document).
  const FALLBACK_DEFAULTS = {
    "align-content": "normal",
    "align-items": "normal",
    "align-self": "auto",
    "background-color": "rgba(0, 0, 0, 0)",
    "background-image": "none",
    "background-position": "0% 0%",
    "background-repeat": "repeat",
    "background-size": "auto",
    bottom: "auto",
    "box-shadow": "none",
    "box-sizing": "content-box",
    "column-gap": "normal",
    cursor: "auto",
    float: "none",
    "flex-basis": "auto",
    "flex-direction": "row",
    "flex-grow": "0",
    "flex-shrink": "1",
    "flex-wrap": "nowrap",
    "font-style": "normal",
    "grid-auto-flow": "row",
    "grid-column-end": "auto",
    "grid-column-start": "auto",
    "grid-row-end": "auto",
    "grid-row-start": "auto",
    "grid-template-columns": "none",
    "grid-template-rows": "none",
    "justify-content": "normal",
    left: "auto",
    "letter-spacing": "normal",
    "list-style-type": "disc",
    "max-height": "none",
    "max-width": "none",
    "min-height": "0px",
    "min-width": "0px",
    "object-fit": "fill",
    opacity: "1",
    order: "0",
    "outline-style": "none",
    "overflow-x": "visible",
    "overflow-y": "visible",
    position: "static",
    right: "auto",
    "row-gap": "normal",
    "text-align": "start",
    "text-decoration-line": "none",
    "text-overflow": "clip",
    "text-transform": "none",
    top: "auto",
    transform: "none",
    "transition-duration": "0s",
    "transition-property": "all",
    "vertical-align": "baseline",
    visibility: "visible",
    "white-space": "normal",
    "word-break": "normal",
    "z-index": "auto",
  };

  const baselineCache = new Map();
  let baselineFrame = null;

  function baselineDocument(doc) {
    if (baselineFrame?.contentDocument && baselineFrame.ownerDocument === doc) return baselineFrame.contentDocument;
    try {
      const frame = doc.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("data-pinar-baseline", "");
      frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none";
      (doc.documentElement || doc.body).appendChild(frame);
      const inner = frame.contentDocument;
      if (!inner?.body) {
        frame.remove();
        return null;
      }
      baselineFrame = frame;
      return inner;
    } catch {
      return null;
    }
  }

  function releaseBaseline() {
    try {
      baselineFrame?.remove();
    } catch {
      /* Already gone. */
    }
    baselineFrame = null;
    baselineCache.clear();
  }

  function defaultBaseline(doc, tag, properties) {
    const cached = baselineCache.get(tag);
    if (cached) return cached;
    const inner = baselineDocument(doc);
    let baseline = null;
    if (inner) {
      try {
        const probe = inner.createElement(tag);
        inner.body.appendChild(probe);
        const computed = inner.defaultView.getComputedStyle(probe);
        baseline = {};
        for (const property of properties) baseline[property] = computed.getPropertyValue(property);
        probe.remove();
      } catch {
        baseline = null;
      }
    }
    if (!baseline) {
      baseline = { ...FALLBACK_DEFAULTS, display: tag === "span" || tag === "a" || tag === "b" || tag === "i" || tag === "em" || tag === "strong" || tag === "svg" || tag === "img" ? "inline" : "block" };
    }
    baselineCache.set(tag, baseline);
    return baseline;
  }

  function truncate(value, max) {
    const text = String(value ?? "");
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function attributeValue(name, value) {
    if ((name === "src" || name === "href") && /^data:/i.test(value)) return truncate(value, 40);
    return truncate(value, LIMITS.maxAttrLength);
  }

  function readAttributes(element) {
    const attrs = {};
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute?.(name);
      if (value == null || value === "") continue;
      attrs[name] = attributeValue(name, value);
    }
    return Object.keys(attrs).length ? attrs : undefined;
  }

  function sameSides(values) {
    return values.every((value) => value === values[0]);
  }

  function readStyles(element, computed, baseline, { includeSize, subset }) {
    const styles = {};
    const pick = (property, value) => {
      if (subset && !subset.has(property)) return;
      styles[property] = value;
    };
    const all = [...LAYOUT, ...TYPOGRAPHY, ...PAINT];
    for (const property of all) {
      const value = computed.getPropertyValue(property);
      if (!value || value === baseline[property]) continue;
      if (property === "transition-property" && computed.getPropertyValue("transition-duration") === baseline["transition-duration"]) continue;
      pick(property, value);
    }
    const borders = SIDES.map((side) => ({
      color: computed.getPropertyValue(`border-${side}-color`),
      style: computed.getPropertyValue(`border-${side}-style`),
      width: computed.getPropertyValue(`border-${side}-width`),
    }));
    const borderValues = borders.map((border) => (border.style === "none" || border.width === "0px" ? "none" : `${border.width} ${border.style} ${border.color}`));
    if (sameSides(borderValues)) {
      if (borderValues[0] !== "none") pick("border", borderValues[0]);
    } else {
      SIDES.forEach((side, index) => {
        if (borderValues[index] !== "none") pick(`border-${side}`, borderValues[index]);
      });
    }
    const radii = CORNERS.map((corner) => computed.getPropertyValue(`border-${corner}-radius`));
    if (radii.some((radius) => radius && radius !== "0px")) {
      pick("border-radius", sameSides(radii) ? radii[0] : radii.join(" "));
    }
    if (includeSize) {
      const width = computed.getPropertyValue("width");
      const height = computed.getPropertyValue("height");
      if (width && width !== "auto") pick("width", width);
      if (height && height !== "auto") pick("height", height);
    }
    // Shorthand the common symmetric cases so consumers read less.
    for (const group of ["margin", "padding"]) {
      const values = SIDES.map((side) => styles[`${group}-${side}`] ?? baseline[`${group}-${side}`]);
      if (values.some((value) => value === undefined)) continue;
      if (!SIDES.some((side) => styles[`${group}-${side}`] !== undefined)) continue;
      const [top, right, bottom, left] = values;
      if (sameSides(values)) styles[group] = top;
      else if (top === bottom && left === right) styles[group] = `${top} ${right}`;
      else continue;
      for (const side of SIDES) delete styles[`${group}-${side}`];
    }
    return Object.keys(styles).length ? styles : undefined;
  }

  function directText(element) {
    const parts = [];
    for (const child of element.childNodes || []) {
      if (child.nodeType === 3) parts.push(child.textContent || "");
    }
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    return text ? truncate(text, LIMITS.maxTextLength) : undefined;
  }

  function isElement(node) {
    return Boolean(node) && node.nodeType === 1 && typeof node.tagName === "string";
  }

  function tagOf(element) {
    return element.tagName.toLowerCase();
  }

  function iconFromClasses(element, icons) {
    const classes = element.getAttribute?.("class");
    if (!classes) return;
    for (const name of classes.split(/\s+/)) {
      if (ICON_CLASS.test(name)) icons.set(`class:${name}`, { kind: "class", name });
    }
  }

  function svgName(element, index) {
    return element.getAttribute?.("aria-label")
      || element.getAttribute?.("data-icon")
      || element.getAttribute?.("class")?.split(/\s+/)[0]
      || `svg-${index}`;
  }

  function createCapture(options = {}) {
    const computedStyle = options.computedStyle || ((element) => element.ownerDocument.defaultView.getComputedStyle(element));
    const baselineFor = options.baseline || ((element, properties) => defaultBaseline(element.ownerDocument, tagOf(element), properties));
    const properties = [...LAYOUT, ...TYPOGRAPHY, ...PAINT, "transition-duration", "width", "height"];
    const fontFamilies = new Set();
    const icons = new Map();
    const state = { nodes: 0, svgs: 0, truncated: false };

    function serialize(element, depth, { includeSize, subset, shallow }) {
      const tag = tagOf(element);
      if (SKIPPED_TAGS.has(tag)) return null;
      if (state.nodes >= LIMITS.maxNodes) {
        state.truncated = true;
        return null;
      }
      const computed = computedStyle(element);
      if (computed.getPropertyValue("display") === "none") return null;
      state.nodes += 1;
      const node = { tag };
      const attrs = readAttributes(element);
      const styles = readStyles(element, computed, baselineFor(element, properties), { includeSize, subset });
      if (attrs) node.attrs = attrs;
      if (styles) node.styles = styles;
      iconFromClasses(element, icons);
      if (tag === "svg") {
        state.svgs += 1;
        const markup = truncate(element.outerHTML || "", LIMITS.maxSvgLength);
        if (markup) node.svg = markup;
        icons.set(`svg:${state.svgs}`, { kind: "svg", name: svgName(element, state.svgs) });
        return node;
      }
      const text = directText(element);
      if (text) node.text = text;
      // Only text-bearing nodes tell which fonts actually render.
      const family = computed.getPropertyValue("font-family");
      if (text && family && !subset) fontFamilies.add(`${family}|${computed.getPropertyValue("font-weight")}|${computed.getPropertyValue("font-style")}`);
      if (shallow) return node;
      const children = [];
      const elements = [...(element.children || [])];
      if (depth >= LIMITS.maxDepth && elements.length) {
        node.truncated = true;
        state.truncated = true;
        return node;
      }
      for (const child of elements) {
        if (!isElement(child)) continue;
        const serialized = serialize(child, depth + 1, {
          includeSize: INTRINSIC_TAGS.has(tagOf(child)),
          subset,
          shallow: false,
        });
        if (serialized) children.push(serialized);
        else if (state.nodes >= LIMITS.maxNodes) {
          node.truncated = true;
          break;
        }
      }
      if (children.length) node.children = children;
      return node;
    }

    function fonts(doc) {
      const faces = new Map();
      try {
        for (const rule of options.fontFaceRules ? options.fontFaceRules() : fontFaceRules(doc)) faces.set(rule.family, rule.src);
      } catch {
        /* CSSOM may be unreadable. */
      }
      const googleFonts = doc?.querySelector?.('link[href*="fonts.googleapis.com"]')?.getAttribute("href") || "";
      const list = [];
      for (const key of fontFamilies) {
        const [familyList, weight, style] = key.split("|");
        const family = familyList.split(",")[0].trim().replace(/^["']|["']$/g, "");
        if (!family || list.some((item) => item.family === family && item.weight === weight && item.style === style)) continue;
        const entry = { family };
        if (weight && weight !== "400") entry.weight = weight;
        if (style && style !== "normal") entry.style = style;
        const src = faces.get(family) || (googleFonts && /^https?:\/\//.test(googleFonts) && googleFonts.toLowerCase().includes(family.toLowerCase().replaceAll(" ", "+")) ? googleFonts : "");
        if (src) entry.src = src;
        list.push(entry);
      }
      return list.slice(0, 24);
    }

    function capture(element) {
      if (!isElement(element)) return undefined;
      state.nodes = 0;
      state.svgs = 0;
      state.truncated = false;
      fontFamilies.clear();
      icons.clear();
      let root;
      try {
        root = serialize(element, 0, { includeSize: true, shallow: false });
      } finally {
        releaseBaseline();
      }
      if (!root) return undefined;
      const snapshot = {
        fonts: fonts(element.ownerDocument),
        icons: [...icons.values()].slice(0, 40),
        nodeCount: state.nodes,
        root,
        truncated: state.truncated,
        version: VERSION,
      };
      const context = captureContext(element);
      if (context) snapshot.context = context;
      return fitBudget(snapshot);
    }

    function captureContext(element) {
      const parent = element.parentElement;
      if (!isElement(parent) || tagOf(parent) === "html") return undefined;
      const context = {};
      const parentNode = serialize(parent, LIMITS.maxDepth, { includeSize: true, shallow: true, subset: CONTEXT_PROPERTIES });
      if (parentNode) {
        delete parentNode.text;
        context.parent = parentNode;
      }
      const siblings = [];
      for (const sibling of parent.children || []) {
        if (sibling === element || !isElement(sibling)) continue;
        if (siblings.length >= LIMITS.maxSiblings) break;
        const node = serialize(sibling, LIMITS.maxDepth, { includeSize: true, shallow: true, subset: CONTEXT_PROPERTIES });
        if (node) siblings.push(node);
      }
      if (siblings.length) context.siblings = siblings;
      return context.parent || context.siblings ? context : undefined;
    }

    return capture;
  }

  function fontFaceRules(doc) {
    const rules = [];
    for (const sheet of doc?.styleSheets || []) {
      let list;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of list || []) {
        if (!rule || rule.type !== 5) continue;
        const family = rule.style?.getPropertyValue("font-family")?.replace(/^["']|["']$/g, "").trim();
        const src = rule.style?.getPropertyValue("src") || "";
        const url = src.match(/url\((["']?)(https?:\/\/[^"')]+)\1\)/)?.[2] || "";
        if (family) rules.push({ family, src: url });
      }
    }
    return rules;
  }

  function pruneDepth(node, depth, limit) {
    if (!node.children) return;
    if (depth >= limit) {
      delete node.children;
      node.truncated = true;
      return;
    }
    for (const child of node.children) pruneDepth(child, depth + 1, limit);
  }

  function countNodes(node) {
    return 1 + (node.children || []).reduce((total, child) => total + countNodes(child), 0);
  }

  function fitBudget(snapshot) {
    const size = () => JSON.stringify(snapshot).length;
    if (size() <= LIMITS.maxBytes) {
      snapshot.bytes = size();
      return snapshot;
    }
    if (snapshot.context?.siblings) delete snapshot.context.siblings;
    for (let limit = LIMITS.maxDepth - 1; limit >= 1 && size() > LIMITS.maxBytes; limit -= 1) {
      pruneDepth(snapshot.root, 0, limit);
      snapshot.truncated = true;
    }
    if (size() > LIMITS.maxBytes) {
      for (const [, icon] of Object.entries(snapshot.root)) void icon;
      stripSvg(snapshot.root);
      snapshot.truncated = true;
    }
    snapshot.nodeCount = countNodes(snapshot.root);
    snapshot.bytes = size();
    return snapshot;
  }

  function stripSvg(node) {
    if (node.svg) node.svg = truncate(node.svg, 200);
    for (const child of node.children || []) stripSvg(child);
  }

  const captureSnapshot = createCapture();

  globalThis.__pinarSnapshot = Object.freeze({
    LIMITS,
    VERSION,
    captureSnapshot,
    createCapture,
  });
})();
