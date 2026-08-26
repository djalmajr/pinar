import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { publicHeaderCta } from "./server-header";

describe("public header CTA", () => {
  // Mutation captured: keeping Sign in for an account session after checkout
  // makes the success page contradict "Signed in as".
  test("replaces Sign in with Open app once a hosted web session exists", () => {
    assert.equal(publicHeaderCta(null), "sign-in");
    assert.equal(publicHeaderCta({ kind: "local", plan: "free" }), "sign-in");
    assert.equal(publicHeaderCta({
      installationId: "installation-one",
      kind: "installation",
      plan: "free",
    }), "open-app");
    assert.equal(publicHeaderCta({
      email: "pinar-catalog-e2e+20260823152414-addon@example.com",
      kind: "account",
      plan: "free",
      userId: "usr_addon",
    }), "open-app");
    assert.equal(publicHeaderCta({
      email: "pro@example.test",
      kind: "account",
      plan: "pro",
      userId: "usr_pro",
    }), "open-app");
  });
});
