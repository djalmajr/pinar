import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatClipboard, formatClipboardPayload, formatViewerContent, formatViewerLink } from "./format.js";

describe("formatViewerLink", () => {
  test("copies only the markdown viewer URL", () => {
    const payload = formatViewerLink("http://127.0.0.1:17373/v/session-1");

    assert.equal(payload.plain, "http://127.0.0.1:17373/v/session-1.md");
    assert.equal(
      payload.html,
      '<a href="http://127.0.0.1:17373/v/session-1.md">http://127.0.0.1:17373/v/session-1.md</a>',
    );
  });

  test("does not duplicate an existing markdown suffix", () => {
    const payload = formatViewerLink("https://pinar.dev/v/session-1.md");

    assert.equal(payload.plain, "https://pinar.dev/v/session-1.md");
  });
});

describe("formatClipboardPayload", () => {
  test("keeps captureId and pin comments when a viewer URL is present", () => {
    const payload = formatClipboardPayload({
      captureId: "session-1",
      page: { title: "App", url: "https://app.com" },
      pins: [{ comment: "Fix this", id: "pin_1" }],
      shot: "/Users/me/.pinar/shots/session-1.png",
      viewerUrl: "http://127.0.0.1:17373/v/session-1.md",
    });

    assert.match(payload.plain, /captureId: session-1/);
    assert.match(payload.plain, /pinId: pin_1/);
    assert.match(payload.plain, /Fix this/);
    assert.match(payload.plain, /Screenshot: \/Users\/me\/\.pinar\/shots\/session-1\.png/);
    assert.match(payload.plain, /Viewer: http:\/\/127\.0\.0\.1:17373\/v\/session-1\.md/);
    assert.match(payload.plain, /```pinar-visual-context/);
  });

  test("prefers Markdown content when the extension loads it without a local capture", () => {
    const markdown = "# Visual feedback\n\nComment: Fix this <button>";
    const payload = formatClipboardPayload({
      viewerContent: markdown,
      viewerUrl: "http://127.0.0.1:17373/v/session-1.md",
    });

    assert.equal(payload.plain, markdown);
    assert.equal(payload.html, "<pre># Visual feedback\n\nComment: Fix this &lt;button&gt;</pre>");
  });
});

describe("formatViewerContent", () => {
  test("preserves the complete Markdown as plain text", () => {
    const markdown = "# Page\n\n## Pin 1\nComment: Update this";
    assert.equal(formatViewerContent(markdown).plain, markdown);
  });
});

describe("formatClipboard", () => {
  test("plain text carries comment, DOM path, selector, and one shared shot", () => {
    // Mutation captured: omitting the DOM path so paste cannot locate the node.
    const { html, plain } = formatClipboard({
      captureId: "cap_pricing",
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
      schemaVersion: 1,
      sentAt: "2026-08-13T21:00:00.000Z",
      shot: "data:image/png;base64,aaa",
    });
    assert.match(plain, /schemaVersion: 1/);
    assert.match(plain, /captureId: cap_pricing/);
    assert.match(plain, /pinId: pin_1/);
    assert.match(plain, /http:\/\/localhost\/pricing/);
    assert.match(plain, /Make the CTA bolder/);
    assert.match(plain, /main > section.card > button.cta/);
    assert.match(plain, /button.cta/);
    assert.match(plain, /Pin: x=90, y=112/);
    assert.match(plain, /Box: x=24, y=80, w=160, h=40/);
    assert.match(plain, /!\[Pinar pins]\(data:image\/png;base64,aaa\)/);
    assert.equal((plain.match(/!\[Pinar/g) || []).length, 1);
    assert.match(plain, /```pinar-visual-context/);
    assert.equal(plain.includes("data:image/png;base64,aaa") && plain.includes('"url":null'), true);
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

  test("viewerUrl is appended to plain text and html header when present", () => {
    const { html, plain } = formatClipboard({
      page: { title: "App", url: "https://app.com" },
      pins: [{ comment: "Bug", id: "1" }],
      shot: "https://pinar-cloud.workers.dev/shots/1.png",
      viewerUrl: "https://pinar-cloud.workers.dev/v/1",
    });
    assert.match(plain, /Viewer: https:\/\/pinar-cloud\.workers\.dev\/v\/1\.md/);
    assert.match(html, /href="https:\/\/pinar-cloud\.workers\.dev\/v\/1\.md"/);
  });

  test("lists redacted categories without original secrets", () => {
    const { html, plain } = formatClipboard({
      page: { title: "Login", url: "https://app.example.test/login?token=[redacted]" },
      pins: [{ comment: "Fix this", id: "1" }],
      privacy: { redacted: ["password", "token"], unevaluated: true },
    });
    assert.match(plain, /Redacted: password, token/);
    assert.match(plain, /some regions could not be inspected/);
    assert.match(html, /Redacted: password, token/);
    assert.equal(plain.includes("s3cret"), false);
  });

  test("missing screenshot still copies comment and DOM context", () => {
    const { plain } = formatClipboard({
      captureId: "cap_local",
      page: { title: "App", url: "https://app.example.test" },
      pins: [{ comment: "Still useful", id: "pin_1", path: "main > button", selector: "button" }],
      warnings: ["helper_unavailable", "viewer_unavailable"],
    });
    assert.match(plain, /captureId: cap_local/);
    assert.match(plain, /pinId: pin_1/);
    assert.match(plain, /Still useful/);
    assert.match(plain, /main > button/);
    assert.match(plain, /helper_unavailable/);
    assert.match(plain, /viewer_unavailable/);
    assert.match(plain, /screenshot_missing/);
    assert.match(plain, /```pinar-visual-context/);
  });

  test("omits the screenshot from agent copy when includeScreenshot is false", () => {
    const { html, plain } = formatClipboard({
      captureId: "cap_no_shot",
      includeScreenshot: false,
      page: { title: "App", url: "https://app.example.test" },
      pins: [{ comment: "Fix this", id: "pin_1" }],
      shot: "/Users/me/.pinar/shots/cap_no_shot.png",
      viewerUrl: "http://127.0.0.1:17373/v/cap_no_shot.md",
    });
    assert.match(plain, /captureId: cap_no_shot/);
    assert.match(plain, /Viewer: http:\/\/127\.0\.0\.1:17373\/v\/cap_no_shot\.md/);
    assert.doesNotMatch(plain, /Screenshot:/);
    assert.doesNotMatch(plain, /screenshot_missing/);
    assert.doesNotMatch(plain, /Colored numbered bubbles/);
    assert.doesNotMatch(html, /Screenshot:/);
    assert.match(plain, /"missing":false/);
    assert.match(plain, /"url":null/);
  });
});
