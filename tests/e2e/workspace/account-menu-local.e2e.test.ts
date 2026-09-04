import { expect, test } from "@playwright/test";
import { openWorkspaceAccountMenu } from "../helpers/ui";

test("local workspace uses the Free-style account popover without Sign out", async ({ page }) => {
  await page.goto("/app");
  await openWorkspaceAccountMenu(page);

  await expect(page.getByTestId("account-plan")).toHaveText("Local server");
  await expect(page.getByRole("menu").getByText("Pinar Local", { exact: true })).toBeVisible();
  await expect(page.getByTestId("account-usage")).toHaveCount(0);
  await expect(page.getByRole("menuitem", { exact: true, name: "Upgrade to Pro" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { exact: true, name: "Billing" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { exact: true, name: "Sign out" })).toHaveCount(0);
  await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["Settings", "Homepage"]);

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { exact: true, name: "Homepage" }).click();
  const home = await popupPromise;
  await expect(home).toHaveURL(/\/$/);
});
