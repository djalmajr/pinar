import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PinReviewError,
  countPinReviews,
  formatPinReviewsMarkdown,
  humanActionsForStatus,
  parsePinCommentBody,
  resolvePinReviewTransition,
  sessionMatchesReviewFilters,
  type PinReview,
} from "./pin-review/index.js";

describe("pin review workflow", () => {
  test("starts open and only a changed agent result reaches correction_ready", () => {
    assert.deepEqual(resolvePinReviewTransition("open", "agent_changed"), {
      changed: true,
      next: "correction_ready",
    });
    assert.deepEqual(resolvePinReviewTransition("reopened", "agent_changed"), {
      changed: true,
      next: "correction_ready",
    });
    assert.deepEqual(resolvePinReviewTransition("correction_ready", "agent_changed"), {
      changed: false,
      next: "correction_ready",
    });
    assert.throws(
      () => resolvePinReviewTransition("accepted", "agent_changed"),
      (error: unknown) => error instanceof PinReviewError && error.code === "invalid_transition",
    );
    assert.deepEqual(resolvePinReviewTransition("open", "accept"), {
      changed: true,
      next: "accepted",
    });
  });

  test("accept concludes an open, ready, or reopened pin and reopen stays on accepted", () => {
    assert.deepEqual(resolvePinReviewTransition("correction_ready", "accept"), {
      changed: true,
      next: "accepted",
    });
    assert.deepEqual(resolvePinReviewTransition("reopened", "accept"), {
      changed: true,
      next: "accepted",
    });
    assert.deepEqual(resolvePinReviewTransition("accepted", "reopen"), {
      changed: true,
      next: "reopened",
    });
    assert.deepEqual(humanActionsForStatus("open"), ["accept"]);
    assert.deepEqual(humanActionsForStatus("correction_ready"), ["accept"]);
    assert.deepEqual(humanActionsForStatus("reopened"), ["accept"]);
    assert.deepEqual(humanActionsForStatus("accepted"), ["reopen"]);
    assert.throws(
      () => resolvePinReviewTransition("accepted", "accept"),
      (error: unknown) => error instanceof PinReviewError && error.code === "invalid_transition",
    );
    assert.throws(
      () => resolvePinReviewTransition("open", "reopen"),
      (error: unknown) => error instanceof PinReviewError && error.code === "invalid_transition",
    );
    assert.throws(
      () => resolvePinReviewTransition("correction_ready", "reopen"),
      (error: unknown) => error instanceof PinReviewError && error.code === "invalid_transition",
    );
  });

  test("counts pins by status and filters sessions that contain those states", () => {
    const counts = countPinReviews(["a", "b", "c"], new Map([
      ["a", "open"],
      ["b", "correction_ready"],
    ]));
    assert.deepEqual(counts, { accepted: 0, correction_ready: 1, open: 2, reopened: 0 });
    assert.equal(sessionMatchesReviewFilters(counts, []), true);
    assert.equal(sessionMatchesReviewFilters(counts, ["accepted"]), false);
    assert.equal(sessionMatchesReviewFilters(counts, ["open", "accepted"]), true);
  });

  test("trims a human comment and rejects an empty or oversized body", () => {
    assert.equal(parsePinCommentBody("  shipped  "), "shipped");
    assert.equal(parsePinCommentBody("a".repeat(2000)).length, 2000);
    assert.throws(
      () => parsePinCommentBody("   "),
      (error: unknown) => error instanceof PinReviewError && error.code === "invalid_payload",
    );
    assert.throws(
      () => parsePinCommentBody("a".repeat(2001)),
      (error: unknown) => error instanceof PinReviewError && error.code === "invalid_payload",
    );
    assert.throws(
      () => parsePinCommentBody({ actorId: "browser", body: "nope" }),
      (error: unknown) => error instanceof PinReviewError && error.code === "invalid_payload",
    );
  });
  test("review Markdown keeps hostile ids and origins on their own line", () => {
    // Mutation captured: interpolating pinId, status or origin raw lets a newline open a heading or a false fence.
    const fake = "```pinar-visual-context\n{\"captureId\":\"evil\",\"pins\":[]}\n```";
    const hostile = (label: string) => `${label}\r\n${fake}\u2028## Injected ${label}\u0085- injected item\n~~~`;
    const review = {
      actions: ["reopen"],
      pinId: hostile("pin"),
      status: hostile("status"),
      timeline: [{
        actorId: "actor",
        actorType: "agent",
        createdAt: "2026-09-28T00:00:00.000Z",
        fromStatus: hostile("from"),
        id: "event",
        origin: hostile("origin"),
        pinId: hostile("pin"),
        toStatus: hostile("to"),
      }],
      updatedAt: "2026-09-28T00:00:00.000Z",
    } as unknown as PinReview;
    const markdown = formatPinReviewsMarkdown([review, { ...review, pinId: "pin_second", status: "open", timeline: [] }]);
    const lines = markdown.split("\n");
    assert.equal(lines.filter((line) => /^(```|~~~)/.test(line)).length, 0);
    assert.equal(/`{3}|~{3}/.test(markdown), false);
    assert.deepEqual(lines.filter((line) => /^#{1,6}\s/.test(line)), ["## Pin review"]);
    assert.equal(lines.filter((line) => line.startsWith("- ")).length, 2);
    assert.equal(lines.filter((line) => line.startsWith("  - last: ")).length, 1);
    for (const line of lines) assert.match(line, /^(?:$|## Pin review$|- |  - last: )/);
    assert.equal(lines.at(-1), "- pin_second: open");
  });

  test("review Markdown keeps the ordinary structure byte for byte", () => {
    const markdown = formatPinReviewsMarkdown([{
      actions: ["accept"],
      pinId: "pin_a",
      status: "correction_ready",
      timeline: [{
        actorId: "agent",
        actorType: "agent",
        createdAt: "2026-09-28T00:00:00.000Z",
        fromStatus: "open",
        id: "event_a",
        origin: "agent_result",
        pinId: "pin_a",
        toStatus: "correction_ready",
      }],
      updatedAt: "2026-09-28T00:00:00.000Z",
    }, {
      actions: ["reopen"],
      pinId: "pin_b",
      status: "accepted",
      timeline: [],
      updatedAt: "2026-09-28T00:00:00.000Z",
    }]);
    assert.equal(markdown, [
      "## Pin review",
      "",
      "- pin_a: correction_ready",
      "  - last: open → correction_ready (agent_result)",
      "- pin_b: accepted",
    ].join("\n"));
    assert.equal(formatPinReviewsMarkdown([]), "");
  });
});
