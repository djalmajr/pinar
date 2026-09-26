import { expect, type Locator, type Page, test } from "@playwright/test";

const session = {
  createdAt: "2026-08-18T01:30:00.000Z",
  id: "viewer-e2e",
  page: {
    description: "Settings for the example app.",
    title: "Viewer fixture",
    url: "https://example.test/settings",
  },
  pins: [
    {
      comment: "Align this action with the right edge.",
      coords: { x: 24, y: 48 },
      domPath: "main > form > button",
      innerText: "Save changes",
      location: {
        confidence: "ambiguous",
        evidence: ["competing candidates"],
        score: 0.52,
        strategy: "semantic",
      },
      number: 1,
      selector: "button[data-save]",
      tag: "button",
      type: "point",
    },
  ],
  privacy: { redacted: [], unevaluated: false },
  shotId: "viewer-e2e",
  shotUrl: "/shots/viewer-e2e.svg",
};

async function expectCloseSharesTabCenter(dialog: Locator) {
  const tabs = dialog.getByRole("tablist");
  const close = dialog.getByRole("button", { name: "Close" });
  await expect(tabs).toBeVisible();
  await expect(close).toBeVisible();
  const tabsBox = await tabs.boundingBox();
  const closeBox = await close.boundingBox();
  expect(tabsBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  if (!tabsBox || !closeBox) return;
  const tabsCenter = tabsBox.y + tabsBox.height / 2;
  const closeCenter = closeBox.y + closeBox.height / 2;
  expect(Math.abs(tabsCenter - closeCenter)).toBeLessThanOrEqual(1);
  expect(closeBox.x + 1).toBeGreaterThanOrEqual(tabsBox.x + tabsBox.width);
  expect(await close.evaluate((element) => getComputedStyle(element).position)).not.toBe("absolute");
}

async function openPin(page: Page) {
  await page.getByTitle("Open pin 1").click();
  const dialog = page.getByRole("dialog", { name: "Pin 1" });
  await expect(dialog.getByRole("heading", { level: 2, name: "Pin 1" })).toBeVisible();
  await expect(dialog.getByText("Pinar may not find this element again on the original page.")).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { kind: "local", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [{
          collections: [{
            createdAt: session.createdAt,
            id: "col_viewer_inbox",
            isProtected: true,
            name: "Inbox",
            ownerId: "local",
            parentId: null,
            position: 0,
            projectId: "prj_viewer_personal",
            sessions: [],
            updatedAt: session.createdAt,
          }],
          createdAt: session.createdAt,
          icon: "user-round",
          id: "prj_viewer_personal",
          isProtected: true,
          name: "Personal",
          ownerId: "local",
          position: 0,
          updatedAt: session.createdAt,
        }],
      },
    },
  }));
  await page.route("**/api/sessions/viewer-e2e", (route) => route.fulfill({
    json: { session },
  }));
  await page.route("**/shots/viewer-e2e.svg", (route) => route.fulfill({
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'/>",
    contentType: "image/svg+xml",
  }));
});

test("pin dialog close sits on the tab row at desktop and narrow widths", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/v/viewer-e2e");
  let dialog = await openPin(page);
  await expectCloseSharesTabCenter(dialog);
  const close = dialog.getByRole("button", { name: "Close" });
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  dialog = await openPin(page);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  await page.setViewportSize({ height: 800, width: 390 });
  dialog = await openPin(page);
  await expectCloseSharesTabCenter(dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
