import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  STAGING_ORIGIN,
  attachStagingAccess,
  payStripeTestCheckout,
  readEntitlements,
} from "./stripe-hosted-helpers";

const enabled = process.env.PINAR_STRIPE_HOSTED_USD_E2E === "1";
const buyerEmail = process.env.PINAR_STRIPE_USD_EMAIL || "";
const secretKey = process.env.STRIPE_TEST_RESTRICTED_KEY || "";
const gigabyte = 1024 ** 3;
const legalVersion = "2026-08-18";

test.skip(!enabled, "Run through scripts/run-stripe-hosted-usd-e2e.mjs against Stripe Test USD prices");

async function createUsdCheckout(input: {
  customerId?: string;
  email: string;
  mode: "payment" | "subscription";
  offer: string;
  priceId: string;
}) {
  const checkoutClaim = randomUUID();
  const claimHash = createHash("sha256").update(checkoutClaim).digest("hex");
  const acceptedAt = new Date().toISOString();
  const body = new URLSearchParams({
    allow_promotion_codes: "true",
    cancel_url: `${STAGING_ORIGIN}/pricing`,
    integration_identifier: `pinar_usd_${randomUUID().slice(0, 8)}`,
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": "1",
    "metadata[pinar_acceptable_use_version]": legalVersion,
    "metadata[pinar_checkout_claim_hash]": claimHash,
    "metadata[pinar_legal_acceptance_source]": "app",
    "metadata[pinar_legal_accepted_at]": acceptedAt,
    "metadata[pinar_locale]": "en",
    "metadata[pinar_offer]": input.offer,
    "metadata[pinar_privacy_version]": legalVersion,
    "metadata[pinar_terms_version]": legalVersion,
    mode: input.mode,
    success_url: `${STAGING_ORIGIN}/success?session_id={CHECKOUT_SESSION_ID}&claim=${encodeURIComponent(checkoutClaim)}`,
  });
  if (input.customerId) body.set("customer", input.customerId);
  else {
    body.set("customer_email", input.email);
    if (input.mode !== "subscription") body.set("customer_creation", "always");
  }
  if (input.mode === "subscription") {
    body.set("subscription_data[metadata][pinar_offer]", input.offer);
  }
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    body,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Idempotency-Key": `pinar:usd-e2e:${input.offer}:${checkoutClaim}`,
      "Stripe-Version": "2026-07-29.dahlia",
    },
    method: "POST",
  });
  const session = await response.json();
  if (!response.ok || session.livemode !== false || typeof session.url !== "string") {
    throw new Error(session?.error?.message || `Failed to create USD Checkout for ${input.offer}`);
  }
  return { claim: checkoutClaim, id: session.id as string, url: session.url as string };
}

async function stripeCustomerId(sessionId: string) {
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Stripe-Version": "2026-07-29.dahlia",
      },
    },
  );
  const session = await response.json();
  const customerId = typeof session.customer === "string" ? session.customer : "";
  if (!response.ok || !customerId) {
    throw new Error(session?.error?.message || `Missing Stripe customer on ${sessionId}`);
  }
  return customerId;
}

test("Stripe Test USD Pro monthly and add-ons fulfill on staging", async ({ context, page }) => {
  expect(buyerEmail).toMatch(/^pinar-usd-e2e\+[a-z0-9-]+@example\.com$/);
  expect(secretKey.startsWith("rk_test_")).toBe(true);
  await attachStagingAccess(context);
  test.setTimeout(360_000);

  const monthly = await createUsdCheckout({
    email: buyerEmail,
    mode: "subscription",
    offer: "pro_month",
    priceId: process.env.STRIPE_TEST_PRICE_MONTHLY || "",
  });
  await page.goto(monthly.url);
  await payStripeTestCheckout(page, { email: buyerEmail, name: "Pinar USD E2E" });
  await expect(page).toHaveURL(new RegExp(`^${STAGING_ORIGIN}/success(?:\\?|$)`), { timeout: 60_000 });
  await expect(page.getByText("Payment confirmed", { exact: true })).toBeVisible();
  const customerId = await stripeCustomerId(monthly.id);
  await page.getByRole("link", { exact: true, name: "Open app" }).click();

  let entitlements = await readEntitlements(page);
  expect(entitlements.ok).toBe(true);
  expect(entitlements.body).toMatchObject({
    aiCredits: { balance: 200 },
    plan: "pro",
    storage: { quotaBytes: 5 * gigabyte },
  });

  const addOns = [
    {
      expected: { aiCredits: { balance: 1_200 }, storage: { quotaBytes: 5 * gigabyte } },
      offer: "ai_credits_1000",
      priceId: process.env.STRIPE_TEST_PRICE_AI_CREDITS_1000 || "",
    },
    {
      expected: { aiCredits: { balance: 1_200 }, storage: { quotaBytes: 10 * gigabyte } },
      offer: "storage_5gb_12m",
      priceId: process.env.STRIPE_TEST_PRICE_STORAGE_5GB_12M || "",
    },
    {
      expected: { aiCredits: { balance: 1_200 }, storage: { quotaBytes: 30 * gigabyte } },
      offer: "storage_20gb_12m",
      priceId: process.env.STRIPE_TEST_PRICE_STORAGE_20GB_12M || "",
    },
  ] as const;

  for (const addOn of addOns) {
    const session = await createUsdCheckout({
      customerId,
      email: buyerEmail,
      mode: "payment",
      offer: addOn.offer,
      priceId: addOn.priceId,
    });
    await page.goto(session.url);
    await payStripeTestCheckout(page, { email: buyerEmail, name: "Pinar USD E2E" });
    await expect(page).toHaveURL(new RegExp(`^${STAGING_ORIGIN}/success(?:\\?|$)`), { timeout: 60_000 });
    await expect(page.getByText("Payment confirmed", { exact: true })).toBeVisible();
    await page.getByRole("link", { exact: true, name: "Open app" }).click();
    entitlements = await readEntitlements(page);
    expect(entitlements.ok).toBe(true);
    expect(entitlements.body).toMatchObject({
      plan: "pro",
      ...addOn.expected,
    });
  }
});
