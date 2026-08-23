import { expect, test } from "@playwright/test";
import { primaryNavigationItem } from "../helpers/ui";

const BrazilPricing = {
  country: "BR",
  currency: "BRL",
  discountPercent: null,
  founderState: "available",
  prices: {
    aiCredits1000: { amount: 990, originalAmount: null },
    founder: { amount: 12_990, originalAmount: null },
    free: { amount: 0, originalAmount: null },
    month: { amount: 490, originalAmount: null },
    storage20Gb12M: { amount: 2_990, originalAmount: null },
    storage5Gb12M: { amount: 990, originalAmount: null },
    year: { amount: 3_990, originalAmount: null },
  },
  regional: true,
};

interface BadgeColors {
  backgroundColor: string;
  borderColor: string;
  color: string;
}

async function badgeColors(page: import("@playwright/test").Page, text: string): Promise<BadgeColors> {
  return page.getByText(text, { exact: true }).evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      color: style.color,
    };
  });
}

// Mutation captured: changing the landing badge from `proSoft` to `pro` makes
// its computed background differ from the matching pricing badge.
test("public hero badges share the same soft Pro treatment", async ({ page }) => {
  await page.goto("/");
  const landingColors = await badgeColors(page, "Visual feedback for AI workflows");

  await page.goto("/pricing");
  const pricingColors = await badgeColors(page, "Pinar Pro & Sponsors");

  expect(landingColors).toEqual(pricingColors);
});

// Mutation captured: forcing `isYearly = true` leaves the Monthly click on the
// annual card; this test fails while waiting for the observable Pro Monthly UI.
test("visitor compares every BRL offer without opening checkout", async ({ page }) => {
  await page.route("**/api/pricing", (route) => route.fulfill({ json: BrazilPricing }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Point to the problem. Share the complete context." })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "View plans" }).click();

  await expect(page.getByRole("button", { exact: true, name: "Yearly" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Pro Yearly" })).toBeVisible();
  await expect(page.getByText("R$39.90", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pinar Founder" })).toBeVisible();
  await expect(page.getByText("R$129.90", { exact: true })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Monthly" }).click();
  await expect(page.getByRole("heading", { name: "Pro Monthly" })).toBeVisible();
  await expect(page.getByText("R$4.90", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "1,000 AI credits" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "+5 GB storage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "+20 GB storage" })).toBeVisible();
  await expect(page.getByText("valid for 12 months")).toHaveCount(3);

  await (await primaryNavigationItem(page, "Home")).click();
  await expect(page).toHaveURL("/");
});

// Mutation captured: wrapping Button with an anchor nests two interactive
// elements, so the semantic assertion finds one button inside the link.
test("Use Free is one accessible link that opens the installation documentation", async ({ context, page }) => {
  await page.route("**/api/pricing", (route) => route.fulfill({ json: BrazilPricing }));
  await context.route("https://github.com/djalmajr/pinar", (route) => route.fulfill({
    body: "<h1>Pinar repository</h1>",
    contentType: "text/html",
  }));
  await page.goto("/pricing");
  const useFree = page.getByRole("link", { exact: true, name: "Use Free" });

  await expect(useFree.getByRole("button")).toHaveCount(0);
  const popupPromise = page.waitForEvent("popup");
  await useFree.click();
  const popup = await popupPromise;

  await expect(popup).toHaveURL("https://github.com/djalmajr/pinar");
  await expect(popup.getByRole("heading", { name: "Pinar repository" })).toBeVisible();
});

test("paid checkout asks for current consent only after the server requires it", async ({ page }) => {
  const checkoutBodies: Record<string, unknown>[] = [];
  await page.route("**/api/pricing", (route) => route.fulfill({ json: BrazilPricing }));
  await page.route("**/api/stripe/checkout", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    checkoutBodies.push(body);
    if (!body.legalAcceptance) {
      await route.fulfill({
        json: { code: "legal_acceptance_required", error: "Current legal acceptance is required", version: "2026-08-18" },
        status: 400,
      });
      return;
    }
    const origin = new URL(route.request().url()).origin;
    await route.fulfill({ json: { ok: true, url: `${origin}/pricing?checkout=ready` } });
  });

  await page.goto("/pricing");
  const founderCheckout = page.getByRole("button", { name: "Get Pinar Founder — R$129.90" });
  await expect(founderCheckout).toBeEnabled();
  await founderCheckout.click();

  const dialog = page.getByRole("dialog", { name: "Review the current policies" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Terms of Service", exact: true }))
    .toHaveAttribute("href", "/legal/terms");
  await expect(dialog.getByText("Version 2026-08-18.")).toBeVisible();
  const continueButton = dialog.getByRole("button", { name: "Accept and continue" });
  await expect(continueButton).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I agree to the Terms of Service/ }).check();
  await continueButton.click();
  await expect(page).toHaveURL(/\/pricing\?checkout=ready$/);

  expect(checkoutBodies).toHaveLength(2);
  expect(checkoutBodies[0].legalAcceptance).toBeUndefined();
  assertCheckoutConsent(checkoutBodies[1]);
});

test("an account with current acceptance goes directly to checkout", async ({ page }) => {
  let checkoutBody: Record<string, unknown> | null = null;
  await page.route("**/api/pricing", (route) => route.fulfill({ json: BrazilPricing }));
  await page.route("**/api/stripe/checkout", async (route) => {
    checkoutBody = route.request().postDataJSON() as Record<string, unknown>;
    const origin = new URL(route.request().url()).origin;
    await route.fulfill({ json: { ok: true, url: `${origin}/pricing?checkout=direct` } });
  });

  await page.goto("/pricing");
  await page.getByRole("button", { name: "Get Pinar Founder — R$129.90" }).click();
  await expect(page).toHaveURL(/\/pricing\?checkout=direct$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(checkoutBody?.legalAcceptance).toBeUndefined();
});

function assertCheckoutConsent(body: Record<string, unknown> | null) {
  expect(body).not.toBeNull();
  expect(body?.offer).toBe("founder");
  expect(body?.locale).toBe("en");
  expect(body?.legalAcceptance).toEqual({
    acceptableUseVersion: "2026-08-18",
    accepted: true,
    locale: "en",
    privacyVersion: "2026-08-18",
    termsVersion: "2026-08-18",
  });
}
