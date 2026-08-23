import { describe, expect, test } from "bun:test";
import { publicHeaderCta } from "./server-header";

describe("public header CTA", () => {
  // Mutation captured: keeping Sign in for an account session after checkout
  // makes the success page contradict "Signed in as".
  test("replaces Sign in with Open app once a hosted web session exists", () => {
    expect(publicHeaderCta(null)).toBe("sign-in");
    expect(publicHeaderCta({ kind: "local", plan: "free" })).toBe("sign-in");
    expect(publicHeaderCta({
      installationId: "installation-one",
      kind: "installation",
      plan: "free",
    })).toBe("open-app");
    expect(publicHeaderCta({
      email: "pinar-catalog-e2e+20260823152414-addon@example.com",
      kind: "account",
      plan: "free",
      userId: "usr_addon",
    })).toBe("open-app");
    expect(publicHeaderCta({
      email: "pro@example.test",
      kind: "account",
      plan: "pro",
      userId: "usr_pro",
    })).toBe("open-app");
  });
});
