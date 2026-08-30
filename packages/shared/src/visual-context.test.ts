import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  captureFromSession,
  decodeVisualCaptureJson,
  encodeVisualCaptureJson,
  formatVisualContextMarkdown,
  knownPinFields,
  parseVisualCapture,
  screenshotDeliveryEnabled,
  stableLegacyPinId,
  VisualContextError,
  visualContextErrorBody,
  VISUAL_CONTEXT_SCHEMA_VERSION,
} from "./visual-context/index.js";
import { VISUAL_CONTEXT_FIXTURES } from "./visual-context/fixtures.js";

describe("visual context v1", () => {
  test("normalizes element, area, iframe, missing screenshot, and legacy aliases", () => {
    const element = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.elementV0);
    assert.equal(element.schemaVersion, VISUAL_CONTEXT_SCHEMA_VERSION);
    assert.equal(element.captureId, "cap_element_v0");
    assert.equal(element.pins[0].pinId, "pin_cta");
    assert.equal(element.pins[0].id, "pin_cta");
    assert.deepEqual(knownPinFields(element.pins[0]), {
      comment: "Make the CTA bolder",
      coords: { x: 90, y: 112 },
      domPath: "main > section.card > button.cta",
      kind: "element",
      number: 1,
      pinId: "pin_cta",
      selector: "button.cta",
      text: "Get started",
      type: "point",
    });
    assert.equal(element.viewport?.devicePixelRatio, 2);
    assert.equal(element.page.viewport?.dpr, 2);

    const area = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.areaV0);
    assert.equal(area.pins[0].kind, "area");
    assert.equal(area.pins[0].type, "area");
    assert.deepEqual(area.pins[0].geometry.documentBox, { height: 80, width: 240, x: 16, y: 48 });

    const iframe = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.iframeV0);
    assert.equal(iframe.capabilities?.iframe, true);
    assert.equal(iframe.pins[0].frameId, 2);

    const missing = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.missingScreenshot);
    assert.equal(missing.screenshot.missing, true);
    assert.equal(missing.screenshot.url, null);
    assert.ok(missing.warnings.includes("screenshot_missing"));

    const aliases = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.legacyAliases);
    assert.equal(aliases.pins[0].locator.domPath, "header > h1");
    assert.equal(aliases.pins[0].locator.innerText, "Welcome");
    assert.equal(aliases.pins[0].pinId, stableLegacyPinId("cap_legacy_aliases", 1));
  });

  test("preserves fingerprint and location without treating them as exact by default", () => {
    const capture = parseVisualCapture({
      captureId: "cap_locate",
      pins: [{
        comment: "Keep the button",
        fingerprint: { id: "pay", tag: "button", text: "Pay" },
        location: { confidence: "probable", evidence: ["visible text"], score: 0.7, strategy: "semantic" },
        selector: "button.cta",
      }],
    });
    assert.equal(capture.pins[0].fingerprint?.id, "pay");
    assert.equal(capture.pins[0].locator.fingerprint?.id, "pay");
    assert.equal(capture.pins[0].location?.confidence, "probable");
    assert.equal(capture.pins[0].location?.strategy, "semantic");
    assert.match(formatVisualContextMarkdown(capture), /Location: probable \(semantic\)/);
  });

  test("round-trips v1 without changing captureId or pinId", () => {
    const first = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.v1StableIds);
    assert.equal(first.captureId, "cap_stable");
    assert.equal(first.pins[0].pinId, "pin_custom_abc");
    assert.equal(first.pins[0].number, 3);
    const encoded = encodeVisualCaptureJson(first);
    const second = parseVisualCapture(JSON.parse(encoded));
    assert.equal(second.captureId, first.captureId);
    assert.equal(second.pins[0].pinId, first.pins[0].pinId);
    assert.deepEqual(knownPinFields(second.pins[0]), knownPinFields(first.pins[0]));
    assert.equal(encoded.includes("data:"), false);
  });

  test("keeps a page description through encode and markdown", () => {
    const capture = parseVisualCapture({
      captureId: "cap_description",
      page: {
        description: "Project API keys for Lowcode Studio.",
        title: "API keys",
        url: "https://example.test/settings",
      },
      pins: [{ comment: "Rotate the key", selector: "input" }],
    });
    assert.equal(capture.page.description, "Project API keys for Lowcode Studio.");
    const encoded = encodeVisualCaptureJson(capture);
    assert.equal(parseVisualCapture(JSON.parse(encoded)).page.description, capture.page.description);
    assert.match(formatVisualContextMarkdown(capture), /Description: Project API keys for Lowcode Studio\./);
  });

  test("round-trips privacy categories without original secret values", () => {
    const capture = parseVisualCapture({
      captureId: "cap_privacy",
      page: { title: "Login", url: "https://app.example.test/login?token=[redacted]" },
      pins: [{ comment: "Hide the field", text: "[redacted]" }],
      privacy: { redacted: ["password", "token"], unevaluated: true },
    });
    assert.deepEqual(capture.privacy?.redacted, ["password", "token", "unevaluated"]);
    assert.equal(capture.privacy?.unevaluated, true);
    assert.ok(capture.warnings.includes("privacy_redacted"));
    assert.ok(capture.warnings.includes("privacy_unevaluated"));
    const encoded = encodeVisualCaptureJson(capture);
    assert.equal(encoded.includes("s3cret"), false);
    const markdown = formatVisualContextMarkdown(capture);
    assert.match(markdown, /Redacted: password, token, unevaluated/);
    assert.match(markdown, /some regions could not be inspected/);
    const again = parseVisualCapture(JSON.parse(encoded));
    assert.deepEqual(again.privacy, capture.privacy);
  });

  test("reads a legacy pins array using the session id as captureId", () => {
    const capture = decodeVisualCaptureJson(
      JSON.stringify([{ comment: "Fix header", kind: "element", selector: "h1" }]),
      "test-1",
    );
    assert.equal(capture.captureId, "test-1");
    assert.equal(capture.schemaVersion, 1);
    assert.equal(capture.pins[0].comment, "Fix header");
    assert.equal(capture.pins[0].selector, "h1");
    assert.equal(capture.pins[0].pinId, "test-1:p1");
  });

  test("strips data-URL screenshots from the canonical screenshot field", () => {
    const capture = parseVisualCapture({
      captureId: "cap_data",
      pins: [{ comment: "x" }],
      screenshot: { url: "data:image/png;base64,aaa" },
    });
    assert.equal(capture.screenshot.url, null);
    assert.equal(capture.screenshot.missing, true);
  });

  test("rejects invalid payloads without echoing captured content", () => {
    assert.throws(() => parseVisualCapture(null), VisualContextError);
    assert.throws(() => parseVisualCapture({ schemaVersion: 2, captureId: "x", pins: [] }), (error: unknown) => {
      assert.ok(error instanceof VisualContextError);
      assert.equal(error.code, "unsupported_schema");
      assert.equal(error.message, "invalid visual context");
      return true;
    });
    assert.throws(() => parseVisualCapture({ captureId: "x", pins: [null] }), (error: unknown) => {
      assert.ok(error instanceof VisualContextError);
      assert.equal(error.code, "invalid_pin");
      return true;
    });
    const body = visualContextErrorBody(new VisualContextError("invalid_payload"));
    assert.deepEqual(body, { code: "invalid_payload", error: "invalid visual context" });
    assert.equal(JSON.stringify(body).includes("UNIQUE_SECRET_PIN_COMMENT"), false);
    assert.throws(
      () => parseVisualCapture(VISUAL_CONTEXT_FIXTURES.invalidPinsObject),
      VisualContextError,
    );
  });

  test("projects markdown from the canonical capture", () => {
    const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.elementV0);
    const markdown = formatVisualContextMarkdown(capture, "http://127.0.0.1:17373/v/cap_element_v0");
    assert.match(markdown, /schemaVersion: 1/);
    assert.match(markdown, /captureId: cap_element_v0/);
    assert.match(markdown, /pinId: pin_cta/);
    assert.match(markdown, /Make the CTA bolder/);
    const session = captureFromSession({
      createdAt: "2026-08-29T00:00:00.000Z",
      id: capture.captureId,
      page: capture.page,
      pins: capture.pins,
      shotUrl: "/tmp/shot.png",
    });
    assert.equal(session.captureId, "cap_element_v0");
    assert.equal(session.schemaVersion, 1);
  });

  test("keeps an omitted screenshot from becoming a missing-screenshot warning", () => {
    const capture = parseVisualCapture({
      captureId: "cap_omit_shot",
      page: { title: "Login", url: "https://example.test/login" },
      pins: [{ comment: "Fix this", coords: { x: 1, y: 2 }, number: 1, type: "point" }],
      screenshot: { missing: false, url: null },
    });
    assert.equal(capture.screenshot.missing, false);
    assert.equal(capture.screenshot.url, null);
    assert.equal(capture.warnings.includes("screenshot_missing"), false);
    const markdown = formatVisualContextMarkdown(capture, "http://127.0.0.1:17373/v/cap_omit_shot.md");
    assert.doesNotMatch(markdown, /Screenshot:/);
    assert.match(markdown, /Viewer: http:\/\/127\.0\.0\.1:17373\/v\/cap_omit_shot\.md/);
    const delivered = captureFromSession({
      createdAt: "2026-08-30T00:00:00.000Z",
      id: "cap_omit_shot",
      includeScreenshot: false,
      page: capture.page,
      pins: capture.pins,
      shotUrl: "/tmp/shot.png",
    }, { deliverScreenshot: false });
    assert.equal(delivered.screenshot.missing, false);
    assert.equal(delivered.screenshot.url, null);
  });

  test("live delivery preference wins over a session stamp", () => {
    assert.equal(screenshotDeliveryEnabled(false, { includeScreenshot: true }), false);
    assert.equal(screenshotDeliveryEnabled(true, { includeScreenshot: false }), true);
    assert.equal(screenshotDeliveryEnabled(undefined, { includeScreenshot: false }), false);
  });
});
