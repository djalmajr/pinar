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

// Mutation captured: removing the refill rendering hides the Pro subscription
// detail while leaving the Billing action available.
test("Pro account menu shows credit refill and expiry dates alongside Billing", async ({ page }) => {
  await page.route("**/api/stripe/portal", (route) => route.fulfill({
    json: { url: "/pricing?from=billing" },
  }));
  await page.route("**/api/account/entitlements", (route) => route.fulfill({
    json: {
      aiCredits: {
        balance: 200,
        nextExpiryAt: "2026-09-18T00:00:00.000Z",
        nextRefillAt: "2026-09-30T00:00:00.000Z",
      },
      ok: true,
      plan: "pro",
      storage: {
        nextExpiryAt: "2026-10-01T00:00:00.000Z",
        quotaBytes: 10 * 1024 ** 3,
        usedBytes: 128 * 1024 ** 2,
      },
    },
  }));
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      session: {
        email: "djalmajr@example.test",
        kind: "account",
        plan: "pro",
        userId: "usr_account_menu_pro",
      },
    },
  }));

  await page.goto("/app");

  await openAccountMenu(page);
  await expect(page.locator("header").getByRole("button", { exact: true, name: "Account menu" })).toHaveCount(0);
  await expect(page.getByRole("menu").getByText("djalmajr@example.test", { exact: true })).toBeVisible();
  const usage = page.getByTestId("account-usage");
  const credits = usage.getByTestId("account-credits");
  const storage = usage.getByTestId("account-storage");
  await expect(page.getByTestId("account-plan")).toHaveText("Pinar Pro");
  await expect(usage.getByText("Pinar Pro", { exact: true })).toHaveCount(0);
  await expect(credits.getByText("200 available", { exact: true })).toBeVisible();
  await expect(credits.getByText("Some credits expire Sep 18, 2026", { exact: true })).toBeVisible();
  await expect(credits.getByText("Monthly refill on Sep 30, 2026", { exact: true })).toBeVisible();
  await expect(storage.getByText("128 MB used of 10 GB", { exact: true })).toBeVisible();
  await expect(storage.getByText("Storage add-on expires Oct 1, 2026", { exact: true })).toBeVisible();
  await expect(storage.getByRole("progressbar", { name: "Storage" })).toHaveAttribute("aria-valuenow", String(128 * 1024 ** 2));
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
      aiCredits: { balance: 5, nextExpiryAt: null, nextRefillAt: null },
      ok: true,
      plan: "free",
      storage: { nextExpiryAt: null, quotaBytes: 250 * 1024 ** 2, usedBytes: 0 },
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
  await expect(page.getByTestId("account-credits").getByText("5 available", { exact: true })).toBeVisible();
  await expect(page.getByTestId("account-storage").getByText("0 B used of 250 MB", { exact: true })).toBeVisible();
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
