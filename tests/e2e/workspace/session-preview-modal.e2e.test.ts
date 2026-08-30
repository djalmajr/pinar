import { expect, test } from "@playwright/test";

const createdAt = "2026-08-14T14:52:00.000Z";
const pinComment = "Rotate this API key field.";
const session = {
  createdAt,
  id: "preview-e2e",
  page: {
    description: "Project API keys for Lowcode Studio.",
    title: "Lowcode Studio",
    url: "http://localhost:4000/projects/6m7SsmX4WYZb/settings/api-keys",
  },
  pins: [
    {
      comment: pinComment,
      coords: { x: 24, y: 48 },
      number: 1,
      tag: "input",
      type: "point",
    },
  ],
  shotId: "preview-e2e",
  shotUrl: "/shots/preview-e2e.svg",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: "ins_preview", kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [{
          collections: [{
            createdAt,
            id: "col_preview",
            isProtected: true,
            name: "Inbox",
            ownerId: "ins_preview",
            parentId: null,
            position: 0,
            projectId: "prj_preview",
            sessions: [session],
            updatedAt: createdAt,
          }],
          createdAt,
          icon: "user-round",
          id: "prj_preview",
          isProtected: true,
          name: "Personal",
          ownerId: "ins_preview",
          position: 0,
          updatedAt: createdAt,
        }],
      },
    },
  }));
  await page.route("**/api/sessions/preview-e2e", (route) => route.fulfill({
    json: { session },
  }));
  await page.route("**/shots/preview-e2e.svg", (route) => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><text x="20" y="40">API keys</text></svg>',
    contentType: "image/svg+xml",
  }));
});

test("grid capture opens the zoom viewer modal without leaving the dashboard", async ({ page }) => {
  await page.context().route("http://localhost:4000/**", (route) => route.fulfill({
    body: "<title>API keys</title>",
    contentType: "text/html",
  }));
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Lowcode Studio" })).toBeVisible();

  await page.getByRole("button", { name: "View capture" }).click();
  const dialog = page.getByRole("dialog", { name: "Lowcode Studio" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Lowcode Studio" })).toBeVisible();
  await expect(dialog.getByText("Project API keys for Lowcode Studio.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: session.page.url })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Annotated page screenshot" })).toBeVisible();
  await expect(dialog.getByText("100%", { exact: true })).toBeVisible();
  await expect(dialog.getByText(pinComment)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Review on page" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy Page" })).toBeVisible();
  await expect(page).toHaveURL(/\/app\?session=preview-e2e/);

  const originalPage = dialog.getByRole("link", { name: session.page.url });
  await expect(originalPage).toHaveAttribute("target", "_blank");
  const popupPromise = page.waitForEvent("popup");
  await originalPage.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/localhost:4000\/projects\/6m7SsmX4WYZb\/settings\/api-keys/);
  await popup.close();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/?$/);
});

test("table view puts the mini-preview in the first column and opens the viewer", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "Table view" }).click();
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Preview" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Session" })).toBeVisible();
  const preview = table.locator("tbody tr").first().locator("td").nth(1);
  const thumb = preview.locator("img");
  await expect(thumb).toBeVisible();
  const cellBox = await preview.boundingBox();
  const thumbBox = await thumb.boundingBox();
  expect(cellBox).not.toBeNull();
  expect(thumbBox).not.toBeNull();
  expect(cellBox?.width ?? Infinity).toBeLessThan((thumbBox?.width ?? 0) + 32);
  await expect(table.getByRole("link", { name: "Lowcode Studio" })).toHaveAttribute(
    "href",
    "/app?session=preview-e2e",
  );
  const sessionCell = table.locator("tbody tr").first().locator("td").nth(2);
  await expect(sessionCell.getByRole("link", { name: "Lowcode Studio" })).toBeVisible();
  await expect(sessionCell.getByText("Project API keys for Lowcode Studio.")).toBeVisible();
  await expect(sessionCell.getByRole("link", { name: session.page.url })).toBeVisible();
  await table.locator("tbody tr").first().evaluate((row) => {
    (row as HTMLTableRowElement).click();
  });
  const dialog = page.getByRole("dialog", { name: "Lowcode Studio" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Lowcode Studio" })).toBeVisible();
  await expect(dialog.getByText("Project API keys for Lowcode Studio.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: session.page.url })).toBeVisible();
  await expect(page).toHaveURL(/\/app\?session=preview-e2e/);
});
