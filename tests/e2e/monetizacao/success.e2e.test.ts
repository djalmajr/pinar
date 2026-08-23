import { expect, test } from "@playwright/test";

// Mutation captured: reporting missing search parameters after activation has
// started reproduces the staging error when the sensitive URL is scrubbed.
test("checkout return activates the account without showing a stale missing-session error", async ({ page }) => {
  const sessionId = "cs_test_checkout_return_0001";
  const claim = "checkout_claim_return_0001";
  let activationRequest = "";
  let signedIn = false;

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      json: signedIn
        ? {
          session: {
            email: "checkout@example.test",
            kind: "account",
            plan: "pro",
            userId: "usr_checkout",
          },
        }
        : { session: { kind: "local", plan: "free" } },
    });
  });

  await page.route("**/api/stripe/success?**", async (route) => {
    activationRequest = route.request().url();
    signedIn = true;
    await route.fulfill({
      json: {
        account: { email: "checkout@example.test", kind: "account", plan: "pro" },
        offer: "pro_year",
        ok: true,
      },
    });
  });

  await page.goto(`/success?session_id=${sessionId}&claim=${claim}`);

  await expect.poll(() => activationRequest).toContain(`session_id=${sessionId}`);
  expect(activationRequest).toContain(`claim=${claim}`);
  await expect(page.getByText("Your pro plan is active", { exact: true })).toBeVisible();
  await expect(page.getByText("Signed in as checkout@example.test", { exact: true })).toBeVisible();
  await expect(page.getByText("Checkout session is missing", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { exact: true, name: "Sign in" })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { exact: true, name: "Open app" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { exact: true, name: "Open app" })).toBeEnabled();
  await expect(page).toHaveURL("/success");
});
