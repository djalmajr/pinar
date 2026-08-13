import { describe, expect, test } from "bun:test";
import { formatClipboard } from "./format.js";

describe("formatClipboard", () => {
  test("plain text carries comment, DOM path, and selector without image data", () => {
    // Mutation captured: omitting the DOM path so paste cannot locate the node.
    const { html, plain } = formatClipboard({
      page: { title: "Pricing", url: "http://localhost/pricing" },
      pinCrops: { pin_1: "data:image/png;base64,aaa" },
      pins: [{
        anchor: { x: 90, y: 112 },
        box: { height: 40, width: 160, x: 24, y: 80 },
        comment: "Make the CTA bolder",
        id: "pin_1",
        kind: "element",
        label: "button.cta",
        path: "main > section.card > button.cta",
        selector: "button.cta",
        text: "Get started",
      }],
      sentAt: "2026-08-13T21:00:00.000Z",
      viewportPng: "data:image/png;base64,bbb",
    });
    expect(plain).toContain("http://localhost/pricing");
    expect(plain).toContain("Make the CTA bolder");
    expect(plain).toContain("main > section.card > button.cta");
    expect(plain).toContain("button.cta");
    expect(plain).toContain("Pin: x=90, y=112");
    expect(plain).toContain("Box: x=24, y=80, w=160, h=40");
    expect(plain).not.toContain("data:image/png");
    expect(html).toContain("Pin:</strong> x=90, y=112");
    expect(html).toContain("data:image/png;base64,aaa");
    expect(html).toContain("data:image/png;base64,bbb");
    expect(html).toContain("main &gt; section.card &gt; button.cta");
  });

  test("plain text leaves a blank line between pins", () => {
    // Mutation captured: joining pin blocks with a single newline so headings stick to the previous Box line.
    const { plain } = formatClipboard({
      page: { title: "Pricing", url: "http://localhost/pricing" },
      pins: [
        { comment: "first", id: "a", kind: "element", label: "p" },
        { comment: "second", id: "b", kind: "element", label: "p" },
      ],
    });
    expect(plain).toMatch(/Comment: first\n\n## 2\. element/);
  });
});
