import { expect, test } from "@playwright/test";
import {
  STAGING_ORIGIN,
  acceptLegalIfPrompted,
  attachStagingAccess,
  payStripeTestCheckout,
  readEntitlements,
} from "./stripe-hosted-helpers";

const enabled = process.env.PINAR_STRIPE_HOSTED_CATALOG_E2E === "1";
const buyerEmail = process.env.PINAR_STRIPE_CATALOG_EMAIL || "";
const addOnEmail = buyerEmail.replace("@", "-addon@");
const gigabyte = 1024 ** 3;

test.skip(!enabled, "Run through scripts/run-stripe-hosted-catalog-e2e.mjs against Stripe Test and staging");

test("Stripe-hosted Pro monthly activates in BRL", async ({ context, page }) => {
  expect(buyerEmail).toMatch(/^pinar-catalog-e2e\+[a-z0-9-]+@example\.com$/);
  await attachStagingAccess(context);
  test.setTimeout(120_000);

  await page.goto("/pricing");
  await page.getByRole("button", { exact: true, name: "Monthly" }).click();
  await acceptLegalIfPrompted(page);
  const monthlyCta = page.getByRole("button", { name: /Get Pro Monthly — R\$4\.90/ });
  await expect(monthlyCta).toBeEnabled();
  await monthlyCta.click();
  await payStripeTestCheckout(page, { email: buyerEmail, name: "Pinar Catalog E2E" });

  await expect(page).toHaveURL(new RegExp(`^${STAGING_ORIGIN}/success(?:\\?|$)`), { timeout: 60_000 });
  await expect(page.getByText("Payment confirmed", { exact: true })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "Open app" }).click();
  await expect(page).toHaveURL(`${STAGING_ORIGIN}/app`);

  const entitlements = await readEntitlements(page);
  expect(entitlements.ok).toBe(true);
  expect(entitlements.body).toMatchObject({
    aiCredits: { balance: 200 },
    plan: "pro",
    storage: { quotaBytes: 5 * gigabyte },
  });
});

test("Stripe-hosted AI credit add-on activates in BRL", async ({ context, page }) => {
  expect(addOnEmail).toMatch(/^pinar-catalog-e2e\+[a-z0-9-]+-addon@example\.com$/);
  await attachStagingAccess(context);
  test.setTimeout(180_000);

  await page.goto("/pricing");
  await page.getByRole("button", { exact: true, name: "Monthly" }).click();
  await acceptLegalIfPrompted(page);
  await page.getByRole("button", { name: /Get Pro Monthly — R\$4\.90/ }).click();
  await payStripeTestCheckout(page, { email: addOnEmail, name: "Pinar Catalog E2E" });
  await expect(page).toHaveURL(new RegExp(`^${STAGING_ORIGIN}/success(?:\\?|$)`), { timeout: 60_000 });
  await expect(page.getByText("Payment confirmed", { exact: true })).toBeVisible();
  await page.goto("/pricing", { waitUntil: "domcontentloaded" });
  await acceptLegalIfPrompted(page);
  await page.getByRole("button", { name: "Buy add-on" }).first().click();
  await payStripeTestCheckout(page, { email: addOnEmail, name: "Pinar Catalog E2E" });
  await expect(page).toHaveURL(new RegExp(`^${STAGING_ORIGIN}/success(?:\\?|$)`), { timeout: 60_000 });
  await expect(page.getByText("Payment confirmed", { exact: true })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "Open app" }).click();

  const entitlements = await readEntitlements(page);
  expect(entitlements.ok).toBe(true);
  expect(entitlements.body).toMatchObject({
    aiCredits: { balance: 1_200 },
    plan: "pro",
    storage: { quotaBytes: 5 * gigabyte },
  });
});
