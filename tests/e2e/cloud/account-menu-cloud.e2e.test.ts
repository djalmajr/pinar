import { expect, type Page, test } from "@playwright/test";

async function openAccountMenu(page: Page) {
  const accountMenu = page.locator('[data-sidebar="footer"]')
    .getByRole("button", { exact: true, name: "Account menu" });
  await expect(accountMenu).toBeVisible();
  await accountMenu.click();
}

// Mutation captured: replacing the cloud API with the local-only adapter redirects this flow away from the paid workspace.
test("isolated Cloudflare runtime authenticates the seeded Pro account and renders real entitlements", async ({ page }) => {
  await page.goto("/sign-in?extensionCode=PRCLD826&returnTo=%2Fapp");
  await expect(page).toHaveURL(/\/app$/);

  const contracts = await page.evaluate(async () => {
    const [health, session, entitlements] = await Promise.all([
      fetch("/api/health").then((response) => response.json()),
      fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/account/entitlements", { cache: "no-store" }).then((response) => response.json()),
    ]);
    return { entitlements, health, session };
  });
  expect(contracts.health).toMatchObject({ runtime: "cloud", service: "pinar" });
  expect(contracts.session).toMatchObject({
    session: {
      email: "pro.cloud-local@pinar.test",
      kind: "account",
      plan: "pro",
    },
  });
  expect(contracts.entitlements).toMatchObject({
    aiCredits: { balance: 200 },
    plan: "pro",
    storage: {
      quotaBytes: 5 * 1024 ** 3,
      usedBytes: 128 * 1024 ** 2,
    },
  });
  expect(contracts.entitlements.aiCredits.nextRefillAt).toEqual(expect.any(String));
  expect(contracts.entitlements.aiCredits.nextExpiryAt).toEqual(expect.any(String));

  await openAccountMenu(page);
  await expect(page.getByTestId("account-plan")).toHaveText("Pinar Pro");
  await expect(page.getByRole("menu").getByText("pro.cloud-local@pinar.test", { exact: true })).toBeVisible();
  await expect(page.getByTestId("account-credits").getByText("200 available", { exact: true })).toBeVisible();
  await expect(page.getByTestId("account-credits").getByText(/Monthly refill on/)).toBeVisible();
  await expect(page.getByTestId("account-credits").getByText(/Some credits expire/)).toBeVisible();
  await expect(page.getByTestId("account-storage").getByText("128 MB used of 5 GB", { exact: true })).toBeVisible();
  await expect(page.getByTestId("account-usage").getByText("Pinar Pro", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { exact: true, name: "Billing" })).toBeVisible();
});
