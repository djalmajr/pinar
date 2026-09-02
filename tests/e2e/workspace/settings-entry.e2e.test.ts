import { expect, test } from "@playwright/test";
import { openWorkspaceSidebar } from "../helpers/ui";

test("local Settings lives in the sidebar footer instead of the workspace header", async ({ page }) => {
  await page.goto("/app");

  await expect(page.locator("header").getByRole("button", { exact: true, name: "Settings" })).toHaveCount(0);
  await openWorkspaceSidebar(page, "Settings");

  const settings = page.locator('[data-sidebar="footer"]')
    .getByRole("button", { exact: true, name: "Settings" });
  await expect(settings).toBeVisible();
  await settings.click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("General", { exact: true }).first()).toBeVisible();
  // Mutation captured: leaving the settings nav aside on p-3 keeps the extra inset the pin asked to drop.
  await expect(page.getByRole("dialog").locator("aside")).toHaveClass(/p-2/);
});
