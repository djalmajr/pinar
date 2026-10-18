import { devices, expect, type Locator, type Page, test } from "@playwright/test";
import { signInCloudPro } from "../helpers/cloud-signin";
import { chooseButtonMenuItem, closeWorkspaceSidebar, isMobileViewport, openWorkspaceSidebar } from "../helpers/ui";

const LONG_NAME = "Quarterly design system review for the mobile onboarding flow";

// The sidebar rows that carry both a count and the ⋮ actions button.
const COLLECTION_ACTIONS = `${LONG_NAME}: Collection actions`;

// The chromium project runs these; the device only supplies the phone's
// viewport, touch and scale, never its default (webkit) browser.
const { defaultBrowserType: _phoneBrowser, ...phone } = devices["iPhone 13"];

interface Box { bottom: number; left: number; right: number; top: number }

async function box(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
  });
}

function overlaps(a: Box, b: Box) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function inboxRow(page: Page) {
  return page.locator('[data-slot="sidebar-menu-item"]', { has: page.getByRole("button", { exact: true, name: "Inbox" }) });
}

function collectionRow(page: Page) {
  return page.locator('[data-slot="sidebar-menu-item"][data-collection-id]', { hasText: LONG_NAME });
}

function nameOf(row: Locator) {
  return row.locator("button").first().locator("> span").last();
}

function countOf(row: Locator) {
  return row.locator('[data-slot="sidebar-menu-badge"]');
}

function actionsOf(row: Locator) {
  return row.locator('button[aria-label$="Collection actions"]');
}

// Opens the phone's sidebar sheet from the toolbar button and waits until it
// settles. Creating a collection selects it, which closes the sheet.
async function openPhoneSidebar(page: Page) {
  const sheet = page.locator('[data-mobile="true"]');
  await expect(async () => {
    if (!(await sheet.isVisible())) await page.getByRole("button", { exact: true, name: "Collections" }).click();
    await expect(sheet.getByRole("button", { exact: true, name: "Inbox" })).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await sheet.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function createLongCollection(page: Page) {
  await openWorkspaceSidebar(page, "New collection");
  const dialog = page.getByRole("dialog", { name: "New collection" });
  // The first click can land before hydration; retry until the dialog opens.
  await expect(async () => {
    await page.getByRole("button", { name: "New collection" }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await dialog.getByRole("textbox", { name: "Name" }).fill(LONG_NAME);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).not.toBeVisible();
}

async function deleteLongCollection(page: Page) {
  await openWorkspaceSidebar(page, LONG_NAME);
  await chooseButtonMenuItem(page, COLLECTION_ACTIONS, "Remove");
  const confirm = page.getByRole("alertdialog", { name: "Delete collection" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm).not.toBeVisible();
  await closeWorkspaceSidebar(page);
}

async function withLongCollection(page: Page, body: () => Promise<void>) {
  await signInCloudPro(page);
  await page.goto("/app");
  await createLongCollection(page);
  try {
    await body();
  } finally {
    await deleteLongCollection(page);
  }
}

async function expectPhoneRows(page: Page) {
  for (const row of [inboxRow(page), collectionRow(page)]) {
    await expect(countOf(row)).toBeVisible();
    await expect(actionsOf(row)).toBeVisible();
    // Touch has no hover: both stay fully visible.
    await expect(countOf(row)).toHaveCSS("opacity", "1");
    await expect(actionsOf(row)).toHaveCSS("opacity", "1");
    const count = await box(countOf(row));
    const actions = await box(actionsOf(row));
    expect(overlaps(count, actions), "count overlaps the ⋮ button").toBe(false);
    expect(count.right, "count sits left of the ⋮ button").toBeLessThanOrEqual(actions.left);
  }
  const row = collectionRow(page);
  const name = await box(nameOf(row));
  const count = await box(countOf(row));
  const actions = await box(actionsOf(row));
  // The name is truncated (longer than its box) and still stays clear.
  await expect(nameOf(row)).toHaveText(LONG_NAME);
  expect(await nameOf(row).evaluate((el) => el.scrollWidth > el.clientWidth), "name is truncated").toBe(true);
  expect(overlaps(name, count), "name overlaps the count").toBe(false);
  expect(overlaps(name, actions), "name overlaps the ⋮ button").toBe(false);
  expect(name.right, "name ends before the count").toBeLessThanOrEqual(count.left);
}

// Mutation captured: dropping collectionBadgeClass from either row, or
// returning the label reservation to the base pr-9, makes the phone row
// overlap or the desktop hover swap fail.
test.describe("phone", () => {
  test.use({ ...phone });

  test("the count sits beside the ⋮ button and clear of a long truncated name", async ({ page }) => {
    await withLongCollection(page, async () => {
      // A tree refresh can remount the sheet mid-way: reopen and measure again.
      await expect(async () => {
        await openPhoneSidebar(page);
        await expectPhoneRows(page);
      }).toPass({ timeout: 30_000 });
    });
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { height: 900, width: 1440 } });

  test("at rest the count shows at the edge; on hover the ⋮ button takes its place", async ({ page }) => {
    await withLongCollection(page, async () => {
      await expect(collectionRow(page)).toBeVisible();
      for (const row of [inboxRow(page), collectionRow(page)]) {
        await page.mouse.move(0, 0);
        await expect(countOf(row)).toHaveCSS("opacity", "1");
        await expect(actionsOf(row)).toHaveCSS("opacity", "0");
        const count = await box(countOf(row));
        const actions = await box(actionsOf(row));
        // The count keeps the right edge: it ends where the ⋮ button ends.
        expect(Math.abs(count.right - actions.right), "count at the row's right edge").toBeLessThanOrEqual(4);
        expect(count.left, "count over the button's slot").toBeGreaterThanOrEqual(actions.left - 8);

        await row.hover();
        await expect(countOf(row)).toHaveCSS("opacity", "0");
        await expect(actionsOf(row)).toHaveCSS("opacity", "1");
      }
      await page.mouse.move(0, 0);
    });
  });
});
