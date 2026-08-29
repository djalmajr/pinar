import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  adaptHandoff,
  adaptHandoffAll,
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
});
