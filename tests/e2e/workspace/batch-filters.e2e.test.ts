import { expect, test, type Page } from "@playwright/test";
import { openWorkspaceSidebar } from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";
const ownerId = "ins_batch_filters";

function capture(id: string, batchId: string, title: string) {
  return {
    batchId,
    collectionId: "col_inbox",
    createdAt,
    id,
    page: { title, url: `https://example.test/${id}` },
    pins: [{ comment: `${title} feedback`, number: 1, type: "point", coords: { x: 20, y: 30 } }],
    shotUrl: `/shots/${id}.svg`,
  };
}

async function mockWorkspace(page: Page, sessions: ReturnType<typeof capture>[]) {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: { tree: { projects: [{
      collections: [{
        createdAt, id: "col_inbox", isProtected: true, name: "Inbox", ownerId,
        parentId: null, position: 0, projectId: "prj_personal", sessions, updatedAt: createdAt,
      }],
      createdAt, icon: "user-round", id: "prj_personal", isProtected: true,
      name: "Personal", ownerId, position: 0, updatedAt: createdAt,
    }] } },
  }));
  await page.route("**/api/batches", (route) => route.fulfill({
    json: { batches: [...new Set(sessions.map((session) => session.batchId))].map((id) => ({
      id, label: id, sessionCount: sessions.filter((session) => session.batchId === id).length, startedAt: createdAt,
    })), ok: true },
  }));
  await page.route("**/shots/*.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="skyblue"/></svg>',
  }));
}

// The batch sidebar was retired in 1ec1ecc; captures are grouped in their collection.
test("batches group their captures in Inbox without separate sidebar filters", async ({ page }) => {
  await mockWorkspace(page, [
    capture("first-one", "batch_one", "First batch"),
    capture("first-two", "batch_one", "First batch second page"),
    capture("second-one", "batch_two", "Second batch"),
  ]);
  await page.goto("/app");
  await expect(page.locator("[data-session-id]")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "First batch", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Second batch", exact: true })).toBeVisible();
  await expect(page.getByText("2 pages · 2 captures")).toBeVisible();
  await openWorkspaceSidebar(page, "Inbox");
  await expect(page.getByText("Filters", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Batches", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.locator("[data-session-id]")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "First batch", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Second batch", exact: true })).toBeVisible();
});

test("empty Inbox keeps collection navigation without obsolete batch actions", async ({ page }) => {
  await mockWorkspace(page, []);
  await page.goto("/app");
  await openWorkspaceSidebar(page, "Inbox");
  await expect(page.getByRole("button", { name: "Inbox", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "All sessions", exact: true })).toBeVisible();
  await expect(page.getByText("Filters", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Batch actions" })).toHaveCount(0);
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No annotation sessions found" })).toBeVisible();
});
