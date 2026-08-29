import { expect, test } from "@playwright/test";

// Mutation captured: restoring larger primary-colored icons makes the measured
// title-size and inherited title-color assertions fail.
test("landing card icons inherit their title color and remain compact", async ({ page }) => {
  await page.goto("/");

  for (const title of [
    "Pin what matters",
    "Preserve the context",
    "Hand it to AI",
    "Private by default",
  ]) {
    const heading = page.getByRole("heading", { name: title, exact: true });
    const row = heading.locator("xpath=..");
    const metrics = await row.evaluate((element) => {
      const iconElement = element.querySelector("svg");
      const titleElement = element.querySelector("h3");
      if (!iconElement || !titleElement) throw new Error("Card icon or title is missing");
      const iconBox = iconElement.getBoundingClientRect();
      const titleBox = titleElement.getBoundingClientRect();
      return {
        colorMatches: getComputedStyle(iconElement).color === getComputedStyle(titleElement).color,
        iconHeight: iconBox.height,
        sameLine: Math.abs((iconBox.top + iconBox.bottom) / 2 - (titleBox.top + titleBox.bottom) / 2) < 1,
        titleFontSize: Number.parseFloat(getComputedStyle(titleElement).fontSize),
      };
    });

    expect(metrics.colorMatches).toBe(true);
    expect(metrics.sameLine).toBe(true);
    expect(metrics.iconHeight).toBe(metrics.titleFontSize);
  }
});

// Mutation captured: linking the primary public CTA directly to `/app`
// bypasses the explicit sign-in step and makes this routing assertion fail.
test("public landing keeps local workspace access without a sign-in detour", async ({ page }) => {
  await page.goto("/");

  const main = page.getByRole("main");
  const localDashboard = main.getByRole("link", { name: "Open local dashboard", exact: true });
  await expect(main.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
  await expect(localDashboard).toHaveAttribute("href", "/app");

  await localDashboard.click();
  await expect(page).toHaveURL(/\/app/);
});
