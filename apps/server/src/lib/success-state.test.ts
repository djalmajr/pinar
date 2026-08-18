import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reduceCheckoutActivation, type CheckoutActivationState } from "./success-state";

describe("checkout activation state", () => {
  test("replaces an initial missing-session error after a later successful activation", () => {
    const idle: CheckoutActivationState = { status: "idle" };
    const initialError = reduceCheckoutActivation(idle, { type: "missing" });
    const activating = reduceCheckoutActivation(initialError, { type: "activate" });
    const afterUrlScrub = reduceCheckoutActivation(activating, { type: "missing" });
    const active = reduceCheckoutActivation(afterUrlScrub, {
      activation: { email: "checkout@example.test", offer: "pro_year", plan: "pro" },
      type: "succeed",
    });

    assert.deepEqual(afterUrlScrub, { status: "activating" });
    assert.deepEqual(active, {
      activation: { email: "checkout@example.test", offer: "pro_year", plan: "pro" },
      status: "active",
    });
    assert.equal("error" in active, false);
  });

  // Mutation captured: applying a scrubbed-URL missing action twice replaces an existing terminal error.
  test("preserves non-idle state and exposes terminal activation failures", () => {
    const failure = {
      error: { kind: "message" as const, value: "Checkout unavailable" },
      status: "error" as const,
    };
    assert.deepEqual(reduceCheckoutActivation(failure, { type: "missing" }), failure);
    assert.deepEqual(reduceCheckoutActivation({ status: "activating" }, {
      error: failure.error,
      type: "fail",
    }), failure);
  });
});
