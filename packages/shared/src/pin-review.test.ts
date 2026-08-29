import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PinReviewError,
  countPinReviews,
  humanActionsForStatus,
  resolvePinReviewTransition,
  sessionMatchesReviewFilters,
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
    assert.throws(
      () => resolvePinReviewTransition("open", "accept"),
      (error: unknown) => error instanceof PinReviewError && error.code === "invalid_transition",
    );
  });

  test("only humans accept from correction_ready and reopen from accepted", () => {
    assert.deepEqual(resolvePinReviewTransition("correction_ready", "accept"), {
      changed: true,
      next: "accepted",
    });
    assert.deepEqual(resolvePinReviewTransition("accepted", "reopen"), {
      changed: true,
      next: "reopened",
    });
    assert.deepEqual(humanActionsForStatus("correction_ready"), ["accept"]);
    assert.deepEqual(humanActionsForStatus("accepted"), ["reopen"]);
    assert.deepEqual(humanActionsForStatus("open"), []);
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
});
