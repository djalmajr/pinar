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
  const gridToolbar = page.getByRole("toolbar");
  await expect(gridToolbar).toHaveCSS("overflow-x", "visible");
  await expect(gridToolbar).toHaveCSS("overflow-y", "visible");

  const card = page.locator('[data-slot="card"]').filter({ hasText: "Lowcode Studio" }).first();
  await expect(card.getByText("Inbox", { exact: true })).toBeVisible();
  const selection = card.locator("[data-grid-selection]");
  const preview = card.getByRole("button", { name: "View capture" });
  const selectionBox = await selection.boundingBox();
  const previewBox = await preview.boundingBox();
  expect(selectionBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(selectionBox?.x ?? Infinity).toBeLessThan((previewBox?.x ?? 0) + 40);
  expect(selectionBox?.y ?? Infinity).toBeLessThan((previewBox?.y ?? 0) + 40);

  await preview.click();
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

  await page.locator('[data-sidebar="menu-button"]').filter({ hasText: "Inbox" }).click();
  await expect(card.getByText("Inbox", { exact: true })).toHaveCount(0);
});

test("table view puts the mini-preview in the first column and opens the viewer", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("tab", { name: "Table view" }).click();
  const table = page.getByRole("table");
  const tableToolbar = page.getByRole("toolbar");
  await expect(tableToolbar).toHaveCSS("overflow-x", "visible");
  await expect(tableToolbar).toHaveCSS("overflow-y", "visible");
  await expect(table).toBeVisible();
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  const columnsMenu = page.getByRole("menu");
  await expect(columnsMenu.getByText("Columns", { exact: true })).toHaveCount(0);
  await expect(columnsMenu.getByRole("menuitemcheckbox", { name: "Review" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(table.getByRole("columnheader", { name: "Drag" })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "Preview" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Session" })).toBeVisible();
  const reviewHeaderBox = await table.getByRole("columnheader", { exact: true, name: "Review" }).boundingBox();
  const pinsHeaderBox = await table.getByRole("columnheader", { exact: true, name: "Pins" }).boundingBox();
  const createdHeaderBox = await table.getByRole("columnheader", { exact: true, name: "Created" }).boundingBox();
  expect(reviewHeaderBox).not.toBeNull();
  expect(pinsHeaderBox).not.toBeNull();
  expect(createdHeaderBox).not.toBeNull();
  expect(reviewHeaderBox!.x).toBeLessThan(pinsHeaderBox!.x);
  expect(pinsHeaderBox!.x).toBeLessThan(createdHeaderBox!.x);
  expect(reviewHeaderBox!.width).toBeLessThan(createdHeaderBox!.width);
  const firstRow = table.locator("tbody tr").first();
  const copyButtonBox = await firstRow.getByRole("button", { name: "Copy prompt" }).boundingBox();
  const actionsButtonBox = await firstRow.getByRole("button", { name: "More session actions" }).boundingBox();
  expect(copyButtonBox).not.toBeNull();
  expect(actionsButtonBox).not.toBeNull();
  expect(copyButtonBox!.width).toBe(28);
  expect(copyButtonBox!.height).toBe(28);
  expect(actionsButtonBox!.width).toBe(28);
  expect(actionsButtonBox!.height).toBe(28);
  const previewCell = table.locator("tbody tr").first().locator("td").nth(1);
  const thumb = previewCell.locator("img");
  await expect(thumb).toBeVisible();
  const cellBox = await previewCell.boundingBox();
  const thumbBox = await thumb.boundingBox();
  expect(cellBox).not.toBeNull();
  expect(thumbBox).not.toBeNull();
  expect(cellBox?.width ?? Infinity).toBeLessThan((thumbBox?.width ?? 0) + 32);
  const sessionCell = table.locator("tbody tr").first().locator("td").nth(2);
  const title = sessionCell.getByText("Lowcode Studio", { exact: true });
  await expect(title).toBeVisible();
  await expect(title).toHaveCSS("text-overflow", "ellipsis");
  await expect(sessionCell.getByRole("link", { name: "Lowcode Studio" })).toHaveCount(0);
  await expect(sessionCell.getByText("Inbox", { exact: true })).toBeVisible();
  const sessionCellBox = await sessionCell.boundingBox();
  const titleBox = await title.boundingBox();
  const collectionBox = await sessionCell.getByText("Inbox", { exact: true }).boundingBox();
  expect(sessionCellBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(collectionBox).not.toBeNull();
  expect(titleBox?.width ?? Infinity).toBeLessThan(sessionCellBox?.width ?? 0);
  expect(collectionBox?.x ?? 0).toBeGreaterThan(titleBox?.x ?? Infinity);
  expect(Math.abs((collectionBox?.y ?? 0) - (titleBox?.y ?? 0))).toBeLessThan(4);
  const urlLinkBox = await sessionCell.getByRole("link", { name: session.page.url }).boundingBox();
  expect(urlLinkBox).not.toBeNull();
  expect(urlLinkBox?.y ?? 0).toBeGreaterThan(titleBox?.y ?? Infinity);
  await expect(sessionCell.getByText("Project API keys for Lowcode Studio.")).toBeVisible();
  await expect(sessionCell.getByRole("link", { name: session.page.url })).toBeVisible();
  expect(await table.locator("tbody tr").first().evaluate((row) => getComputedStyle(row).cursor)).toBe("auto");
  await title.click();
  await expect(page.getByRole("dialog", { name: "Lowcode Studio" })).toHaveCount(0);
  await expect(page.locator("[data-table-scroll-container]")).toHaveCSS("overflow-y", "hidden");
  await thumb.click();
  const dialog = page.getByRole("dialog", { name: "Lowcode Studio" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Lowcode Studio" })).toBeVisible();
  await expect(dialog.getByText("Project API keys for Lowcode Studio.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: session.page.url })).toBeVisible();
  await expect(page).toHaveURL(/\/app\?session=preview-e2e/);
});
