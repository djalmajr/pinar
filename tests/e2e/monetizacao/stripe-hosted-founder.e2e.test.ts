import { expect, test } from "@playwright/test";

const enabled = process.env.PINAR_STRIPE_HOSTED_E2E === "1";
const founderEmail = process.env.PINAR_STRIPE_FOUNDER_EMAIL || "";
const accessClientId = process.env.CF_ACCESS_CLIENT_ID || "";
const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET || "";

test.skip(!enabled, "Run through scripts/run-stripe-hosted-e2e.mjs against Stripe Test and staging");

// Mutation captured: returning a non-Test Checkout URL or dropping Founder
// fulfillment breaks the provider boundary and the authenticated API contract.
test("Stripe-hosted Founder checkout activates the account", async ({ context, page }) => {
  expect(founderEmail).toMatch(/^pinar-founder-e2e\+[a-z0-9-]+@example\.com$/);
  expect(accessClientId).not.toBe("");
  expect(accessClientSecret).not.toBe("");

  await context.route("https://stg.pinar.dev/**", (route) => route.continue({
    headers: {
      ...route.request().headers(),
      "CF-Access-Client-Id": accessClientId,
      "CF-Access-Client-Secret": accessClientSecret,
    },
  }));

  await page.goto("/");
  await page.getByRole("link", { exact: true, name: "View plans" }).click();
  await page.getByRole("checkbox", { name: /I agree to the Terms of Service/ }).check();
  await page.getByRole("button", { name: "Get Pinar Founder — R$129.90" }).click();

  await expect(page).toHaveURL(/checkout\.stripe\.com\/.*cs_test_/, { timeout: 30_000 });
  const email = page.getByLabel(/Email/i);
  if (await email.isEditable()) await email.fill(founderEmail);
  await page.getByLabel(/Card number/i).fill("4242424242424242");
  await page.getByLabel(/Expiration|Expiry/i).fill("1234");
  await page.getByLabel(/CVC/i).fill("123");
  await page.getByLabel(/Cardholder name/i).fill("Pinar Founder E2E");
  await page.getByRole("button", { name: /^Pay/ }).click();

  await expect(page).toHaveURL(/https:\/\/stg\.pinar\.dev\/success(?:\?|$)/, { timeout: 60_000 });
  await expect(page.getByText("Payment confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("Your founder plan is active", { exact: true })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "Open app" }).click();

  await expect(page).toHaveURL("https://stg.pinar.dev/app");
  const accountMenu = page.locator('[data-sidebar="footer"]')
    .getByRole("button", { exact: true, name: "Account menu" });
  await expect(accountMenu).toBeVisible();
  await accountMenu.click();
  await expect(page.getByRole("menu").getByText(founderEmail, { exact: true })).toBeVisible();
  await expect(page.getByText("Support via Open Source Sponsorship", { exact: true })).toHaveCount(0);

  const entitlements = await page.evaluate(async () => {
    const response = await fetch("/api/account/entitlements", { cache: "no-store" });
    return { body: await response.json(), ok: response.ok };
  });
  expect(entitlements.ok).toBe(true);
  expect(entitlements.body).toMatchObject({
    aiCredits: { balance: 500 },
    plan: "founder",
    storage: { quotaBytes: 5 * 1024 ** 3, usedBytes: 0 },
  });
});
