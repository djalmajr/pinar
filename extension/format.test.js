import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatClipboard, formatClipboardPayload, formatViewerContent, formatViewerLink } from "./format.js";

function contextFrom(plain) {
  const match = plain.match(/```pinar-visual-context\n([\s\S]*?)\n```/);
  assert.ok(match);
  return JSON.parse(match[1]);
}

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

    const context = contextFrom(payload.plain);
    assert.equal(context.captureId, "session-1");
    assert.equal(context.pins[0].pinId, "pin_1");
    assert.equal(context.pins[0].comment, "Fix this");
    assert.deepEqual(context.screenshot, { url: "/Users/me/.pinar/shots/session-1.png" });
    assert.match(payload.plain, /Full context \(fetch only if the details above are insufficient\): http:\/\/127\.0\.0\.1:17373\/v\/session-1\.md/);
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
  test("plain text carries each fact once in compact structured context", () => {
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
    const context = contextFrom(plain);
    assert.equal(context.schemaVersion, undefined);
    assert.equal(context.captureId, "cap_pricing");
    assert.equal(context.page.url, "http://localhost/pricing");
    assert.equal(context.pins[0].pinId, "pin_1");
    assert.equal(context.pins[0].comment, "Make the CTA bolder");
    assert.equal(context.pins[0].locator.domPath, "main > section.card > button.cta");
    assert.equal(context.pins[0].locator.cssSelector, "button.cta");
    assert.equal(context.pins[0].anchor, undefined);
    assert.equal(context.pins[0].box, undefined);
    assert.equal((plain.match(/main > section\.card > button\.cta/g) || []).length, 1);
    assert.equal((plain.match(/button\.cta/g) || []).length, 2);
    assert.doesNotMatch(plain, /data:image\/png;base64/);
    assert.match(plain, /```pinar-visual-context/);
    assert.equal(context.screenshot, undefined);
    assert.deepEqual(context.warnings, ["screenshot_inline"]);
    assert.match(html, /Pinar pins/);
    assert.match(html, /data:image\/png;base64,aaa/);
    assert.match(html, /main &gt; section.card &gt; button.cta/);
  });

  test("full mode preserves captured geometry and metadata", () => {
    const { plain } = formatClipboard({
      captureId: "cap_full",
      handoffMode: "full",
      page: { title: "Pricing", url: "http://localhost/pricing" },
      pins: [{
        anchor: { x: 90, y: 112 },
        box: { height: 40, width: 160, x: 24, y: 80 },
        comment: "Make the CTA bolder",
        id: "pin_1",
        selector: "button.cta",
      }],
      schemaVersion: 1,
      viewport: { height: 900, width: 1440 },
    });
    const context = contextFrom(plain);
    assert.deepEqual(context.pins[0].anchor, { x: 90, y: 112 });
    assert.deepEqual(context.pins[0].box, { height: 40, width: 160, x: 24, y: 80 });
    assert.equal(context.schemaVersion, 1);
    assert.deepEqual(context.viewport, { height: 900, width: 1440 });
  });

  test("keeps multiple pins in one structured block without prose duplication", () => {
    const { plain } = formatClipboard({
      page: { title: "Pricing", url: "http://localhost/pricing" },
      pins: [
        { comment: "first", id: "a", kind: "element", label: "p" },
        { comment: "second", id: "b", kind: "element", label: "p" },
      ],
    });
    const context = contextFrom(plain);
    assert.deepEqual(context.pins.map((pin) => pin.comment), ["first", "second"]);
    assert.doesNotMatch(plain, /## 1\.|## 2\.|Comment:/);
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
    assert.equal(contextFrom(plain).screenshot.url, "/Users/me/.pinar/shots/pinar-1.png");
    assert.equal((plain.match(/\/Users\/me\/\.pinar\/shots\/pinar-1\.png/g) || []).length, 1);
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
    assert.match(plain, /Full context \(fetch only if the details above are insufficient\): https:\/\/pinar-cloud\.workers\.dev\/v\/1\.md/);
    assert.match(html, /Full context \(fetch only if the details above are insufficient\): https:\/\/pinar-cloud\.workers\.dev\/v\/1\.md/);
  });

  test("lists redacted categories without original secrets", () => {
    const { html, plain } = formatClipboard({
      page: { title: "Login", url: "https://app.example.test/login?token=[redacted]" },
      pins: [{ comment: "Fix this", id: "1" }],
      privacy: { redacted: ["password", "token"], unevaluated: true },
    });
    const context = contextFrom(plain);
    assert.deepEqual(context.privacy, { redacted: ["password", "token"], unevaluated: true });
    assert.match(html, /&quot;redacted&quot;:\[&quot;password&quot;,&quot;token&quot;\]/);
    assert.equal(plain.includes("s3cret"), false);
  });

  test("missing screenshot still copies comment and DOM context", () => {
    const { plain } = formatClipboard({
      captureId: "cap_local",
      page: { title: "App", url: "https://app.example.test" },
      pins: [{ comment: "Still useful", id: "pin_1", path: "main > button", selector: "button" }],
      warnings: ["helper_unavailable", "viewer_unavailable"],
    });
    const context = contextFrom(plain);
    assert.equal(context.captureId, "cap_local");
    assert.equal(context.pins[0].pinId, "pin_1");
    assert.equal(context.pins[0].comment, "Still useful");
    assert.equal(context.pins[0].locator.domPath, "main > button");
    assert.deepEqual(context.warnings, ["helper_unavailable", "viewer_unavailable", "screenshot_missing"]);
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
    const context = contextFrom(plain);
    assert.equal(context.captureId, "cap_no_shot");
    assert.match(plain, /Full context \(fetch only if the details above are insufficient\): http:\/\/127\.0\.0\.1:17373\/v\/cap_no_shot\.md/);
    assert.doesNotMatch(plain, /Screenshot:/);
    assert.doesNotMatch(plain, /screenshot_missing/);
    assert.doesNotMatch(plain, /Colored numbered bubbles/);
    assert.doesNotMatch(html, /Screenshot:/);
    assert.equal(context.screenshot, undefined);
  });
});
