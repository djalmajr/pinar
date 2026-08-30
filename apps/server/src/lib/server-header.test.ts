import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { publicHeaderCta, publicHeaderShowsPlans, shouldUseWorkspaceChrome } from "./server-header";
import { cloudRedirectLocation } from "./local-cloud-redirect";

describe("public header CTA", () => {
  // Mutation captured: keeping Sign in for an account session after checkout
  // makes the success page contradict "Signed in as".
  test("replaces Sign in with Open app once a hosted web session exists", () => {
    assert.equal(publicHeaderCta(null), "sign-in");
    assert.equal(publicHeaderCta(null, "cloud"), "sign-in");
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

  test("local helper never offers Sign in", () => {
    assert.equal(publicHeaderCta(null, "local"), "open-app");
    assert.equal(publicHeaderCta({ kind: "local", plan: "free" }, "cloud"), "open-app");
  });

  test("local helper hides Plans", () => {
    assert.equal(publicHeaderShowsPlans("local"), false);
    assert.equal(publicHeaderShowsPlans("cloud"), true);
  });

  test("local helper uses workspace chrome instead of the public header", () => {
    assert.equal(shouldUseWorkspaceChrome("local"), true);
    assert.equal(shouldUseWorkspaceChrome("cloud"), false);
  });
});

describe("local cloud redirects", () => {
  test("sends pricing, sign-in and success to pinar.dev only on the local runtime", () => {
    assert.equal(cloudRedirectLocation("cloud", "/pricing", ""), null);
    assert.equal(cloudRedirectLocation("local", "/app", ""), null);
    assert.equal(cloudRedirectLocation("local", "/pricing", ""), "https://pinar.dev/pricing");
    assert.equal(
      cloudRedirectLocation("local", "/sign-in", "?returnTo=%2Fapp"),
      "https://pinar.dev/sign-in?returnTo=%2Fapp",
    );
    assert.equal(
      cloudRedirectLocation("local", "/success", "?session_id=cs_test&claim=abc"),
      "https://pinar.dev/success?session_id=cs_test&claim=abc",
    );
  });
});
