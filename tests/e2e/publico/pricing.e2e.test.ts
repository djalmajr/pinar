import { expect, test } from "@playwright/test";
import { primaryNavigationItem } from "../helpers/ui";

const MACOS_DMG_URL = "https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg";

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

test("public desktop navigation keeps Home, Plans, What's new, and Help in that order", async ({ page }) => {
  await page.goto("/?lang=pt");
  const primaryNavigation = page.getByRole("navigation", { name: "Navegação principal" });

  await expect(primaryNavigation.getByRole("link")).toHaveText(["Início", "Planos", "Novidades", "Ajuda"]);
});

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
test("Use Free is one accessible link that opens the macOS desktop installer", async ({ context, page }) => {
  await page.route("**/api/pricing", (route) => route.fulfill({ json: BrazilPricing }));
  await context.route(MACOS_DMG_URL, (route) => route.fulfill({
    body: "<h1>Pinar for macOS</h1>",
    contentType: "text/html",
  }));
  await page.goto("/pricing");
  const useFree = page.getByRole("link", { exact: true, name: "Use Free" });

  await expect(useFree.getByRole("button")).toHaveCount(0);
  await expect(useFree).toHaveAttribute("href", MACOS_DMG_URL);
  const popupPromise = page.waitForEvent("popup");
  await useFree.click();
  const popup = await popupPromise;

  await expect(popup).toHaveURL(MACOS_DMG_URL);
  await expect(popup.getByRole("heading", { name: "Pinar for macOS" })).toBeVisible();
});

test("paid checkout sends current consent on the first click", async ({ page }) => {
  const checkoutBodies: Record<string, unknown>[] = [];
  await page.route("**/api/pricing", (route) => route.fulfill({ json: BrazilPricing }));
  await page.route("**/api/stripe/checkout", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    checkoutBodies.push(body);
    const origin = new URL(route.request().url()).origin;
    await route.fulfill({ json: { ok: true, url: `${origin}/pricing?checkout=ready` } });
  });

  await page.goto("/pricing");
  const founderFooter = page.getByRole("button", { name: "Get Pinar Founder — R$129.90" })
    .locator("xpath=ancestor::*[@data-slot='card-footer']");
  await expect(founderFooter.getByText("By continuing, you accept the")).toBeVisible();
  await expect(founderFooter.getByRole("link", { name: "Terms of Service", exact: true }))
    .toHaveAttribute("href", "/legal/terms");
  await expect(founderFooter.getByText("Version 2026-08-25.")).toBeVisible();
  const freeFooter = page.getByRole("link", { exact: true, name: "Use Free" })
    .locator("xpath=ancestor::*[@data-slot='card-footer']");
  await expect(freeFooter.getByText("By continuing, you accept the")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const founderCheckout = page.getByRole("button", { name: "Get Pinar Founder — R$129.90" });
  await expect(founderCheckout).toBeEnabled();
  await founderCheckout.click();
  await expect(page).toHaveURL(/\/pricing\?checkout=ready$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  expect(checkoutBodies).toHaveLength(1);
  assertCheckoutConsent(checkoutBodies[0]);
});

test("pricing footer keeps Stripe checkout note above legal links", async ({ page }) => {
  await page.route("**/api/pricing", (route) => route.fulfill({ json: BrazilPricing }));
  await page.goto("/pricing");

  const footer = page.getByRole("contentinfo");
  const checkoutNote = footer.getByText("Secure checkout powered by Stripe", { exact: false });
  const copyright = footer.getByText(/^© \d{4}$/);
  const legalNav = footer.getByRole("navigation", { name: "Legal documents" });
  const [checkoutNoteBox, copyrightBox, legalNavBox] = await Promise.all([
    checkoutNote.boundingBox(),
    copyright.boundingBox(),
    legalNav.boundingBox(),
  ]);
  if (!checkoutNoteBox || !copyrightBox || !legalNavBox) {
    throw new Error("Expected the pricing footer checkout note, copyright, and legal navigation.");
  }
  expect(copyrightBox.y - (checkoutNoteBox.y + checkoutNoteBox.height)).toBeGreaterThanOrEqual(16);
});

function assertCheckoutConsent(body: Record<string, unknown> | null) {
  expect(body).not.toBeNull();
  expect(body?.offer).toBe("founder");
  expect(body?.locale).toBe("en");
  expect(body?.legalAcceptance).toEqual({
    acceptableUseVersion: "2026-08-25",
    accepted: true,
    locale: "en",
    privacyVersion: "2026-08-25",
    termsVersion: "2026-08-25",
  });
}
