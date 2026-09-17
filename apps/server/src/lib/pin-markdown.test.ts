import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Pin } from "@pinar/shared";
import { formatPinMarkdown } from "./pin-markdown";

describe("formatPinMarkdown", () => {
  test("formats the complete element context once for raw and preview tabs", () => {
    const pin: Pin = {
      comment: "Align this control.",
      coords: { x: 24, y: 48 },
      domPath: "main > form > button",
      innerText: "Save",
      number: 3,
      selector: "button[type='submit']",
      tag: "button",
      type: "point",
    };

    const markdown = formatPinMarkdown(pin, 3);

    assert.match(markdown, /# Pin 3/);
    assert.match(markdown, /## Comment\n\nAlign this control\./);
    assert.match(markdown, /- \*\*Coordinates:\*\* `x=24, y=48`/);
    assert.match(markdown, /```css\nbutton\[type='submit'\]\n```/);
    assert.match(markdown, /main > form > button/);
    assert.match(markdown, /Save/);
  });

  test("uses a longer fence when the captured content contains triple backticks", () => {
    const pin: Pin = {
      comment: "Preserve the snippet.",
      coords: { x: 0, y: 0 },
      innerText: "```ts\nconst ready = true\n```",
      number: 1,
      type: "point",
    };

    assert.match(formatPinMarkdown(pin, 1), /````text\n```ts\nconst ready = true\n```\n````/);
  });

  test("surfaces relocation confidence instead of implying an exact match", () => {
    const pin: Pin = {
      comment: "Align this control.",
      coords: { x: 24, y: 48 },
      location: { confidence: "probable", evidence: ["visible text"], score: 0.7, strategy: "semantic" },
      number: 3,
      type: "point",
    };

    const markdown = formatPinMarkdown(pin, 3);
    assert.match(markdown, /- \*\*Location:\*\* probable \(semantic\)/);
    assert.doesNotMatch(markdown, /exact match/i);
  });

  test("makes a cross-origin frame limitation explicit", () => {
    const pin: Pin = {
      comment: "Submit",
      coords: { x: 8, y: 8 },
      location: {
        confidence: "unresolved",
        evidence: ["iframe contentDocument is not readable"],
        score: 0,
        strategy: "none",
        warning: "cross-origin-frame",
      },
      number: 1,
      type: "point",
    };
    const markdown = formatPinMarkdown(pin, 1);
    assert.match(markdown, /- \*\*Location:\*\* unresolved \(none\)/);
    assert.match(markdown, /- \*\*Warning:\*\* cross-origin iframe is not readable/);
  });

  test("keeps redacted placeholders instead of original secrets", () => {
    const pin: Pin = {
      comment: "Reset with [redacted]",
      coords: { x: 8, y: 8 },
      innerText: "[redacted]",
      number: 1,
      type: "point",
    };
    const markdown = formatPinMarkdown(pin, 1);
    assert.match(markdown, /Reset with \[redacted\]/);
    assert.doesNotMatch(markdown, /PINAR_FIXTURE/);
  });

  test("renders structure, accepted diagnosis and technical evidence sections only when present", () => {
    const plain: Pin = { comment: "Plain", coords: { x: 0, y: 0 }, number: 1, type: "point" };
    const plainMarkdown = formatPinMarkdown(plain, 1);
    assert.doesNotMatch(plainMarkdown, /## Structure|## Diagnosis|## Technical evidence/);

    const rich: Pin = {
      comment: "Misaligned",
      coords: { x: 0, y: 0 },
      diagnosis: {
        acceptedAt: "2026-09-08T00:00:00.000Z",
        cause: "Missing align-items",
        confidence: "high",
        fix: ".row { align-items: center; }",
        properties: ["align-items"],
        version: 1,
      },
      evidence: {
        environment: { browser: "Chrome 140", devicePixelRatio: 2, viewport: { height: 900, width: 1440 } },
        items: [{ at: "x", grade: "after_interaction", kind: "http", method: "POST", origin: "https://example.test", status: 500, url: "https://example.test/api" }],
        version: 1,
      },
      number: 2,
      snapshot: {
        fonts: [{ family: "Inter", weight: "600" }],
        icons: [{ kind: "class", name: "lucide-check" }],
        nodeCount: 2,
        root: { children: [{ tag: "span", text: "Pay" }], styles: { display: "flex" }, tag: "button" },
        truncated: true,
        version: 1,
      },
      type: "point",
    };
    const markdown = formatPinMarkdown(rich, 2);
    assert.match(markdown, /## Diagnosis\n\n- \*\*Confidence:\*\* high\n- \*\*Cause:\*\* Missing align-items\n- \*\*Properties:\*\* `align-items`\n\n```css\n\.row \{ align-items: center; \}\n```/);
    assert.match(markdown, /## Technical evidence\n\n- `after_interaction` POST https:\/\/example\.test\/api → 500\n\n- \*\*Environment:\*\* Chrome 140 · 1440×900 · dpr 2/);
    assert.match(markdown, /## Structure\n\n- \*\*Nodes:\*\* 2 nodes, truncated\n- \*\*Fonts:\*\* Inter 600\n- \*\*Icons:\*\* lucide-check\n\n```html\n<button> \{ display: flex \}\n  <span> "Pay"\n```/);

    const pending: Pin = { ...rich, diagnosis: { ...rich.diagnosis!, acceptedAt: undefined } };
    assert.doesNotMatch(formatPinMarkdown(pending, 2), /## Diagnosis/);
  });
});
