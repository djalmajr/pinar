import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adaptHandoff,
  adaptHandoffAll,
  formatCompactHandoffBundle,
  formatFullHandoffBundle,
  formatHandoffBundle,
  HANDOFF_AGENTS,
  handoffSemantics,
  parseHandoffJson,
} from "./handoff/index.js";
import { parseVisualCapture } from "./visual-context/index.js";
import { VISUAL_CONTEXT_FIXTURES } from "./visual-context/fixtures.js";

describe("agent handoff", () => {
  test("one fixture is semantically equivalent for Cursor, Claude, Codex, and Grok", () => {
    const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.elementV0);
    const viewerUrl = "http://127.0.0.1:17373/v/cap_element_v0.md";
    const adapted = adaptHandoffAll(capture, viewerUrl);
    assert.deepEqual(Object.keys(adapted).sort(), [...HANDOFF_AGENTS].sort());

    const expected = {
      captureId: "cap_element_v0",
      comments: ["Make the CTA bolder"],
      pinIds: ["pin_cta"],
      url: "https://example.test/pricing",
    };
    for (const agent of HANDOFF_AGENTS) {
      const result = adapted[agent];
      assert.equal(result.agent, agent);
      assert.equal(result.captureId, expected.captureId);
      assert.deepEqual(result.pinIds, expected.pinIds);
      assert.deepEqual(result.comments, expected.comments);
      assert.equal(result.url, expected.url);
      assert.match(result.text, new RegExp(`for ${agent[0].toUpperCase()}${agent.slice(1)}`));
      assert.match(result.text, /```pinar-visual-context/);
      assert.equal(result.text.includes("Make the CTA bolder"), true);
      const json = parseHandoffJson(result.text);
      assert.equal((json as { captureId: string }).captureId, "cap_element_v0");
    }

    const cursor = handoffSemantics(adapted.cursor.text);
    const claude = handoffSemantics(adapted.claude.text);
    const codex = handoffSemantics(adapted.codex.text);
    const grok = handoffSemantics(adapted.grok.text);
    assert.deepEqual(cursor, claude);
    assert.deepEqual(cursor, codex);
    assert.deepEqual(cursor, grok);
  });

  test("missing screenshot still copies comment and DOM context with an explicit warning", () => {
    const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.missingScreenshot);
    const bundle = formatHandoffBundle(capture);
    assert.equal(bundle.degraded, true);
    assert.ok(bundle.warnings.includes("screenshot_missing"));
    assert.match(bundle.plain, /captureId: cap_missing_shot/);
    assert.match(bundle.plain, /Still useful/);
    assert.match(bundle.plain, /Warnings: screenshot_missing/);
    assert.equal(bundle.json.includes("data:"), false);
    const semantics = handoffSemantics(bundle.plain);
    assert.equal(semantics.captureId, "cap_missing_shot");
    assert.ok(semantics.comments.includes("Still useful"));
  });

  test("helper and viewer failures stay correlatable without dropping ids", () => {
    const capture = parseVisualCapture({
      ...VISUAL_CONTEXT_FIXTURES.elementV0,
      screenshot: { missing: false, url: "data:image/png;base64,aaa" },
      warnings: ["helper_unavailable", "viewer_unavailable"],
    });
    const bundle = formatHandoffBundle(capture);
    assert.equal(bundle.degraded, true);
    assert.equal(bundle.captureId, "cap_element_v0");
    assert.deepEqual(bundle.pinIds, ["pin_cta"]);
    assert.equal(bundle.json.includes("data:image"), false);
    assert.match(bundle.plain, /helper_unavailable/);
    assert.match(bundle.plain, /viewer_unavailable/);
    assert.equal(handoffSemantics(bundle.plain).captureId, "cap_element_v0");
    assert.deepEqual(handoffSemantics(adaptHandoff("cursor", capture).text).pinIds, ["pin_cta"]);
  });

  test("compact clipboard keeps locators and drops redundant element geometry", () => {
    const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.elementV0);
    const full = formatHandoffBundle(capture, "http://127.0.0.1:17373/v/cap_element_v0.md");
    const compact = formatCompactHandoffBundle(capture, "http://127.0.0.1:17373/v/cap_element_v0.md");
    const parsed = parseHandoffJson(compact.plain) as {
      pins: Array<{
        locator: { cssSelector: string; domPath: string };
      }>;
    };

    assert.equal(parsed.pins[0].locator.cssSelector, "button.cta");
    assert.equal(parsed.pins[0].locator.domPath, "main > section.card > button.cta");
    assert.equal("coords" in parsed.pins[0], false);
    assert.equal("box" in parsed.pins[0], false);
    assert.equal((compact.plain.match(/main > section\.card > button\.cta/g) || []).length, 1);
    assert.doesNotMatch(compact.plain, /^Page:|^Comment:|^DOM:|^Selector:/m);
    assert.match(full.markdown, /^Page: Pricing$/m);
    assert.ok(compact.plain.length < full.plain.length);
  });

  test("compact areas keep fallback geometry while full copies preserve every captured field", () => {
    const area = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.areaV0);
    const compactArea = parseHandoffJson(formatCompactHandoffBundle(area).plain) as {
      pins: Array<{ box: { height: number; width: number; x: number; y: number } }>;
    };
    assert.deepEqual(compactArea.pins[0].box, { height: 80, width: 240, x: 16, y: 48 });

    const element = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.elementV0);
    const full = parseHandoffJson(formatFullHandoffBundle(element).plain) as {
      pins: Array<{ box: { height: number; width: number; x: number; y: number }; locator: { fingerprint?: unknown } }>;
      schemaVersion: number;
      viewport: unknown;
    };
    assert.deepEqual(full.pins[0].box, { height: 40, width: 160, x: 24, y: 80 });
    assert.equal(full.schemaVersion, 1);
    assert.ok(full.viewport);
  });
});
