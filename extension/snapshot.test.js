import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./snapshot.js", import.meta.url), "utf8");
const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const sessionSrc = readFileSync(new URL("./session.js", import.meta.url), "utf8");
const context = vm.createContext({ console });
vm.runInContext(source, context);
const { LIMITS, createCapture } = context.__pinarSnapshot;

const DEFAULTS = {
  "align-items": "normal",
  "background-color": "rgba(0, 0, 0, 0)",
  "border-bottom-color": "rgb(0, 0, 0)",
  "border-bottom-left-radius": "0px",
  "border-bottom-right-radius": "0px",
  "border-bottom-style": "none",
  "border-bottom-width": "0px",
  "border-left-color": "rgb(0, 0, 0)",
  "border-left-style": "none",
  "border-left-width": "0px",
  "border-right-color": "rgb(0, 0, 0)",
  "border-right-style": "none",
  "border-right-width": "0px",
  "border-top-color": "rgb(0, 0, 0)",
  "border-top-left-radius": "0px",
  "border-top-right-radius": "0px",
  "border-top-style": "none",
  "border-top-width": "0px",
  color: "rgb(0, 0, 0)",
  display: "block",
  "font-family": "Times",
  "font-size": "16px",
  "font-style": "normal",
  "font-weight": "400",
  height: "auto",
  "line-height": "normal",
  "margin-bottom": "0px",
  "margin-left": "0px",
  "margin-right": "0px",
  "margin-top": "0px",
  "padding-bottom": "0px",
  "padding-left": "0px",
  "padding-right": "0px",
  "padding-top": "0px",
  position: "static",
  "transition-duration": "0s",
  "transition-property": "all",
  width: "auto",
};

class FakeElement {
  constructor(tag, attrs = {}, children = [], styles = {}) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.styles = styles;
    this.childNodes = children.map((child) => (typeof child === "string" ? { nodeType: 3, textContent: child } : child));
    this.children = this.childNodes.filter((child) => child.nodeType === 1);
    for (const child of this.children) child.parentElement = this;
    this.parentElement = null;
    this.ownerDocument = { defaultView: {}, querySelector: () => null, styleSheets: [] };
  }

  getAttribute(name) {
    return this.attrs[name] ?? null;
  }

  get outerHTML() {
    return `<${this.tagName.toLowerCase()}>${this.childNodes.map((child) => child.textContent || "").join("")}</${this.tagName.toLowerCase()}>`;
  }
}

function computedStyle(element) {
  return { getPropertyValue: (property) => element.styles[property] ?? DEFAULTS[property] ?? "" };
}

// Objects built inside the vm context carry another realm's prototypes; compare
// them as plain data.
function capture(element, extra = {}) {
  const snapshot = createCapture({ baseline: () => DEFAULTS, computedStyle, ...extra })(element);
  return snapshot ? JSON.parse(JSON.stringify(snapshot)) : snapshot;
}

