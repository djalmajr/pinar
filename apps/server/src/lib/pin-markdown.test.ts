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
});
