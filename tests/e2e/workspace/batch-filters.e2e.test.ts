import { expect, test } from "@playwright/test";
import { openWorkspaceSidebar } from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";
const ownerId = "ins_batch_filters";

function tree() {
  return {
    projects: [{
      collections: [{
        createdAt,
        id: "col_inbox",
        isProtected: true,
        name: "Inbox",
        ownerId,
        parentId: null,
        position: 0,
        projectId: "prj_personal",
        sessions: [],
        updatedAt: createdAt,
      }],
      createdAt,
      icon: "user-round",
      id: "prj_personal",
      isProtected: true,
      name: "Personal",
      ownerId,
      position: 0,
      updatedAt: createdAt,
    }],
  };
}

test("filters stay visible and remove all clears groupings", async ({ page }) => {
  let batches = [
    { finishedAt: createdAt, id: "batch_one", label: "First batch", sessionCount: 2, startedAt: createdAt },
    { finishedAt: createdAt, id: "batch_two", label: "Second batch", sessionCount: 1, startedAt: createdAt },
  ];

  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-batch-filters-ready")) return;
    localStorage.clear();
    localStorage.setItem("pinar-selected-project", "prj_personal");
    sessionStorage.setItem("pinar-batch-filters-ready", "true");
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: ownerId, kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({ json: { tree: tree() } }));
  await page.route("**/api/batches", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: { batches, ok: true } });
  });
  await page.route("**/api/batches/*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }
    const id = new URL(route.request().url()).pathname.split("/").pop() || "";
    batches = batches.filter((batch) => batch.id !== id);
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/app");
  await openWorkspaceSidebar(page, "Inbox");
  await expect(page.getByText("Filters", { exact: true })).toBeVisible();
  const batchesRow = page.getByRole("button", { exact: true, name: "Batches" });
  await expect(batchesRow).toBeVisible();
  await page.getByRole("button", { name: "Expand Batches" }).click();
  await expect(page.getByRole("button", { exact: true, name: "First batch" })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Second batch" })).toBeVisible();

  await batchesRow.hover();
  await page.getByRole("button", { name: "Batch actions" }).click();
  await page.getByRole("menuitem", { name: "Remove all" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove all groupings?" });
  await expect(confirm).toContainText("The sessions stay in their collections. Only the groupings are removed.");
  await confirm.getByRole("button", { name: "Remove all" }).click();
  await expect(page.getByRole("button", { exact: true, name: "First batch" })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Second batch" })).toHaveCount(0);
  await expect(page.getByText("Filters", { exact: true })).toBeVisible();
  await expect(batchesRow).toBeVisible();

  await batchesRow.hover();
  await page.getByRole("button", { name: "Batch actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Remove all" })).toBeDisabled();
});

test("empty workspace still shows the batches grouper", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-batch-filters-empty-ready")) return;
    localStorage.clear();
    localStorage.setItem("pinar-selected-project", "prj_personal");
    sessionStorage.setItem("pinar-batch-filters-empty-ready", "true");
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: ownerId, kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({ json: { tree: tree() } }));
  await page.route("**/api/batches", (route) => route.fulfill({ json: { batches: [], ok: true } }));

  await page.goto("/app");
  await openWorkspaceSidebar(page, "Inbox");
  await expect(page.getByText("Filters", { exact: true })).toBeVisible();
  const batchesRow = page.getByRole("button", { exact: true, name: "Batches" });
  await expect(batchesRow).toBeVisible();
  await batchesRow.hover();
  await page.getByRole("button", { name: "Batch actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Remove all" })).toBeDisabled();
});
