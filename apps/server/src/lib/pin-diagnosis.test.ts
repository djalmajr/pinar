import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ElementSnapshot, Pin, Session, SnapshotNode } from "@pinar/shared";
import { BOX_MODEL_PROPERTIES, DIAGNOSIS_PROMPT_LIMITS, diagnosisPromptInput } from "./pin-diagnosis";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    createdAt: "2026-09-08T00:00:00.000Z",
    id: "cap_diagnosis",
    page: { title: "Checkout", url: "https://example.test/checkout" },
    pins: [],
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<ElementSnapshot> = {}): ElementSnapshot {
  return {
    fonts: [{ family: "Inter", weight: "600" }],
    icons: [],
    nodeCount: 2,
    root: {
      attrs: { class: "pay", "data-secret": "hidden" },
      children: [{ tag: "span", text: "Pay now" }],
      styles: { "line-height": "16px", color: "rgb(0, 0, 0)", display: "inline-flex" },
      tag: "button",
    },
    truncated: false,
    version: 1,
    ...overrides,
  };
}

function makePin(overrides: Partial<Pin> = {}): Pin {
  return {
    box: { height: 40.4, width: 120.6, x: 10.2, y: 20.7 },
    comment: "The button text looks misaligned",
    coords: { x: 10, y: 20 },
    domPath: "main > form > button",
    number: 1,
    pinId: "pin_pay",
    selector: "button.pay",
    snapshot: makeSnapshot(),
    tag: "button",
    type: "point",
    ...overrides,
  };
}

function deepTree(depth: number): SnapshotNode {
  const node: SnapshotNode = { styles: { padding: `${depth}px` }, tag: "div", text: `level ${depth}` };
  if (depth > 0) node.children = [deepTree(depth - 1)];
  return node;
}

function wideTree(children: number): SnapshotNode {
  return {
    children: Array.from({ length: children }, (_, index) => ({
      styles: { "font-size": "14px", margin: `${index}px`, padding: "4px 8px" },
      tag: "li",
      text: `Item number ${index} with a fairly long label to spend characters ${"x".repeat(80)}`,
    })),
    tag: "ul",
  };
}

describe("diagnosisPromptInput", () => {
  test("returns null for a pin without a snapshot", () => {
    const pin = makePin({ snapshot: undefined });

    const input = diagnosisPromptInput(pin, makeSession());

    assert.equal(input, null);
  });

  test("carries the comment, page, pin box, location and target styles", () => {
    const pin = makePin();

    const input = diagnosisPromptInput(pin, makeSession());

    assert.ok(input);
    assert.equal(input.comment, "The button text looks misaligned");
    assert.deepEqual(input.page, { title: "Checkout", url: "https://example.test/checkout" });
    assert.deepEqual(input.pin.box, { height: 40, width: 121, x: 10, y: 21 });
    assert.deepEqual(input.pin.location, { domPath: "main > form > button", selector: "button.pay" });
    assert.equal(input.pin.tag, "button");
    assert.deepEqual(input.target.root.styles, { "line-height": "16px", color: "rgb(0, 0, 0)", display: "inline-flex" });
    assert.deepEqual(input.target.root.attrs, { class: "pay" });
    assert.deepEqual(input.target.fonts, [{ family: "Inter", weight: "600" }]);
    assert.equal(input.target.root.children?.[0].text, "Pay now");
  });

  test("keeps redacted placeholders untouched", () => {
    const pin = makePin({
      comment: "Shows [redacted] instead of the card number",
      snapshot: makeSnapshot({
        root: { attrs: { class: "card" }, styles: { display: "block" }, tag: "p", text: "Card •••• [redacted]" },
      }),
    });

    const input = diagnosisPromptInput(pin, makeSession());

    assert.ok(input);
    assert.equal(input.comment, "Shows [redacted] instead of the card number");
    assert.equal(input.target.root.text, "Card •••• [redacted]");
  });

  test("summarises siblings to box-model properties only", () => {
    const pin = makePin({
      snapshot: makeSnapshot({
        context: {
          parent: { attrs: { class: "row", id: "actions" }, styles: { display: "flex", gap: "8px" }, tag: "div" },
          siblings: [{
            styles: {
              "background-color": "rgb(255, 255, 255)",
              color: "rgb(0, 0, 0)",
              "font-family": "Inter",
              "line-height": "24px",
              margin: "0px 8px",
              padding: "4px 12px",
            },
            tag: "a",
            text: "Cancel",
          }],
        },
      }),
    });

    const input = diagnosisPromptInput(pin, makeSession());

    assert.ok(input?.context);
    assert.deepEqual(input.context.parent, {
      attrs: { class: "row", id: "actions" },
      styles: { display: "flex", gap: "8px" },
      tag: "div",
    });
    assert.deepEqual(input.context.siblings, [{
      styles: { "line-height": "24px", margin: "0px 8px", padding: "4px 12px" },
      tag: "a",
      text: "Cancel",
    }]);
    for (const property of Object.keys(input.context.siblings?.[0].styles ?? {})) {
      assert.ok((BOX_MODEL_PROPERTIES as readonly string[]).includes(property));
    }
  });

  test("bounds the comment, text and depth of the target tree", () => {
    const pin = makePin({
      comment: "c".repeat(5_000),
      snapshot: makeSnapshot({ root: { ...deepTree(12), text: "t".repeat(1_000) } }),
    });

    const input = diagnosisPromptInput(pin, makeSession());

    assert.ok(input);
    assert.equal(input.comment.length, DIAGNOSIS_PROMPT_LIMITS.maxCommentLength);
    assert.equal(input.target.root.text?.length, DIAGNOSIS_PROMPT_LIMITS.maxTextLength);
    let depth = 0;
    let node = input.target.root;
    while (node.children?.length) {
      node = node.children[0];
      depth += 1;
    }
    assert.equal(depth, DIAGNOSIS_PROMPT_LIMITS.maxDepth);
    assert.equal(node.truncated, true);
    assert.equal(input.target.truncated, false);
  });

  test("keeps the serialized input under the character limit for a wide tree", () => {
    const siblings = Array.from({ length: 12 }, () => ({
      styles: { margin: "0px", padding: "40px" },
      tag: "li",
      text: "sibling ".repeat(20),
    }));
    const pin = makePin({
      snapshot: makeSnapshot({ context: { siblings }, nodeCount: 400, root: wideTree(200) }),
    });

    const input = diagnosisPromptInput(pin, makeSession());

    assert.ok(input);
    assert.ok(JSON.stringify(input).length <= DIAGNOSIS_PROMPT_LIMITS.maxCharacters);
    assert.ok((input.target.root.children?.length ?? 0) <= DIAGNOSIS_PROMPT_LIMITS.maxNodes);
    assert.equal(input.target.truncated, true);
  });
});
