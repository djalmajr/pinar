import { expect, test, type Page } from "@playwright/test";
import { installClipboardHarness, readClipboardHarness } from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";

function session(id: string, title: string, position: number, pinCount: number) {
  return {
    collectionId: "review-collection",
    createdAt,
    id,
    page: { title, url: `https://example.test/${id}` },
    pins: Array.from({ length: pinCount }, (_, index) => ({
      comment: `${title} comment ${index + 1}`,
      coords: { x: 20 + index, y: 40 + index },
      number: index + 1,
      type: "point",
    })),
    position,
    shotId: id,
    shotUrl: `/shots/${id}.svg`,
  };
}

function collection(id: string, name: string, position: number, sessions: ReturnType<typeof session>[]) {
  return {
    createdAt,
    id,
    isProtected: false,
    name,
    ownerId: "owner-review",
    parentId: null,
    position,
    projectId: "project-review",
    sessions,
    updatedAt: createdAt,
  };
}

async function installSessionRoutes(page: Page, sessions: ReturnType<typeof session>[]) {
  for (const item of sessions) {
    await page.route(`**/api/sessions/${item.id}`, (route) => route.fulfill({ json: { session: item } }));
    await page.route(`**/shots/${item.id}.svg`, (route) => route.fulfill({
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><text x="20" y="40">${item.page.title}</text></svg>`,
      contentType: "image/svg+xml",
    }));
  }
}

test("collection aggregate preserves order, navigation, Markdown and live membership", async ({ page }) => {
  await installClipboardHarness(page);
  const first = session("capture-first", "First capture", 0, 1);
  const second = session("capture-second", "Second capture", 1, 2);
  const third = session("capture-third", "Third capture", 2, 3);
  let afterMove = false;
  await installSessionRoutes(page, [first, second, third]);
  await page.route("**/api/public/collections/review-collection", (route) => route.fulfill({
    json: {
      collection: collection(
        "review-collection",
        "Review collection",
        0,
        afterMove ? [first, third] : [first, second, third],
      ),
    },
  }));
  await page.route("**/c/review-collection.md", (route) => route.fulfill({
    body: [
      "# Review collection",
      "",
      "## First capture",
      "https://example.test/capture-first",
      "",
      "## Second capture",
      "https://example.test/capture-second",
      "",
      "## Third capture",
      "https://example.test/capture-third",
    ].join("\n"),
    contentType: "text/markdown",
  }));

  await page.goto("/c/review-collection");

  await expect(page.getByRole("heading", { name: "Review collection" })).toBeVisible();
  await expect(page.getByText("3 sessions", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="card-title"]')).toHaveText([
    "First capture",
    "Second capture",
    "Third capture",
  ]);

  await page.getByRole("link", { name: "Open" }).nth(1).click();
  await expect(page).toHaveURL(/\/v\/capture-second$/);
  await expect(page.getByRole("heading", { name: "Second capture" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Review collection" })).toBeVisible();

  await page.getByRole("button", { name: "Copy Markdown" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await readClipboardHarness(page);
  expect(copied.indexOf("First capture")).toBeLessThan(copied.indexOf("Second capture"));
  expect(copied.indexOf("Second capture")).toBeLessThan(copied.indexOf("Third capture"));
  expect(copied).not.toContain("Foreign account capture");

  afterMove = true;
  await page.reload();
  await expect(page.getByText("2 sessions", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(["First capture", "Third capture"]);
  await expect(page.getByText("Second capture", { exact: true })).toHaveCount(0);
});

test("project aggregate preserves hierarchy, authentic cards, live links and empty collections", async ({ page }) => {
  await installClipboardHarness(page);
  const first = session("project-first", "Project first", 0, 1);
  const second = session("project-second", "Project second", 1, 2);
  const review = collection("review-collection", "Review", 0, [first, second]);
  const empty = collection("empty-collection", "Empty follow-up", 1, []);
  await installSessionRoutes(page, [first, second]);
  await page.route("**/api/public/projects/project-review", (route) => route.fulfill({
    json: {
      project: {
        collections: [review, empty],
        createdAt,
        icon: "rocket",
        id: "project-review",
        isProtected: false,
        name: "Website review",
        ownerId: "owner-review",
        position: 0,
        updatedAt: createdAt,
      },
    },
  }));
  await page.route("**/p/project-review.md", (route) => route.fulfill({
    body: [
      "# Website review",
      "",
      "## Review",
      "https://example.test/c/review-collection",
      "",
      "### Project first",
      "https://example.test/v/project-first",
      "",
      "### Project second",
      "https://example.test/v/project-second",
      "",
      "## Empty follow-up",
      "https://example.test/c/empty-collection",
    ].join("\n"),
    contentType: "text/markdown",
  }));

  await page.goto("/p/project-review");

  await expect(page.getByRole("heading", { name: "Website review" })).toBeVisible();
  await expect(page.getByText("2 sessions", { exact: true })).toBeVisible();
  await expect(page.locator("main h2")).toHaveText(["Review", "Empty follow-up"]);
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(["Project first", "Project second"]);
  await expect(page.getByText("https://example.test/project-first", { exact: true })).toBeVisible();
  await expect(page.getByText("1 pin", { exact: true })).toBeVisible();
  await expect(page.getByText("2 pins", { exact: true })).toBeVisible();
  await expect(page.getByText("No sessions in this collection.", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Open" }).nth(1).click();
  await expect(page).toHaveURL(/\/v\/project-second$/);
  await expect(page.getByRole("heading", { name: "Project second" })).toBeVisible();
  await page.goBack();
  await expect(page.locator("main h2")).toHaveText(["Review", "Empty follow-up"]);

  await page.getByRole("button", { name: "Copy Markdown" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await readClipboardHarness(page);
  expect(copied.indexOf("## Review")).toBeLessThan(copied.indexOf("## Empty follow-up"));
  expect(copied.indexOf("Project first")).toBeLessThan(copied.indexOf("Project second"));
  expect(copied).toContain("/v/project-first");
  expect(copied).toContain("/v/project-second");
  expect(copied).not.toContain("Foreign project");
});
