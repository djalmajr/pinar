import { expect, test } from "@playwright/test";
import { openWorkspaceAccountMenu } from "../helpers/ui";

test("local Settings lives in the sidebar account menu instead of the workspace header", async ({ page }) => {
  await page.goto("/app");

  await expect(page.locator("header").getByRole("button", { exact: true, name: "Settings" })).toHaveCount(0);
  await openWorkspaceAccountMenu(page);

  await expect(page.locator('[data-sidebar="footer"]').getByRole("button", { exact: true, name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { exact: true, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { exact: true, name: "Homepage" })).toBeVisible();
  await expect(page.getByRole("menuitem", { exact: true, name: "Sign out" })).toHaveCount(0);
  await page.getByRole("menuitem", { exact: true, name: "Settings" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("General", { exact: true }).first()).toBeVisible();
  // Mutation captured: leaving the settings nav aside on p-3 keeps the extra inset the pin asked to drop.
  await expect(page.getByRole("dialog").locator("aside")).toHaveClass(/p-2/);
});
