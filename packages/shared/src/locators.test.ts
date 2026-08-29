import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { captureFingerprint } from "./locators/fingerprint.js";
import { documentOf, el, elementKey } from "./locators/mock.js";
import { resolveLocator } from "./locators/resolve.js";
import type { LocateInput, LocateRoot } from "./locators/types.js";

function pin(partial: LocateInput): LocateInput {
  return { kind: "element", ...partial };
}

function expectKey(root: LocateRoot, input: LocateInput, key: string) {
  const result = resolveLocator(root, input);
  assert.equal(result.element && elementKey(result.element), key, `${key} via ${result.strategy} ${result.confidence}`);
  assert.notEqual(result.confidence, "unresolved");
  assert.notEqual(result.confidence, "ambiguous");
  return result;
}

describe("visual locators", () => {
  test("captures a stable fingerprint from the live element", () => {
    const root = documentOf([
      el("button", { class: "cta hashed_a1b2c3", "data-testid": "pay", id: "pay", text: "Pay now" }),
    ]);
    const button = root.querySelector("#pay");
    assert.ok(button);
    const fingerprint = captureFingerprint(button);
    assert.equal(fingerprint.id, "pay");
    assert.equal(fingerprint.testId, "pay");
    assert.equal(fingerprint.tag, "button");
    assert.equal(fingerprint.text, "Pay now");
    assert.equal(fingerprint.classes?.includes("hashed_a1b2c3"), false);
    assert.equal(fingerprint.classes?.includes("cta"), true);
  });

  test("relocates by unique id after the node moves and classes change", () => {
    const before = documentOf([
      el("main", {}, [el("button", { class: "cta", "data-key": "pay", id: "pay", text: "Pay" })]),
    ]);
    const captured = captureFingerprint(before.querySelector("#pay")!);
    const after = documentOf([
      el("footer", {}, [
        el("button", { class: "primary", "data-key": "pay", id: "pay", text: "Pay" }),
      ]),
    ]);
    const result = expectKey(after, pin({
      cssSelector: "main > button.cta",
      fingerprint: captured,
    }), "pay");
    assert.equal(result.confidence, "exact");
    assert.equal(result.strategy, "stable-selector");
  });

  test("relocates by data-testid when the css selector is stale", () => {
    const after = documentOf([
      el("section", {}, [
        el("button", { "data-key": "save", "data-testid": "save-draft", text: "Save" }),
      ]),
    ]);
    const result = expectKey(after, pin({
      cssSelector: "form > button:nth-of-type(3)",
      fingerprint: { tag: "button", testId: "save-draft", text: "Save" },
    }), "save");
    assert.equal(result.confidence, "exact");
  });

  test("uses structure when a unique DOM path still exists", () => {
    const after = documentOf([
      el("main", {}, [
        el("section", { class: "card" }, [
          el("button", { class: "cta", "data-key": "cta", text: "Start" }),
        ]),
      ]),
    ]);
    const result = expectKey(after, pin({
      cssSelector: "#missing",
      domPath: "main > section.card > button.cta",
      fingerprint: { tag: "button", text: "Start" },
    }), "cta");
    assert.equal(result.strategy, "structure");
  });

  test("falls back to unique visible text when the selector is invalid", () => {
    const after = documentOf([
      el("button", { "data-key": "cta", text: "Get started" }),
      el("button", { text: "Cancel" }),
    ]);
    const result = expectKey(after, pin({
      cssSelector: "button.gone",
      fingerprint: { tag: "button", text: "Get started" },
      innerText: "Get started",
    }), "cta");
    assert.equal(result.confidence, "probable");
    assert.equal(result.strategy, "semantic");
  });

  test("does not snap to a candidate when the same text is duplicated", () => {
    const after = documentOf([
      el("button", { "data-key": "a", text: "Edit" }),
      el("button", { "data-key": "b", text: "Edit" }),
    ]);
    const result = resolveLocator(after, pin({
      cssSelector: "button.original",
      fingerprint: { tag: "button", text: "Edit" },
    }));
    assert.equal(result.confidence, "ambiguous");
    assert.equal(result.element, null);
    assert.ok(result.candidates.length >= 2);
  });

  test("keeps lookalike buttons without unique ids as an ambiguous pending state", () => {
    const after = documentOf([
      el("button", { class: "dup", text: "Edit" }),
      el("button", { class: "dup", text: "Edit" }),
    ]);
    const result = resolveLocator(after, pin({
      cssSelector: "button:nth-of-type(1)",
      fingerprint: { classes: ["dup"], tag: "button", text: "Edit" },
    }));
    assert.equal(result.confidence, "ambiguous");
    assert.equal(result.element, null);
  });

  test("uses geometry only as probable when the nearest unique box is clear", () => {
    const after = documentOf([
      el("button", { box: { height: 40, width: 120, x: 10, y: 10 }, "data-key": "near", text: "Changed" }),
      el("button", { box: { height: 40, width: 120, x: 400, y: 400 }, "data-key": "far", text: "Other" }),
    ]);
    const result = expectKey(after, pin({
      cssSelector: "#gone",
      fingerprint: { tag: "button", text: "Original label" },
      geometry: { box: { height: 40, width: 120, x: 12, y: 12 } },
    }), "near");
    assert.equal(result.confidence, "probable");
    assert.equal(result.strategy, "geometry");
  });

  test("keeps competing nearby boxes as an actionable ambiguous pending state", () => {
    const after = documentOf([
      el("button", { box: { height: 40, width: 80, x: 10, y: 10 }, "data-key": "left", text: "A" }),
      el("button", { box: { height: 40, width: 80, x: 18, y: 12 }, "data-key": "right", text: "B" }),
    ]);
    const result = resolveLocator(after, pin({
      cssSelector: "#gone",
      fingerprint: { tag: "button", text: "Original" },
      geometry: { box: { height: 40, width: 80, x: 14, y: 11 } },
    }));
    assert.equal(result.confidence, "ambiguous");
    assert.equal(result.element, null);
  });

  test("walks a same-origin iframe chain using ::frame::", () => {
    const inner = documentOf([
      el("main", {}, [el("button", { "data-key": "inner", id: "iframe-target", text: "New project" })]),
    ]);
    const outer = documentOf([
      el("iframe", { frame: inner, id: "workspace-shell" }),
    ]);
    const result = expectKey(outer, pin({
      cssSelector: "#iframe-target",
      domPath: "iframe#workspace-shell ::frame:: main > button#iframe-target",
      fingerprint: { id: "iframe-target", tag: "button", text: "New project" },
    }), "inner");
    assert.equal(result.confidence, "exact");
  });

  test("marks cross-origin frames as unresolved with an explicit warning", () => {
    const outer = documentOf([
      el("iframe", { frame: null, id: "foreign" }),
    ]);
    const result = resolveLocator(outer, pin({
      cssSelector: "button.submit",
      domPath: "iframe#foreign ::frame:: button.submit",
      fingerprint: { tag: "button", text: "Submit" },
    }));
    assert.equal(result.confidence, "unresolved");
    assert.equal(result.warning, "cross-origin-frame");
    assert.equal(result.element, null);
  });

  test("keeps an id match exact after the visible text changes", () => {
    const after = documentOf([
      el("button", { "data-key": "pay", id: "pay", text: "Checkout" }),
    ]);
    const result = expectKey(after, pin({
      cssSelector: "button.cta",
      fingerprint: { id: "pay", tag: "button", text: "Pay" },
    }), "pay");
    assert.equal(result.confidence, "exact");
  });

  test("does not treat a stale nth-of-type as exact when lookalikes exist", () => {
    const after = documentOf([
      el("button", { class: "dup", "data-key": "clone", text: "Edit" }),
      el("button", { class: "cta", id: "cta", text: "Save" }),
      el("button", { class: "dup", "data-key": "orig", text: "Edit" }),
    ]);
    const result = resolveLocator(after, pin({
      cssSelector: "button:nth-of-type(2)",
      fingerprint: { classes: ["dup"], tag: "button", text: "Edit" },
    }));
    assert.equal(result.confidence, "ambiguous");
    assert.equal(result.element, null);
    assert.ok(result.candidates.length >= 2);
  });

  test("relocates after nth-of-type shifts when the id remains", () => {
    const after = documentOf([
      el("button", { text: "Extra" }),
      el("button", { "data-key": "pay", id: "pay", text: "Pay" }),
    ]);
    const result = expectKey(after, pin({
      cssSelector: "button:nth-of-type(1)",
      fingerprint: { id: "pay", tag: "button", text: "Pay" },
    }), "pay");
    assert.equal(result.confidence, "exact");
  });

  test("never classifies a geometry-only match as exact", () => {
    const after = documentOf([
      el("div", { box: { height: 20, width: 20, x: 0, y: 0 }, "data-key": "box" }),
    ]);
    const result = resolveLocator(after, pin({
      fingerprint: { tag: "div" },
      geometry: { box: { height: 20, width: 20, x: 0, y: 0 } },
    }));
    assert.notEqual(result.confidence, "exact");
  });
});

