import { expect, test, type Page } from "@playwright/test";

const createdAt = "2026-08-18T00:00:00.000Z";

function session(id: string, title: string, url: string, comments: string[]) {
  return {
    createdAt,
    id,
    page: { title, url },
    pins: comments.map((comment, index) => ({
      comment,
      coords: { x: 40 + index * 10, y: 80 + index * 10 },
      number: index + 1,
      type: "point",
    })),
    shotUrl: null,
  };
}

const sessions = [
  session("alpha", "Alpha dashboard", "https://example.test/dashboard", ["align navigation"]),
  session("beta", "Beta checkout", "https://example.test/billing/checkout", ["copy", "spacing", "button state"]),
  session("gamma", "Gamma reports", "https://example.test/reports", [
    "gamma-secret metric",
    "date range",
    "table header",
    "export action",
    "empty state",
    "pagination",
  ]),
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: "ins_search", kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [{
          collections: [{
            createdAt,
            id: "col_search",
            isProtected: true,
            name: "Inbox",
            ownerId: "ins_search",
            parentId: null,
            position: 0,
            projectId: "prj_search",
            sessions,
            updatedAt: createdAt,
          }],
          createdAt,
          icon: "user-round",
          id: "prj_search",
          isProtected: true,
          name: "Personal",
          ownerId: "ins_search",
          position: 0,
          updatedAt: createdAt,
        }],
      },
    },
  }));
});

async function expectOnly(page: Page, title: string) {
  for (const candidate of sessions.map((item) => item.page.title)) {
    const assertion = expect(page.getByRole("heading", { name: candidate }));
    if (candidate === title) await assertion.toBeVisible();
    else await assertion.toHaveCount(0);
  }
}

test("search, pin filters and grid/table views preserve the same session set", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Gamma reports" })).toBeVisible();
  const search = page.getByPlaceholder("Search...");

  await search.fill("Alpha");
  await expectOnly(page, "Alpha dashboard");

  await search.fill("billing/checkout");
  await expectOnly(page, "Beta checkout");

  await search.fill("gamma-secret");
  await expectOnly(page, "Gamma reports");

  await search.clear();
  for (const item of sessions) await expect(page.getByRole("heading", { name: item.page.title })).toBeVisible();

  const pins = page.getByRole("button", { name: /^Pins/ });
  await pins.click();
  await page.getByRole("menuitemcheckbox", { name: "2–5 pins" }).click();
  await expectOnly(page, "Beta checkout");
  await expect(pins).toContainText("1");

  await search.fill("billing");
  await expectOnly(page, "Beta checkout");

  await pins.click();
  const clearFilter = page.getByRole("menuitem", { name: "Clear filter" });
  await clearFilter.focus();
  await page.keyboard.press("Enter");
  await expect(pins).toHaveText("Pins");
  await expectOnly(page, "Beta checkout");

  await search.clear();
  await page.getByRole("button", { name: "Table view" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  for (const item of sessions) await expect(page.getByRole("cell", { name: item.page.title })).toBeVisible();

  await page.getByRole("button", { name: "Grid view" }).click();
  for (const item of sessions) await expect(page.getByRole("heading", { name: item.page.title })).toBeVisible();
  await expect(pins).toHaveText("Pins");
});
