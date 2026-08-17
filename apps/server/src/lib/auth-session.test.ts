import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isPaidAuthSession } from "./auth-session";

describe("paid authentication session", () => {
  test("thanks only paid account plans", () => {
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
