import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applySessionPatch,
  asElementSnapshot,
  asPinComponent,
  asPinDiagnosis,
  asPinEvidence,
  asReproduction,
  describeEvidenceItem,
  evidenceGrade,
  renderSnapshotOutline,
  SNAPSHOT_LIMITS,
} from "./visual-context/fields.ts";
import {
  decodeVisualCaptureJson,
  encodeVisualCaptureJson,
  formatVisualContextMarkdown,
  parseVisualCapture,
  sessionFromCapture,
} from "./visual-context/index.ts";
import { VISUAL_CONTEXT_FIXTURES } from "./visual-context/fixtures.ts";
import { compactCaptureForHandoff, formatHandoffBundle, parseHandoffJson } from "./handoff/index.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("visual context optional fields", () => {
  test("keeps snapshot, evidence, diagnosis and reproduction through parse, encode and decode", () => {
    const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.richV1);
    assert.equal(capture.pins[0].snapshot?.nodeCount, 2);
    assert.equal(capture.pins[0].snapshot?.root.children?.[0].text, "Pay now");
    assert.equal(capture.pins[0].evidence?.items.length, 2);
    assert.equal(capture.pins[0].evidence?.items[0].method, "POST");
    assert.equal(capture.pins[0].diagnosis?.confidence, "medium");
    assert.equal(capture.pins[1].diagnosis?.acceptedAt, undefined);
    assert.equal(capture.reproduction?.steps.length, 3);
    assert.equal(capture.reproduction?.steps[1].thumbnail, "data:image/jpeg;base64,/9j/4AAQ");

    const decoded = decodeVisualCaptureJson(encodeVisualCaptureJson(capture), capture.captureId);
    assert.deepEqual(decoded.pins[0].snapshot, capture.pins[0].snapshot);
    assert.deepEqual(decoded.pins[0].evidence, capture.pins[0].evidence);
    assert.deepEqual(decoded.reproduction, capture.reproduction);
    const session = sessionFromCapture(decoded);
    assert.equal(session.reproduction?.steps.length, 3);
  });

  test("captures without the new fields stay identical", () => {
    const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.elementV0);
    assert.equal(capture.pins[0].snapshot, undefined);
    assert.equal(capture.pins[0].evidence, undefined);
    assert.equal(capture.pins[0].diagnosis, undefined);
    assert.equal(capture.reproduction, undefined);
    const encoded = JSON.parse(encodeVisualCaptureJson(capture));
    assert.equal("reproduction" in encoded, false);
    assert.equal("evidence" in encoded.pins[0], false);
  });

  test("drops malformed optional fields instead of failing the capture", () => {
    const capture = parseVisualCapture({
      captureId: "cap_bad_fields",
      pins: [{
        comment: "ok",
        diagnosis: { cause: "x", confidence: "certain", fix: "", version: 1 },
        evidence: { items: [{ at: "now", grade: "guess", kind: "http", origin: "o" }], version: 1 },
        snapshot: { root: { tag: "not a tag!" }, version: 1 },
      }],
      reproduction: { steps: [{ kind: "teleport" }], version: 1 },
    });
    assert.equal(capture.pins[0].diagnosis, undefined);
    assert.equal(capture.pins[0].evidence, undefined);
    assert.equal(capture.pins[0].snapshot, undefined);
    assert.equal(capture.reproduction, undefined);
  });

  test("bounds snapshot depth and node count and reports truncation", () => {
    const deep = (depth: number): Record<string, unknown> => (
      depth === 0 ? { tag: "span", text: "leaf" } : { children: [deep(depth - 1)], tag: "div" }
    );
    const snapshot = asElementSnapshot({ fonts: [], icons: [], root: deep(SNAPSHOT_LIMITS.maxDepth + 4), version: 1 });
    assert.ok(snapshot);
    assert.equal(snapshot.truncated, true);
    assert.ok(snapshot.nodeCount <= SNAPSHOT_LIMITS.maxDepth + 1);

    const wide = { children: Array.from({ length: SNAPSHOT_LIMITS.maxNodes + 50 }, () => ({ tag: "li" })), tag: "ul" };
    const wideSnapshot = asElementSnapshot({ root: wide, version: 1 });
    assert.ok(wideSnapshot);
    assert.equal(wideSnapshot.truncated, true);
    assert.equal(wideSnapshot.nodeCount, SNAPSHOT_LIMITS.maxNodes);
    assert.equal(wideSnapshot.fonts.length, 0);
    assert.match(renderSnapshotOutline(wideSnapshot.root).join("\n"), /<ul>/);
  });

  test("evidence without items disappears and grades stay deterministic", () => {
    assert.equal(asPinEvidence({ environment: { browser: "Chrome" }, items: [], version: 1 }), undefined);
    const base = Date.parse("2026-09-08T00:00:00.000Z");
    assert.equal(evidenceGrade(base + 1_500, base), "after_interaction");
    assert.equal(evidenceGrade(base + 2_500, base), "same_page");
    assert.equal(evidenceGrade(base - 10, base), "same_page");
    assert.equal(evidenceGrade(base, null), "same_page");
    assert.equal(describeEvidenceItem({
      at: "x",
      grade: "after_interaction",
      kind: "http",
      method: "POST",
      origin: "https://example.test",
      status: 500,
      url: "https://example.test/api/pay",
    }), "POST https://example.test/api/pay → 500");
  });

  test("validates diagnosis, component and reproduction shapes", () => {
    assert.equal(asPinDiagnosis({ cause: "", confidence: "low", fix: "", version: 1 }), undefined);
    assert.equal(asPinDiagnosis({ cause: "c", confidence: "high", fix: "f", properties: ["gap", 3], version: 1 })?.properties.length, 1);
    assert.equal(asPinComponent({ files: [{ content: "x", path: "../escape.html" }], target: "html", version: 1 }), undefined);
    assert.equal(asPinComponent({ files: [{ content: "x", path: "Card.tsx" }], target: "vue", version: 1 }), undefined);
    const component = asPinComponent({
      dependencies: ["react"],
      files: [{ content: "<div/>", path: "Card.tsx" }],
      generatedAt: "2026-09-08T00:00:00.000Z",
      notes: ["Approximate shadow"],
      preview: "<html></html>",
      target: "react-tailwind",
      version: 1,
    });
    assert.equal(component?.files[0].path, "Card.tsx");
    assert.equal(component?.preview, "<html></html>");
    const reproduction = asReproduction({
      steps: [{ at: "2026-09-08T00:00:00.000Z", kind: "click" }, { kind: "click" }],
      version: 1,
    });
    assert.equal(reproduction?.steps.length, 1);
    assert.equal(reproduction?.startedAt, "2026-09-08T00:00:00.000Z");
  });

  test("markdown lists structure, accepted diagnosis, technical evidence and reproduction", () => {
    const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.richV1);
    const markdown = formatVisualContextMarkdown(capture);
    assert.match(markdown, /Structure: 2 nodes/);
    assert.match(markdown, /Diagnosis \(medium confidence\): The button has line-height 1/);
    assert.match(markdown, /Suggested fix: button\.pay \{ line-height: 1\.5; \}/);
    assert.match(markdown, /Technical evidence:\n- \[after_interaction\] POST https:\/\/example\.test\/api\/pay\?token=\[redacted\] → 500/);
    assert.match(markdown, /- \[same_page\] console\.error: Warning: each child should have a key/);
    assert.match(markdown, /Reproduction:\n1\. Open https:\/\/example\.test\/checkout\n2\. Type "user@example\.test" into input\[name=email\]\n3\. Click "Pay now"/);
    assert.doesNotMatch(markdown, /Guess without acceptance/);
  });

  test("compact handoff carries evidence and accepted diagnosis, never the snapshot or thumbnails", () => {
    const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.richV1);
    const compact = compactCaptureForHandoff(capture);
    const first = compact.pins[0];
    assert.equal(first.diagnosis?.cause, "The button has line-height 1 while its siblings inherit 1.5.");
    assert.equal(first.evidence?.items.length, 2);
    assert.equal("snapshot" in first, false);
    assert.equal(compact.pins[1].diagnosis, undefined);
    assert.equal(compact.reproduction?.steps.length, 3);
    assert.equal(compact.reproduction?.steps.every((step) => !("thumbnail" in step)), true);

    const full = parseHandoffJson(formatHandoffBundle(capture).plain);
    assert.ok(isRecord(full) && Array.isArray(full.pins) && isRecord(full.pins[0]));
    assert.ok(isRecord(full.pins[0].snapshot));
    assert.ok(isRecord(full.pins[1]));
    assert.equal(full.pins[1].diagnosis, undefined);
    assert.ok(isRecord(full.reproduction) && Array.isArray(full.reproduction.steps) && isRecord(full.reproduction.steps[1]));
    assert.equal("thumbnail" in full.reproduction.steps[1], false);
  });

  test("applies viewer patches to a session and rejects invalid ones", () => {
    const session = sessionFromCapture(parseVisualCapture(VISUAL_CONTEXT_FIXTURES.richV1));
    const accepted = applySessionPatch(session, {
      pins: [{
        diagnosis: { ...session.pins[1].diagnosis, acceptedAt: "2026-09-08T01:00:00.000Z", edited: true },
        pinId: "pin_private",
      }],
      reproduction: null,
    });
    assert.ok(accepted);
    assert.equal(accepted.pins[1].diagnosis?.acceptedAt, "2026-09-08T01:00:00.000Z");
    assert.equal(accepted.reproduction, undefined);
    assert.equal(session.pins[1].diagnosis?.acceptedAt, undefined, "the original session is untouched");
    assert.equal(session.reproduction?.steps.length, 3);

    const cleared = applySessionPatch(session, { pins: [{ evidence: null, pinId: "pin_pay" }] });
    assert.equal(cleared?.pins[0].evidence, undefined);
    assert.equal(cleared?.pins[0].snapshot?.nodeCount, 2);

    assert.equal(applySessionPatch(session, { pins: [{ pinId: "missing" }] }), null);
    assert.equal(applySessionPatch(session, { pins: [{ diagnosis: { cause: "", version: 1 }, pinId: "pin_pay" }] }), null);
    assert.equal(applySessionPatch(session, { pins: "nope" }), null);
    assert.equal(applySessionPatch(session, { reproduction: { version: 2 } }), null);
  });
});
