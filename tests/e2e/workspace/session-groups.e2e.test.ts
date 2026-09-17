import { expect, test } from "@playwright/test";

test("every collection displays newest captures first", async ({ page }) => {
  const createdAt = "2026-09-14T12:00:00Z";
  const collections = ["Inbox", "Other"].map((name) => ({
    id: name.toLowerCase(), name, projectId: "personal", ownerId: "local", isProtected: name === "Inbox", parentId: null, position: 0, createdAt, updatedAt: createdAt,
    sessions: [1, 3, 2].map((day) => ({ id: `${name}-${day}`, shotUrl: "/shots/order.svg", collectionId: name.toLowerCase(), createdAt: `2026-09-${day + 10}T12:00:00Z`, page: { title: `${name} ${day}`, url: "https://example.test" }, pins: [] })),
  }));
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/project-tree", (route) => route.fulfill({ json: { tree: { projects: [{ id: "personal", ownerId: "local", position: 0, name: "Personal", icon: "user-round", isProtected: true, createdAt, updatedAt: createdAt, collections }] } } }));
  await page.route("**/api/batches", (route) => route.fulfill({ json: { batches: [], ok: true } }));
  await page.route("**/api/sessions/Other-3", (route) => route.fulfill({ json: { session: collections[1].sessions[1] } }));
  await page.route("**/shots/order.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="skyblue"/></svg>' }));
  await page.goto("/app");
  for (const name of ["Inbox", "Other"]) {
    await page.getByRole("button", { name: new RegExp(name) }).first().click();
    await expect(page.locator('[data-session-id]')).toHaveCount(3);
    await expect.poll(() => page.locator('[data-session-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-session-id")))).toEqual([`${name}-3`, `${name}-2`, `${name}-1`]);
  }
  await page.locator('[data-session-id="Other-3"]').getByRole("button", { name: "View capture", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Other 3", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next capture", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review on page", exact: true })).toHaveCount(0);
});
test("history opens one review session containing all screenshots", async ({ page }, testInfo) => {
  const createdAt = "2026-09-14T12:00:00Z";
  const sessions = [0, 1, 2].map((index) => ({ id: `review-evidence-${index}`, captureId: `review-evidence-${index}`, batchId: "review-group", createdAt, collectionId: "inbox", page: { title: index < 2 ? "Checkout" : "Account", url: `https://example.test/${index < 2 ? "checkout" : "account"}` }, pins: [{ pinId: `pin-${index}`, id: `pin-${index}`, number: index + 1, type: "point", coords: { x: 40, y: 40 }, comment: `Review comment ${index}` }], shotUrl: `/shots/review-evidence-${index}.svg` }));
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/project-tree", (route) => route.fulfill({ json: { tree: { projects: [{ id: "personal", ownerId: "local", position: 0, name: "Personal", icon: "user-round", isProtected: true, createdAt, updatedAt: createdAt, collections: [{ id: "inbox", name: "Inbox", projectId: "personal", ownerId: "local", isProtected: true, parentId: null, position: 0, createdAt, updatedAt: createdAt, sessions }] }] } } }));
  await page.route("**/api/batches", (route) => route.fulfill({ json: { batches: [{ id: "review-group", label: "Review session", sessionCount: 3, startedAt: createdAt }], ok: true } }));
  await page.route("**/api/sessions/review-evidence-*", (route) => route.fulfill({ json: { session: sessions.find((session) => route.request().url().endsWith(session.id)) } }));
  await page.route("**/shots/review-evidence-*.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#e0f2fe"/><text x="30" y="70">Review evidence</text></svg>' }));
  await page.goto("/app");
  await expect(page.locator('[data-session-id]')).toHaveCount(1);
  await expect(page.getByText("2 pages · 3 captures")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("review-session.png"), fullPage: true });
  await page.getByRole("button", { name: "View capture", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Checkout", exact: true })).toBeVisible();
  await expect(page.locator('[data-session-id]')).toHaveCount(1);
  const dialog = page.getByRole("dialog", { name: "Checkout", exact: true });
  await expect(dialog.locator("[data-capture-image]")).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(dialog.getByText(`Review comment ${index}`, { exact: true })).toBeVisible();
    await expect(dialog.locator(`[data-capture-image="review-evidence-${index}"] img`)).toBeVisible();
  }
  await expect(dialog.getByRole("button", { name: "Next capture", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Review on page", exact: true })).toHaveCount(0);
  await expect.poll(() => dialog.evaluate((node) => document.activeElement === node)).toBe(false);
  const copyButton = dialog.getByRole("button", { name: "Copy prompt", exact: true });
  const title = dialog.getByRole("heading", { name: "Checkout", exact: true });
  const copyBox = await copyButton.boundingBox();
  const titleBox = await title.boundingBox();
  expect(copyBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(copyBox?.x ?? 0).toBeGreaterThan((titleBox?.x ?? 0) + (titleBox?.width ?? 0));
  await page.setViewportSize({ height: 800, width: 640 });
  await expect.poll(() => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("review-evidence-narrow.png"), fullPage: true });
  await page.setViewportSize({ height: 720, width: 1280 });
  await page.screenshot({ path: testInfo.outputPath("review-evidence.png"), fullPage: true });
  await dialog.getByText("Review comment 2", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pin 3", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.locator('[data-capture-image="review-evidence-2"]')).toHaveClass(/ring-primary/);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator('[data-session-id]')).toHaveCount(1);
});
