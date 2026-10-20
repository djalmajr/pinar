import { devices, expect, type Locator, type Page, test, type TestInfo } from "@playwright/test";
import { signInCloudPro } from "../helpers/cloud-signin";
import { chooseButtonMenuItem, closeWorkspaceSidebar, isMobileViewport, openWorkspaceSidebar } from "../helpers/ui";

const LONG_NAME = "Quarterly design system review for the mobile onboarding flow";

// The sidebar rows that carry both a count and the ⋮ actions button.
const COLLECTION_ACTIONS = `${LONG_NAME}: Collection actions`;

// The long collection reports this many sessions, past the three digits the
// row reserves room for: the badge shows "999+", the title and the screen
// reader keep the full count.
const PADDED_COUNT = 1234;
const CAPPED_TEXT = "999+";
const PADDED_LABEL = "1,234 sessions";

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
// settles. New collection closes the sheet; while it animates out it is still
// visible with data-closed, so only a sheet with data-open counts as open.
async function openPhoneSidebar(page: Page) {
  const sheet = page.locator('[data-mobile="true"][data-open]');
  await expect(async () => {
    if (!(await sheet.isVisible())) await page.getByRole("button", { exact: true, name: "Collections" }).click();
    await expect(sheet.getByRole("button", { exact: true, name: "Inbox" })).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await sheet.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
}

// Pads the long collection in every tree response, so the sidebar counts 1234
// sessions without writing them to the store.
async function padLongCollection(page: Page) {
  await page.route("**/api/project-tree", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const project of body.tree?.projects ?? []) {
      for (const collection of project.collections ?? []) {
        if (collection.name !== LONG_NAME) continue;
        collection.sessions = Array.from({ length: PADDED_COUNT }, (_, index) => ({
          collectionId: collection.id,
          createdAt: "2026-10-19T12:00:00.000Z",
          id: `padded-${index}`,
          page: { title: `Padded capture ${index}`, url: `https://example.test/${index}` },
          pins: [],
          shotUrl: null,
        }));
      }
    }
    await route.fulfill({ json: body, response });
  });
}

async function expectCappedCount(row: Locator) {
  const count = countOf(row);
  await expect(count.locator('[aria-hidden="true"]')).toHaveText(CAPPED_TEXT);
  await expect(count).toHaveAttribute("title", PADDED_LABEL);
  await expect(count.locator(".sr-only")).toHaveText(PADDED_LABEL);
}

async function snapshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { contentType: "image/png", path });
}

async function createLongCollection(page: Page) {
  // The Inbox row comes from the project tree. Before the tree lands the app
  // has no project to create in: Create closes the dialog and writes nothing.
  await openWorkspaceSidebar(page, "Inbox");
  const dialog = page.getByRole("dialog", { name: "New collection" });
  // The first click can land before hydration; retry until the dialog opens.
  await expect(async () => {
    await page.getByRole("button", { name: "New collection" }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await dialog.getByRole("textbox", { name: "Name" }).fill(LONG_NAME);
  const created = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/api\/projects\/[^/]+\/collections$/.test(new URL(response.url()).pathname));
  await dialog.getByRole("button", { name: "Create" }).click();
  expect((await created).ok(), "the collection is created").toBe(true);
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
  await padLongCollection(page);
  await page.goto("/app");
  await createLongCollection(page);
  try {
    await body();
  } finally {
    await deleteLongCollection(page);
    // The delete refreshes the tree: let that padded response finish before
    // teardown closes the context under it.
    await page.unrouteAll({ behavior: "wait" });
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
  await expectCappedCount(row);
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
// overlap or the desktop hover swap fail. Dropping the "999+" cap shows the
// four digits and fails the capped-count check.
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`phone (${colorScheme})`, () => {
    test.use({ ...phone, colorScheme });

    test("the count sits beside the ⋮ button and clear of a long truncated name", async ({ page }, testInfo) => {
      await withLongCollection(page, async () => {
        await openPhoneSidebar(page);
        // Measure once the padded tree has landed in the row.
        await expectCappedCount(collectionRow(page));
        await expectPhoneRows(page);
        await snapshot(page, testInfo, `phone-${colorScheme}`);
      });
    });
  });
}

test.describe("desktop", () => {
  test.use({ viewport: { height: 900, width: 1440 } });

  test("at rest the count shows at the edge; on hover the ⋮ button takes its place", async ({ page }, testInfo) => {
    await withLongCollection(page, async () => {
      await expect(collectionRow(page)).toBeVisible();
      await expectCappedCount(collectionRow(page));
      await page.mouse.move(0, 0);
      // From md up the "999+" row widens its label reservation: the truncated
      // name ends before the wider count. The button animates its padding once
      // the padded tree lands, so measure until it settles.
      await expect(async () => {
        const name = await box(nameOf(collectionRow(page)));
        const capped = await box(countOf(collectionRow(page)));
        expect(await nameOf(collectionRow(page)).evaluate((el) => el.scrollWidth > el.clientWidth), "name is truncated").toBe(true);
        expect(name.right, "name ends before the 999+ count").toBeLessThanOrEqual(capped.left);
      }).toPass({ timeout: 5_000 });
      await snapshot(page, testInfo, "desktop-rest");
      await collectionRow(page).hover();
      await snapshot(page, testInfo, "desktop-hover");
      for (const [row, capped] of [[inboxRow(page), false], [collectionRow(page), true]] as const) {
        await page.mouse.move(0, 0);
        await expect(countOf(row)).toHaveCSS("opacity", "1");
        await expect(actionsOf(row)).toHaveCSS("opacity", "0");
        const count = await box(countOf(row));
        const actions = await box(actionsOf(row));
        // The count keeps the right edge: it ends where the ⋮ button ends.
        expect(Math.abs(count.right - actions.right), "count at the row's right edge").toBeLessThanOrEqual(4);
        // "999+" is wider than the ⋮ button, so it reaches past the button's
        // slot; the name check below keeps it clear of the label instead.
        if (!capped)
          expect(count.left, "count over the button's slot").toBeGreaterThanOrEqual(actions.left - 8);

        await row.hover();
        await expect(countOf(row)).toHaveCSS("opacity", "0");
        await expect(actionsOf(row)).toHaveCSS("opacity", "1");
      }
      await page.mouse.move(0, 0);
    });
  });
});