describe("mutated page relocation suite", () => {
  test("keeps at least 90% of pins on the correct target after DOM mutations", () => {
    const cases: Array<{ after: LocateRoot; expected: string; input: LocateInput }> = [
      {
        after: documentOf([el("nav", {}, [el("a", { "data-key": "home", id: "home", text: "Home" })])]),
        expected: "home",
        input: pin({ cssSelector: "header > a#home", fingerprint: { id: "home", tag: "a", text: "Home" } }),
      },
      {
        after: documentOf([el("button", { class: "renamed", "data-key": "ok", "data-testid": "confirm", text: "OK" })]),
        expected: "ok",
        input: pin({ cssSelector: "button.old", fingerprint: { tag: "button", testId: "confirm", text: "OK" } }),
      },
      {
        after: documentOf([
          el("label", { text: "Email" }),
          el("input", { "data-key": "email", name: "email" }),
        ]),
        expected: "email",
        input: pin({
          cssSelector: "input.field",
          fingerprint: { name: "email", tag: "input" },
        }),
      },
      {
        after: documentOf([
          el("main", {}, [
            el("section", { class: "hero" }, [
              el("h1", { "data-key": "title", text: "Welcome" }),
            ]),
          ]),
        ]),
        expected: "title",
        input: pin({
          cssSelector: "#missing-title",
          domPath: "main > section.hero > h1",
          fingerprint: { tag: "h1", text: "Welcome" },
        }),
      },
      {
        after: documentOf([el("button", { "data-key": "send", role: "button", text: "Send invite" })]),
        expected: "send",
        input: pin({
          cssSelector: "form > button.primary",
          fingerprint: { role: "button", tag: "button", text: "Send invite" },
        }),
      },
      {
        after: documentOf([
          el("p", { "data-key": "copy", text: "Keep this paragraph" }),
          el("p", { text: "Unrelated" }),
        ]),
        expected: "copy",
        input: pin({
          cssSelector: "article > p:nth-of-type(4)",
          fingerprint: { tag: "p", text: "Keep this paragraph" },
        }),
      },
      {
        after: documentOf([
          el("button", { box: { height: 30, width: 90, x: 4, y: 4 }, "data-key": "icon", text: "" }),
          el("button", { box: { height: 30, width: 90, x: 240, y: 8 }, text: "No" }),
        ]),
        expected: "icon",
        input: pin({
          cssSelector: "button.icon",
          fingerprint: { tag: "button", text: "" },
          geometry: { box: { height: 30, width: 90, x: 5, y: 5 } },
        }),
      },
      {
        after: documentOf([
          el("ul", {}, [
            el("li", { class: "item" }, [el("button", { "data-key": "row", id: "row-9", text: "Open" })]),
          ]),
        ]),
        expected: "row",
        input: pin({
          cssSelector: "li:nth-of-type(2) > button",
          fingerprint: { id: "row-9", tag: "button", text: "Open" },
        }),
      },
      {
        after: documentOf([el("a", { "data-key": "docs", "data-testid": "docs-link", text: "Docs" })]),
        expected: "docs",
        input: pin({
          cssSelector: "nav > a.link-3f9a2c",
          fingerprint: { classes: ["docs"], tag: "a", testId: "docs-link", text: "Docs" },
        }),
      },
      {
        after: documentOf([
          el("header", {}, [el("button", { "data-key": "menu", "aria-label": "Open menu", text: "" })]),
        ]),
        expected: "menu",
        input: pin({
          cssSelector: "header > button.burger",
          fingerprint: { name: "Open menu", tag: "button" },
        }),
      },
    ];

    const inner = documentOf([el("button", { "data-key": "frame-cta", id: "go", text: "Go" })]);
    cases.push({
      after: documentOf([el("iframe", { frame: inner, id: "app" })]),
      expected: "frame-cta",
      input: pin({
        cssSelector: "#go",
        domPath: "iframe#app ::frame:: button#go",
        fingerprint: { id: "go", tag: "button", text: "Go" },
      }),
    });

    let hits = 0;
    const misses: string[] = [];
    for (const [index, item] of cases.entries()) {
      const result = resolveLocator(item.after, item.input);
      const key = result.element ? elementKey(result.element) : result.confidence;
      if (result.element && elementKey(result.element) === item.expected && result.confidence !== "ambiguous") {
        hits += 1;
      } else {
        misses.push(`#${index} expected ${item.expected} got ${key} ${result.strategy}`);
      }
    }
    const ratio = hits / cases.length;
    assert.ok(ratio >= 0.9, `relocation ratio ${hits}/${cases.length} = ${ratio}\n${misses.join("\n")}`);
  });
});
