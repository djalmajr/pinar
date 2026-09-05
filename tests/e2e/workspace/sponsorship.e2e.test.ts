import { expect, test } from "@playwright/test";

interface SessionFixture {
  email?: string;
  installationId?: string;
  kind: "account" | "installation";
  plan: "founder" | "free" | "pro";
  userId?: string;
}

test("Free installation keeps Fair Source sponsorship visible", async ({ page }) => {
  const session: SessionFixture = {
    installationId: "ins_e2e_free",
    kind: "installation",
    plan: "free",
  };
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { session } }));

  await page.goto("/");

  await expect(page.getByRole("region", { name: "Support Fair Source development" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buy Me a Coffee" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sponsor on GitHub" })).toBeVisible();
});

// Mutation captured: rendering the support section after `isPaidAuthSession`
// makes both paid cases fail because the region count changes from zero to one.
for (const plan of ["pro", "founder"] as const) {
  test(`paid ${plan} account does not see Fair Source sponsorship`, async ({ page }) => {
    const session: SessionFixture = {
      email: `e2e_${plan}@example.com`,
      kind: "account",
      plan,
      userId: `usr_e2e_${plan}`,
    };
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: { session } }));

    await page.goto("/");

    await expect(page.getByRole("region", { name: /Fair Source development|Thank/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Buy Me a Coffee" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sponsor on GitHub" })).toHaveCount(0);
  });
}
