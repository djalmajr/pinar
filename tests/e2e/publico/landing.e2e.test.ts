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
    "Share when you need to",
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
test("public landing routes dashboard intent through sign-in and keeps local access explicit", async ({ page }) => {
  await page.goto("/");

  const main = page.getByRole("main");
  const signIn = main.getByRole("link", { name: "Sign in", exact: true });
  const localDashboard = main.getByRole("link", { name: "Open local dashboard", exact: true });
  await expect(signIn).toHaveAttribute("href", "/sign-in?extensionCode=&returnTo=%2Fapp");
  await expect(localDashboard).toHaveAttribute("href", "/app");

  await signIn.click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/app");
});
