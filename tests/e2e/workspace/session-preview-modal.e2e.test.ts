import { expect, test, type Locator, type Page } from "@playwright/test";
import { isMobileViewport, openWorkspaceSidebar } from "../helpers/ui";

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

function siblingSession(id: string, title: string, createdAtValue: string) {
  return {
    ...session,
    createdAt: createdAtValue,
    id,
    page: {
      ...session.page,
      title,
      url: `http://localhost:4000/${id}`,
    },
    pins: [{ ...session.pins[0], comment: `${title} feedback.` }],
    shotId: id,
    shotUrl: `/shots/${id}.svg`,
  };
}

const inboxSibling = siblingSession("preview-inbox-two", "Inbox second capture", "2026-08-14T14:51:00.000Z");
const collectionFirst = siblingSession("preview-collection-one", "Collection first capture", "2026-08-14T14:50:00.000Z");
const collectionSecond = siblingSession("preview-collection-two", "Collection second capture", "2026-08-14T14:49:00.000Z");
const previewSessions = [session, inboxSibling, collectionFirst, collectionSecond];

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
            sessions: [session, inboxSibling],
            updatedAt: createdAt,
          }, {
            createdAt,
            id: "col_preview_collection",
            isProtected: false,
            name: "Research",
            ownerId: "ins_preview",
            parentId: null,
            position: 1,
            projectId: "prj_preview",
            sessions: [collectionFirst, collectionSecond],
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
  for (const previewSession of previewSessions) {
    await page.route(`**/api/sessions/${previewSession.id}`, (route) => route.fulfill({
      json: { session: previewSession },
    }));
    await page.route(`**/shots/${previewSession.id}.svg`, (route) => route.fulfill({
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><text x="20" y="40">${previewSession.page.title}</text></svg>`,
      contentType: "image/svg+xml",
    }));
  }
});

async function controlBox(control: Locator) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function expectSameBox(
  before: { x: number; y: number; width: number; height: number },
  after: { x: number; y: number; width: number; height: number },
) {
  expect(Math.abs(before.x - after.x)).toBeLessThan(1);
  expect(Math.abs(before.y - after.y)).toBeLessThan(1);
  expect(Math.abs(before.width - after.width)).toBeLessThan(1);
  expect(Math.abs(before.height - after.height)).toBeLessThan(1);
}

async function openPreview(page: Page, title: string) {
  const card = page.locator('[data-slot="card"]').filter({ hasText: title }).first();
  await card.getByRole("button", { name: "View capture" }).click();
  return page.getByRole("dialog", { name: title });
}

// Mutation captured: replacing the viewer loading shell with centered text removes
// its skeleton structure and the controls needed to navigate or close the modal.
test("loading viewer preserves its structure and available header controls", async ({ page }) => {
  let releaseFirstLoad = () => {};
  const firstLoad = new Promise<void>((resolve) => {
    releaseFirstLoad = resolve;
  });
  await page.route("**/api/sessions/preview-e2e", async (route) => {
    await firstLoad;
    await route.fulfill({ json: { session } });
  });
  await page.goto("/app");

  const card = page.locator('[data-slot="card"]').filter({ hasText: "Lowcode Studio" }).first();
  await card.getByRole("button", { name: "View capture" }).click();

  const loadingDialog = page.getByRole("dialog", { name: /Loading viewer/ });
  await expect(loadingDialog).toBeVisible();
  await expect(loadingDialog.locator("[data-viewer-loading-stage] [data-slot='skeleton']")).toBeVisible();
  await expect(loadingDialog.locator("[data-viewer-loading-sidebar]")).toBeVisible();
  await expect(loadingDialog.getByRole("status")).toHaveText("1 of 4");
  await expect(loadingDialog.getByRole("button", { name: "Previous capture" })).toBeDisabled();
  await expect(loadingDialog.getByRole("button", { name: "Next capture" })).toBeEnabled();
  await expect(loadingDialog.getByRole("button", { exact: true, name: "Copy prompt" })).toBeDisabled();
  await expect(loadingDialog.getByRole("button", { name: "More page actions" })).toBeDisabled();
  await expect(loadingDialog.getByRole("button", { name: "Close" })).toBeEnabled();

  await loadingDialog.getByRole("button", { name: "Next capture" }).click();
  await expect(page).toHaveURL(/session=preview-inbox-two/);
  await expect(page.getByRole("dialog", { name: "Inbox second capture" })).toBeVisible();

  const staleResponse = page.waitForResponse(/\/api\/sessions\/preview-e2e$/);
  releaseFirstLoad();
  await staleResponse;
  await expect(page.getByRole("dialog", { name: "Inbox second capture" })).toBeVisible();
});

test("preview navigation follows All sessions, Inbox and collection contexts", async ({ page }) => {
  await page.goto("/app");

  let dialog = await openPreview(page, "Lowcode Studio");
  await expect(dialog.getByRole("status")).toHaveText("1 of 4");
  await dialog.getByRole("button", { name: "Next capture" }).click();
  await expect(page).toHaveURL(/session=preview-inbox-two/);
  await expect(page.getByRole("dialog", { name: "Inbox second capture" })).toBeVisible();
  await page.keyboard.press("Escape");

  if (isMobileViewport(page)) await openWorkspaceSidebar(page, "Inbox");
  await page.locator('[data-sidebar="menu-button"]').filter({ hasText: "Inbox" }).click();
  dialog = await openPreview(page, "Lowcode Studio");
  await expect(dialog.getByRole("status")).toHaveText("1 of 2");
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/session=preview-inbox-two/);
  await page.keyboard.press("Escape");

  if (isMobileViewport(page)) await openWorkspaceSidebar(page, "Research");
  await page.locator('[data-sidebar="menu-button"]').filter({ hasText: "Research" }).click();
  dialog = await openPreview(page, "Collection first capture");
  await expect(dialog.getByRole("status")).toHaveText("1 of 2");
  await dialog.getByRole("button", { name: "Next capture" }).click();
  await expect(page).toHaveURL(/session=preview-collection-two/);
  await expect(page.getByRole("dialog", { name: "Collection second capture" })).toBeVisible();
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

  await card.getByRole("button", { name: "More session actions" }).click();
  const actions = page.getByRole("menu");
  await expect(actions.getByRole("menuitem", { exact: true, name: "View" })).toHaveCount(0);
  await expect(actions.getByRole("menuitem", { exact: true, name: "Copy prompt" })).toHaveCount(0);
  await expect(actions.getByRole("menuitem", { name: "Open prompt *.md" })).toBeVisible();
  await actions.press("Escape");
  await expect(actions).toBeHidden();

  await preview.click();
  const dialog = page.getByRole("dialog", { name: "Lowcode Studio" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Lowcode Studio" })).toBeVisible();
  await expect(dialog.getByText("Project API keys for Lowcode Studio.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: session.page.url })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Annotated page screenshot" })).toBeVisible();
  await expect(dialog.getByText("100%", { exact: true })).toBeVisible();
  await expect(dialog.getByText(pinComment)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Review on page" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { exact: true, name: "Copy prompt" })).toBeVisible();
  await dialog.getByRole("button", { name: "More page actions" }).click();
  const pageMenu = page.getByRole("menu");
  await expect(pageMenu.getByRole("menuitem", { exact: true, name: "Copy prompt" })).toHaveCount(0);
  await expect(pageMenu.getByRole("menuitem", { name: "Open prompt *.md" })).toBeVisible();
  await dialog.getByRole("button", { name: "More page actions" }).click();
  await expect(pageMenu).toBeHidden();
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

  if (isMobileViewport(page)) await openWorkspaceSidebar(page, "Inbox");
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
  const copyButtonBox = await firstRow.getByRole("button", { exact: true, name: "Copy prompt" }).boundingBox();
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

test("modal viewer prepares a batch prompt once and shows the wait before it is copied", async ({ page }) => {
  const batchSession = { ...session, batchId: "batch-preview" };
  await page.route("**/api/sessions/preview-e2e", (route) => route.fulfill({
    json: { session: batchSession },
  }));
  let markdownRequests = 0;
  let releaseMarkdown = () => {};
  const markdownGate = new Promise<void>((resolve) => {
    releaseMarkdown = resolve;
  });
  await page.route("**/api/batches/batch-preview/markdown", async (route) => {
    markdownRequests += 1;
    await markdownGate;
    await route.fulfill({
      body: "# Aggregated prompt\n\nRotate this API key field.",
      contentType: "text/markdown; charset=utf-8",
    });
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/app");

  const dialog = await openPreview(page, "Lowcode Studio");
  await expect.poll(() => markdownRequests).toBe(1);
  await dialog.getByRole("button", { name: "More page actions" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { exact: true, name: "Copy prompt" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Open prompt *.md" })).toBeVisible();
  await dialog.getByRole("button", { name: "More page actions" }).click();
  await expect(menu).toBeHidden();

  const pageActions = dialog.getByRole("group", { name: "Page actions" });
  const moreActions = pageActions.getByRole("button", { name: "More page actions" });
  const closeViewer = pageActions.locator("xpath=..").getByRole("button", { exact: true, name: "Close" });
  const before = {
    actions: await controlBox(pageActions),
    close: await controlBox(closeViewer),
    more: await controlBox(moreActions),
  };
  await dialog.getByRole("button", { exact: true, name: "Copy prompt" }).click();
  const preparing = dialog.getByRole("button", { exact: true, name: "Preparing prompt…" });
  await expect(preparing).toBeDisabled();
  const during = {
    actions: await controlBox(pageActions),
    close: await controlBox(closeViewer),
    more: await controlBox(moreActions),
  };
  expect(markdownRequests).toBe(1);
  releaseMarkdown();
  const copied = dialog.getByRole("button", { exact: true, name: "Copied" });
  await expect(copied).toBeEnabled();
  const after = {
    actions: await controlBox(pageActions),
    close: await controlBox(closeViewer),
    more: await controlBox(moreActions),
  };
  expectSameBox(before.actions, during.actions);
  expectSameBox(during.actions, after.actions);
  expectSameBox(before.more, during.more);
  expectSameBox(during.more, after.more);
  expectSameBox(before.close, during.close);
  expectSameBox(during.close, after.close);
  expect(markdownRequests).toBe(1);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Aggregated prompt");
});

test("a failed batch copy shows the error and retries without saying copied", async ({ page }) => {
  const batchSession = { ...session, batchId: "batch-preview-fail" };
  await page.route("**/api/sessions/preview-e2e", (route) => route.fulfill({
    json: { session: batchSession },
  }));
  let markdownRequests = 0;
  let releaseFailure = () => {};
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  await page.route("**/api/batches/batch-preview-fail/markdown", async (route) => {
    markdownRequests += 1;
    if (markdownRequests === 1) {
      await route.fulfill({ status: 500, body: "unavailable" });
      return;
    }
    if (markdownRequests === 2) {
      await failureGate;
      await route.fulfill({ status: 500, body: "unavailable" });
      return;
    }
    await route.fulfill({
      body: "# Aggregated prompt\n\nRetry.",
      contentType: "text/markdown; charset=utf-8",
    });
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/app");

  const dialog = await openPreview(page, "Lowcode Studio");
  await expect.poll(() => markdownRequests).toBe(1);
  await dialog.getByRole("button", { exact: true, name: "Copy prompt" }).click();
  await expect(dialog.getByRole("button", { exact: true, name: "Preparing prompt…" })).toBeDisabled();
  releaseFailure();
  const failed = dialog.getByRole("button", { exact: true, name: "Couldn't prepare the prompt" });
  await expect(failed).toBeEnabled();
  await expect(dialog.getByRole("button", { exact: true, name: "Copied" })).toHaveCount(0);
  await failed.click();
  await expect(dialog.getByRole("button", { exact: true, name: "Copied" })).toBeEnabled();
  expect(markdownRequests).toBe(3);
});
