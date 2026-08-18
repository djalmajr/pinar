import { expect, type Page, test } from "@playwright/test";

async function openAccountMenu(page: Page) {
  const accountMenu = page.locator('[data-sidebar="footer"]')
    .getByRole("button", { exact: true, name: "Account menu" });

  for (let attempt = 0; attempt < 3 && !(await accountMenu.isVisible()); attempt += 1) {
    const collections = page.getByRole("button", { exact: true, name: "Collections" });
    await expect(collections).toBeVisible();
    await collections.click();
    await accountMenu.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
  }

  await expect(accountMenu).toBeVisible();
  await accountMenu.click();
}

// Mutation captured: rendering AppAccountMenu in AppHeader removes it from
// SidebarFooter; dropping the entitlement fetch also removes the three usage
// assertions below.
test("Founder account menu shows the purchased plan, credit balance and storage quota", async ({ page }) => {
  await page.route("**/api/stripe/portal", (route) => route.fulfill({
    json: { url: "/pricing?from=billing" },
  }));
  await page.route("**/api/account/entitlements", (route) => route.fulfill({
    json: {
      aiCredits: { balance: 700, nextExpiryAt: "2026-09-18T00:00:00.000Z" },
      ok: true,
      plan: "founder",
      storage: { quotaBytes: 5 * 1024 ** 3, usedBytes: 512 * 1024 ** 2 },
    },
  }));
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      session: {
        email: "djalmajr@example.test",
        kind: "account",
        plan: "founder",
        userId: "usr_account_menu_founder",
      },
    },
  }));

  await page.goto("/app");

  await openAccountMenu(page);
  await expect(page.locator("header").getByRole("button", { exact: true, name: "Account menu" })).toHaveCount(0);
  await expect(page.getByRole("menu").getByText("djalmajr@example.test", { exact: true })).toBeVisible();
  const usage = page.getByTestId("account-usage");
  await expect(usage.getByText("Pinar Founder", { exact: true })).toBeVisible();
  await expect(usage.getByText("700 available", { exact: true })).toBeVisible();
  await expect(usage.getByText("Some credits expire Sep 18, 2026", { exact: true })).toBeVisible();
  await expect(usage.getByText("512 MB of 5 GB", { exact: true })).toBeVisible();
  await expect(usage.getByRole("progressbar", { name: "Storage" })).toHaveAttribute("aria-valuenow", String(512 * 1024 ** 2));
  await expect(page.getByRole("menuitem", { exact: true, name: "Billing" })).toBeVisible();
  await expect(page.getByRole("menuitem", { exact: true, name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("menuitem", { exact: true, name: "Upgrade to Pro" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { exact: true, name: "Account" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { exact: true, name: "Notifications" })).toHaveCount(0);

  const portalRequest = page.waitForRequest("**/api/stripe/portal");
  await page.getByRole("menuitem", { exact: true, name: "Billing" }).click();
  await expect.poll(async () => (await portalRequest).method()).toBe("POST");
  await expect(page).toHaveURL(/\/pricing\?from=billing$/);
});

test("Free installation offers upgrade from the same sidebar user panel", async ({ page }) => {
  await page.route("**/api/account/entitlements", (route) => route.fulfill({
    json: {
      aiCredits: { balance: 5, nextExpiryAt: null },
      ok: true,
      plan: "free",
      storage: { quotaBytes: 250 * 1024 ** 2, usedBytes: 0 },
    },
  }));
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      session: {
        installationId: "ins_account_menu_free",
        kind: "installation",
        plan: "free",
      },
    },
  }));

  await page.goto("/app");

  await openAccountMenu(page);
  await expect(page.getByTestId("account-usage").getByText("5 available", { exact: true })).toBeVisible();
  await expect(page.getByTestId("account-usage").getByText("0 B of 250 MB", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { exact: true, name: "Upgrade to Pro" })).toBeVisible();
  await expect(page.getByRole("menuitem", { exact: true, name: "Billing" })).toHaveCount(0);
  await page.getByRole("menuitem", { exact: true, name: "Upgrade to Pro" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});

test("Sign out revokes the web session from the sidebar panel", async ({ page }) => {
  await page.route("**/api/auth/logout", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      session: {
        email: "djalmajr@example.test",
        kind: "account",
        plan: "lifetime",
        userId: "usr_account_menu_logout",
      },
    },
  }));

  await page.goto("/app");
  await openAccountMenu(page);

  const logoutRequest = page.waitForRequest("**/api/auth/logout");
  await page.getByRole("menuitem", { exact: true, name: "Sign out" }).click();
  await expect.poll(async () => (await logoutRequest).method()).toBe("POST");
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
});
