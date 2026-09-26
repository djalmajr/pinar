import { expect, test } from "@playwright/test";
import { chooseButtonMenuItem, openButtonMenu, openWorkspaceSidebar } from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";
const ownerId = "ins_delete_progress";

function collection(id: string, name: string) {
  return {
    createdAt,
    id,
    isProtected: false,
    name,
    ownerId,
    parentId: null,
    position: 0,
    projectId: "prj_workspace",
    sessions: [],
    updatedAt: createdAt,
  };
}

test("collection and project deletion stay pending until the response", async ({ page }) => {
  let workspaceCollections = [collection("col_review", "Review")];
  let workspacePresent = true;
  const collectionReleases: Array<(status: number) => void> = [];
  const projectReleases: Array<(status: number) => void> = [];
  let collectionDeletes = 0;
  let projectDeletes = 0;

  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("pinar-selected-project", "prj_workspace");
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: ownerId, kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [
          {
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
          },
          ...(workspacePresent ? [{
            collections: workspaceCollections,
            createdAt,
            icon: "folder-kanban",
            id: "prj_workspace",
            isProtected: false,
            name: "Workspace",
            ownerId,
            position: 1,
            updatedAt: createdAt,
          }] : []),
        ],
      },
    },
  }));
  await page.route("**/api/collections/col_review", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    collectionDeletes += 1;
    const status = await new Promise<number>((resolve) => { collectionReleases.push(resolve); });
    if (status === 200) workspaceCollections = [];
    await route.fulfill({
      json: status === 200 ? { ok: true } : { error: "temporary failure" },
      status,
    });
  });
  await page.route("**/api/projects/prj_workspace", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    projectDeletes += 1;
    const status = await new Promise<number>((resolve) => { projectReleases.push(resolve); });
    if (status === 200) workspacePresent = false;
    await route.fulfill({
      json: status === 200 ? { ok: true } : { error: "temporary failure" },
      status,
    });
  });

  await page.goto("/app");
  await openWorkspaceSidebar(page, "Review");
  await openButtonMenu(page, "Review: Collection actions");
  await chooseButtonMenuItem(page, "Review: Collection actions", "Remove");
  const collectionDialog = page.getByRole("alertdialog", { name: "Delete collection" });
  const deleteCollection = collectionDialog.getByRole("button", { name: "Delete" });
  await collectionDialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().filter((animation) => (
      animation.effect?.getComputedTiming().iterations !== Infinity
    )).map((animation) => animation.finished.catch(() => undefined)));
  });
  const before = await deleteCollection.boundingBox();
  await deleteCollection.click();
  const deletingCollection = collectionDialog.getByRole("button", { name: "Deleting…" });
  await expect(collectionDialog).toBeVisible();
  await expect(deletingCollection).toBeDisabled();
  await expect(collectionDialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  const during = await deletingCollection.boundingBox();
  expect(during?.width).toBeCloseTo(before?.width ?? -1, 0);
  expect(during?.height).toBeCloseTo(before?.height ?? -1, 0);
  expect(collectionDeletes).toBe(1);
  await deletingCollection.click({ force: true });
  expect(collectionDeletes).toBe(1);

  collectionReleases[0]?.(503);
  await expect(collectionDialog.getByRole("alert")).toHaveText("Couldn’t delete. Try again.");
  await expect(collectionDialog.getByRole("button", { name: "Delete" })).toBeEnabled();
  await expect(collectionDialog.getByRole("button", { name: "Cancel" })).toBeEnabled();
  await collectionDialog.getByRole("button", { name: "Delete" }).click();
  await expect(collectionDialog.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  expect(collectionDeletes).toBe(2);
  collectionReleases[1]?.(200);
  await expect(collectionDialog).not.toBeVisible();

  await openButtonMenu(page, "Workspace: Project actions");
  await chooseButtonMenuItem(page, "Workspace: Project actions", "Delete project");
  const projectDialog = page.getByRole("alertdialog", { name: "Delete project" });
  await projectDialog.getByRole("button", { name: "Delete" }).click();
  const deletingProject = projectDialog.getByRole("button", { name: "Deleting…" });
  await expect(projectDialog).toBeVisible();
  await expect(deletingProject).toBeDisabled();
  await expect(projectDialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(projectDeletes).toBe(1);
  await deletingProject.click({ force: true });
  expect(projectDeletes).toBe(1);
  projectReleases[0]?.(200);
  await expect(projectDialog).not.toBeVisible();
});
