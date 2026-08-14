import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatClipboard } from "./format.js";

describe("formatClipboard", () => {
  test("plain text carries comment, DOM path, selector, and one shared shot", () => {
    // Mutation captured: omitting the DOM path so paste cannot locate the node.
    const { html, plain } = formatClipboard({
      page: { title: "Pricing", url: "http://localhost/pricing" },
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
      shot: "data:image/png;base64,aaa",
    });
    assert.match(plain, /http:\/\/localhost\/pricing/);
    assert.match(plain, /Make the CTA bolder/);
    assert.match(plain, /main > section.card > button.cta/);
    assert.match(plain, /button.cta/);
    assert.match(plain, /Pin: x=90, y=112/);
    assert.match(plain, /Box: x=24, y=80, w=160, h=40/);
    assert.match(plain, /!\[Pinar pins]\(data:image\/png;base64,aaa\)/);
    assert.equal((plain.match(/!\[Pinar/g) || []).length, 1);
    assert.match(html, /Pinar pins/);
    assert.match(html, /Pin:<\/strong> x=90, y=112/);
    assert.match(html, /data:image\/png;base64,aaa/);
    assert.match(html, /main &gt; section.card &gt; button.cta/);
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
    assert.match(plain, /Comment: first\n\n## 2\. element/);
  });

  test("file-path crops stay as a short Screenshot line once", () => {
    // Mutation captured: stuffing a filesystem path into a data-URI markdown image.
    const { html, plain } = formatClipboard({
      page: { title: "Pricing", url: "http://localhost/pricing" },
      pins: [
        { comment: "first", id: "a", kind: "element" },
        { comment: "second", id: "b", kind: "element" },
      ],
      shot: "/Users/me/.pinar/shots/pinar-1.png",
    });
    assert.match(plain, /Screenshot: \/Users\/me\/\.pinar\/shots\/pinar-1\.png/);
    assert.equal((plain.match(/Screenshot:/g) || []).length, 1);
    assert.equal(plain.includes("![Pinar pins](/Users/me/.pinar/shots/pinar-1.png)"), false);
    assert.match(html, /\/Users\/me\/\.pinar\/shots\/pinar-1\.png/);
    assert.equal(html.includes("<img"), false);
  });
});