describe("extension snapshot", () => {
  test("is injected before content.js and attached to element drafts", () => {
    assert.ok(sessionSrc.indexOf('"snapshot.js"') < sessionSrc.indexOf('"content.js"'));
    assert.match(contentSrc, /__pinarSnapshot/);
    assert.match(contentSrc, /snapshot: safeSnapshot\(element\)/);
  });

  test("keeps only styles that differ from the user agent baseline and shorthands symmetric boxes", () => {
    const button = new FakeElement("button", { class: "cta lucide-arrow-right", type: "button" }, [
      "Get started",
      new FakeElement("svg", { "aria-label": "arrow" }, [], { display: "inline" }),
    ], {
      "background-color": "rgb(0, 105, 168)",
      "border-bottom-left-radius": "8px",
      "border-bottom-right-radius": "8px",
      "border-top-left-radius": "8px",
      "border-top-right-radius": "8px",
      color: "rgb(255, 255, 255)",
      display: "inline-flex",
      "font-family": "Inter, sans-serif",
      "font-weight": "600",
      height: "40px",
      "padding-bottom": "8px",
      "padding-left": "16px",
      "padding-right": "16px",
      "padding-top": "8px",
      width: "160px",
    });
    const snapshot = capture(button);
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.root.tag, "button");
    assert.equal(snapshot.root.text, "Get started");
    assert.deepEqual(snapshot.root.attrs, { class: "cta lucide-arrow-right", type: "button" });
    assert.equal(snapshot.root.styles.display, "inline-flex");
    assert.equal(snapshot.root.styles["border-radius"], "8px");
    assert.equal(snapshot.root.styles.width, "160px");
    assert.equal(snapshot.root.styles.padding, "8px 16px");
    assert.equal(snapshot.root.styles["padding-left"], undefined);
    assert.equal(snapshot.root.styles.position, undefined, "default position is not repeated");
    assert.equal(snapshot.root.children[0].tag, "svg");
    assert.match(snapshot.root.children[0].svg, /<svg>/);
    assert.deepEqual(snapshot.fonts, [{ family: "Inter", weight: "600" }]);
    assert.deepEqual(snapshot.icons, [
      { kind: "class", name: "lucide-arrow-right" },
      { kind: "svg", name: "arrow" },
    ]);
    assert.equal(snapshot.nodeCount, 2);
    assert.equal(snapshot.truncated, false);
    assert.ok(snapshot.bytes > 0);
  });

  test("skips scripts and hidden subtrees, and records parent and siblings shallowly", () => {
    const hidden = new FakeElement("div", {}, ["secret"], { display: "none" });
    const script = new FakeElement("script", {}, ["alert(1)"]);
    const target = new FakeElement("li", { class: "item" }, ["Two", hidden, script]);
    const sibling = new FakeElement("li", {}, ["One", new FakeElement("b", {}, ["deep"])], { "margin-top": "4px" });
    const list = new FakeElement("ul", { class: "list" }, [sibling, target], { display: "flex", "column-gap": "8px" });
    void list;
    const snapshot = capture(target);
    assert.equal(snapshot.root.children, undefined);
    assert.equal(snapshot.nodeCount, 1);
    assert.equal(snapshot.context.parent.tag, "ul");
    assert.equal(snapshot.context.parent.styles.display, "flex");
    assert.equal(snapshot.context.parent.text, undefined);
    assert.equal(snapshot.context.siblings.length, 1);
    assert.equal(snapshot.context.siblings[0].styles["margin-top"], "4px");
    assert.equal(snapshot.context.siblings[0].children, undefined, "siblings are shallow");
    assert.equal(JSON.stringify(snapshot).includes("secret"), false);
    assert.equal(JSON.stringify(snapshot).includes("alert"), false);
  });

  test("truncates deep and wide trees within the node budget", () => {
    let leaf = new FakeElement("span", {}, ["leaf"]);
    for (let depth = 0; depth < LIMITS.maxDepth + 3; depth += 1) leaf = new FakeElement("div", {}, [leaf]);
    const deep = capture(leaf);
    assert.equal(deep.truncated, true);

    const wide = new FakeElement("ul", {}, Array.from({ length: LIMITS.maxNodes + 20 }, (_, index) => new FakeElement("li", {}, [`Item ${index}`])));
    const snapshot = capture(wide);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.nodeCount, LIMITS.maxNodes);
    assert.ok(snapshot.bytes <= LIMITS.maxBytes);
  });

  test("resolves font sources from @font-face rules and Google Fonts links", () => {
    const heading = new FakeElement("h1", {}, ["Title"], { "font-family": '"Space Grotesk", sans-serif', "font-weight": "700" });
    heading.ownerDocument.querySelector = () => ({ getAttribute: () => "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700" });
    const snapshot = capture(heading, { fontFaceRules: () => [{ family: "Inter", src: "https://cdn.example.test/inter.woff2" }] });
    assert.deepEqual(snapshot.fonts, [{
      family: "Space Grotesk",
      src: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700",
      weight: "700",
    }]);
    const body = new FakeElement("p", {}, ["Body"], { "font-family": "Inter" });
    assert.deepEqual(capture(body, { fontFaceRules: () => [{ family: "Inter", src: "https://cdn.example.test/inter.woff2" }] }).fonts, [{
      family: "Inter",
      src: "https://cdn.example.test/inter.woff2",
    }]);
  });
});
