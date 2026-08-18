import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  stripeSubscriptionStateShouldReplace,
  stripeSubscriptionStatus,
} from "./stripe-subscription-state";

describe("Stripe subscription state ordering", () => {
  // Mutation captured: treating unknown or incomplete states as active grants paid access incorrectly.
  test("maps Stripe terminal, active, delinquent and unknown states", () => {
    assert.equal(stripeSubscriptionStatus("customer.subscription.deleted", "active"), "canceled");
    assert.equal(stripeSubscriptionStatus("customer.subscription.updated", "canceled"), "canceled");
    assert.equal(stripeSubscriptionStatus("customer.subscription.updated", "trialing"), "active");
    for (const status of ["incomplete", "incomplete_expired", "past_due", "paused", "unpaid"]) {
      assert.equal(stripeSubscriptionStatus("customer.subscription.updated", status), "past_due");
    }
    assert.equal(stripeSubscriptionStatus("customer.subscription.updated", "unknown"), null);
  });

  // Mutation captured: removing event-time or same-second severity ordering resurrects stale subscriptions.
  test("replaces only newer events or a stricter state at the same second", () => {
    assert.equal(stripeSubscriptionStateShouldReplace(undefined, {
      eventCreated: 10,
      status: "active",
    }), true);
    assert.equal(stripeSubscriptionStateShouldReplace({
      eventCreated: 10,
      status: "active",
    }, {
      eventCreated: 11,
      status: "active",
    }), true);
    assert.equal(stripeSubscriptionStateShouldReplace({
      eventCreated: 10,
      status: "active",
    }, {
      eventCreated: 9,
      status: "canceled",
    }), false);
    assert.equal(stripeSubscriptionStateShouldReplace({
      eventCreated: 10,
      status: "active",
    }, {
      eventCreated: 10,
      status: "past_due",
    }), true);
    assert.equal(stripeSubscriptionStateShouldReplace({
      eventCreated: 10,
      status: "canceled",
    }, {
      eventCreated: 10,
      status: "past_due",
    }), false);
  });
});
