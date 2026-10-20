import { expect, test } from "@playwright/test";

test("the local Free session keeps Fair Source sponsorship visible", async ({ page }) => {
  const response = await page.request.get("/api/auth/session");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ session: { kind: "local", plan: "free" } });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Support Fair Source development" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buy Me a Coffee" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sponsor on GitHub" })).toBeVisible();
});

// Since 9b73141 the server's session is authoritative during hydration.
// Real Pro suppression is exercised by cloud/ssr-auth-hydration.e2e.test.ts.
test("a browser-only Pro response cannot replace the local SSR session", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/auth/session", (route) => {
    requests += 1;
    return route.fulfill({ json: { session: {
      email: "e2e_pro@example.com", kind: "account", plan: "pro", userId: "usr_e2e_pro",
    } } });
  });
  const response = await page.goto("/");
  expect(await response?.text()).toContain('data-auth-support-card="fair-source"');
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Português" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Support Fair Source development" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buy Me a Coffee" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sponsor on GitHub" })).toBeVisible();
  expect(requests).toBe(0);
});
