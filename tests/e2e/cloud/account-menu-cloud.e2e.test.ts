import { expect, type Page, test } from "@playwright/test";

async function openAccountMenu(page: Page) {
  const accountMenu = page.locator('[data-sidebar="footer"]')
    .getByRole("button", { exact: true, name: "Account menu" });
  await expect(accountMenu).toBeVisible();
  await accountMenu.click();
}

// Mutation captured: replacing the cloud API with the local-only adapter redirects this flow away from the paid workspace.
test("isolated Cloudflare runtime renders Pro entitlements and manages shared sessions", async ({ page }) => {
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
    aiCredits: { balance: 500, nextRefillAt: null },
    plan: "pro",
    storage: {
      quotaBytes: 2 * 1024 ** 3,
      usedBytes: 128 * 1024 ** 2,
    },
  });
  expect(contracts.entitlements.aiCredits.nextExpiryAt).toEqual(expect.any(String));

  await openAccountMenu(page);
  await expect(page.getByTestId("account-plan")).toHaveText("Pinar Pro");
  await expect(page.getByRole("menu").getByText("pro.cloud-local@pinar.test", { exact: true })).toBeVisible();
  await expect(page.getByTestId("account-credits").getByText("500 available", { exact: true })).toBeVisible();
  await expect(page.getByTestId("account-credits").getByText(/Monthly refill on/)).toHaveCount(0);
  await expect(page.getByTestId("account-credits").getByText(/Some credits expire/)).toBeVisible();
  await expect(page.getByTestId("account-storage").getByText("128 MB used of 2 GB", { exact: true })).toBeVisible();
  await expect(page.getByTestId("account-usage").getByText("Pinar Pro", { exact: true })).toHaveCount(0);
  await expect(page.locator("header").getByRole("button", { exact: true, name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { exact: true, name: "Billing" })).toBeVisible();
  await expect(page.getByRole("menuitem", { exact: true, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["Billing", "Settings", "Homepage", "Sign out"]);
  await page.getByRole("menuitem", { exact: true, name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  const publishStatus = await page.evaluate(async () => {
    const response = await fetch("/api/shares/publish", {
      body: JSON.stringify({
        resourceId: "session_cloud_local_pro",
        resourceType: "session",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.status;
  });
  expect(publishStatus).toBe(201);
  await page.reload();

  const sharedFilter = page.locator('[data-sidebar="menu-button"]')
    .filter({ hasText: "Shared" });
  await expect(sharedFilter).toBeVisible();
  await expect(sharedFilter.locator("xpath=..").getByText("1", { exact: true })).toBeVisible();
  await sharedFilter.click();
  await expect(page.getByRole("heading", { name: "Cloud runtime fixture" })).toBeVisible();

  let releaseViewer = () => {};
  const viewerResponse = new Promise<void>((resolve) => {
    releaseViewer = resolve;
  });
  await page.route("**/api/sessions/session_cloud_local_pro", async (route) => {
    await viewerResponse;
    await route.continue();
  });
  await page.goto("/app?session=session_cloud_local_pro");
  const loadingDialog = page.getByRole("dialog", { name: /Loading viewer/ });
  await expect(loadingDialog.getByRole("button", { name: "Copy link" })).toBeDisabled();
  await expect(loadingDialog.getByRole("button", { name: "Revoke" })).toBeDisabled();
  await expect(loadingDialog.getByRole("button", { name: "Close" })).toBeEnabled();
  releaseViewer();
  const dialog = page.getByRole("dialog", { name: "Cloud runtime fixture" });
  await expect(dialog.getByText("Published", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Copy link" })).toBeVisible();
  await dialog.getByRole("button", { name: "Revoke" }).click();

  await expect(dialog.getByRole("button", { name: "Publish" })).toBeVisible();
  await expect(sharedFilter.locator("xpath=..").getByText("0", { exact: true })).toBeVisible();
});
