import { expect, type BrowserContext, type Page } from "@playwright/test";

export const STAGING_ORIGIN = "https://stg.pinar.dev";

export function stagingAccessHeaders() {
  const accessClientId = process.env.CF_ACCESS_CLIENT_ID || "";
  const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET || "";
  expect(accessClientId).not.toBe("");
  expect(accessClientSecret).not.toBe("");
  return {
    "CF-Access-Client-Id": accessClientId,
    "CF-Access-Client-Secret": accessClientSecret,
  };
}

export async function attachStagingAccess(context: BrowserContext) {
  const accessHeaders = stagingAccessHeaders();
  await context.route("https://stg.pinar.dev/**", (route) => route.continue({
    headers: {
      ...route.request().headers(),
      ...accessHeaders,
    },
  }));
}

export async function acceptLegalIfPrompted(page: Page) {
  const pageConsent = page.getByRole("checkbox", { name: /I agree to the Terms of Service/ });
  if (await pageConsent.count()) {
    await pageConsent.check();
    return;
  }
  const dialog = page.getByRole("dialog");
  if (!await dialog.isVisible().catch(() => false)) return;
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { exact: true, name: "Accept and continue" }).click();
}

async function firstMatching(page: Page, selector: string) {
  const direct = page.locator(selector).first();
  if (await direct.isVisible({ timeout: 2_000 }).catch(() => false)) return direct;
  return null;
}

export async function payStripeTestCheckout(page: Page, input: {
  email: string;
  name: string;
}) {
  await expect(page).toHaveURL(/checkout\.stripe\.com\/.*cs_test_/, { timeout: 30_000 });
  const email = page.getByLabel(/Email/i);
  if (await email.isEditable().catch(() => false)) await email.fill(input.email);

  const cardNumber = await firstMatching(
    page,
    "#cardNumber, input[name='cardNumber'], input[autocomplete='cc-number']",
  );
  if (cardNumber) {
    await cardNumber.fill("4242424242424242");
    const expiry = await firstMatching(
      page,
      "#cardExpiry, input[name='cardExpiry'], input[autocomplete='cc-exp']",
    );
    if (expiry) await expiry.fill("1234");
    const cvc = await firstMatching(
      page,
      "#cardCvc, input[name='cardCvc'], input[autocomplete='cc-csc']",
    );
    if (cvc) await cvc.fill("123");
    const name = await firstMatching(
      page,
      "input[name='billingName'], input[autocomplete='cc-name']",
    );
    if (name) await name.fill(input.name);
  }

  const pay = page.getByRole("button", { name: /^Pay(?:\s|$)/ });
  if (await pay.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await pay.click({ force: true });
    return;
  }
  const subscribe = page.getByRole("button", { name: "Subscribe", exact: true });
  if (await subscribe.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await subscribe.click({ force: true });
    return;
  }
  await page.locator("button.SubmitButton").click({ force: true, timeout: 10_000 });
}

export async function readEntitlements(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/account/entitlements", { cache: "no-store" });
    return { body: await response.json(), ok: response.ok };
  });
}
