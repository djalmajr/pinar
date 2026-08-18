import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isAuthSession, isPaidAuthSession } from "./auth-session";

describe("authentication session contract", () => {
  // Mutation captured: accepting an unknown kind or plan makes one of the negative cases pass.
  test("accepts only the three public session shapes", () => {
    assert.equal(isAuthSession({ kind: "local", plan: "free" }), true);
    assert.equal(isAuthSession({
      installationId: "installation-one",
      kind: "installation",
      plan: "free",
    }), true);
    assert.equal(isAuthSession({
      email: "founder@example.test",
      kind: "account",
      plan: "founder",
      userId: "founder-account",
    }), true);
    assert.equal(isAuthSession({
      email: "pro@example.test",
      kind: "account",
      plan: "pro",
      userId: "pro-account",
    }), true);
    assert.equal(isAuthSession(null), false);
    assert.equal(isAuthSession({ kind: "local", plan: "pro" }), false);
    assert.equal(isAuthSession({ kind: "installation", plan: "free" }), false);
    assert.equal(isAuthSession({
      email: "pro@example.test",
      kind: "account",
      plan: "enterprise",
      userId: "pro-account",
    }), false);
    assert.equal(isAuthSession({ kind: "unknown", plan: "free" }), false);
  });
});

describe("paid authentication session", () => {
  test("identifies only paid account plans", () => {
    assert.equal(isPaidAuthSession(null), false);
    assert.equal(isPaidAuthSession({ kind: "local", plan: "free" }), false);
    assert.equal(isPaidAuthSession({
      installationId: "installation-one",
      kind: "installation",
      plan: "free",
    }), false);
    assert.equal(isPaidAuthSession({
      email: "free@example.test",
      kind: "account",
      plan: "free",
      userId: "free-account",
    }), false);
    assert.equal(isPaidAuthSession({
      email: "founder@example.test",
      kind: "account",
      plan: "founder",
      userId: "founder-account",
    }), true);
    assert.equal(isPaidAuthSession({
      email: "pro@example.test",
      kind: "account",
      plan: "pro",
      userId: "pro-account",
    }), true);
    assert.equal(isPaidAuthSession({
      email: "lifetime@example.test",
      kind: "account",
      plan: "lifetime",
      userId: "lifetime-account",
    }), true);
  });
});
