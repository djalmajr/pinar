import { expect, test } from "@playwright/test";
import {
  chooseButtonMenuItem,
  closeWorkspaceSidebar,
  isMobileViewport,
  openButtonMenu,
  openWorkspaceSidebar,
} from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";
const ownerId = "ins_collection_crud";

function capture() {
  return {
    collectionId: "col_child",
    createdAt,
    id: "session_nested",
    page: { title: "Nested capture", url: "https://example.test/nested" },
    pins: [{ comment: "Nested feedback", coords: { x: 10, y: 20 }, number: 1, type: "point" }],
    position: 0,
  };
}

function collection(id: string, name: string, position: number, parentId: string | null, sessions: ReturnType<typeof capture>[] = [], isProtected = false) {
  return {
    createdAt,
    id,
    isProtected,
    name,
    ownerId,
    parentId,
    position,
    projectId: isProtected ? "prj_personal" : "prj_workspace",
    sessions,
    updatedAt: createdAt,
  };
}

test("nested collection CRUD protects Inbox and preserves sessions through container deletion", async ({ page }) => {
  const nestedCapture = capture();
  let inbox = collection("col_personal_inbox", "Inbox", 0, null, [], true);
  let workspaceCollections: ReturnType<typeof collection>[] = [];
  const personal = () => ({
    collections: [inbox],
    createdAt,
    icon: "user-round",
    id: "prj_personal",
    isProtected: true,
    name: "Personal",
    ownerId,
    position: 0,
    updatedAt: createdAt,
  });
  const workspace = () => ({
    collections: workspaceCollections,
    createdAt,
    icon: "folder-kanban",
    id: "prj_workspace",
    isProtected: false,
    name: "Workspace",
    ownerId,
    position: 1,
    updatedAt: createdAt,
  });

  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-collection-crud-ready")) return;
    localStorage.clear();
    localStorage.setItem("pinar-selected-project", "prj_workspace");
    sessionStorage.setItem("pinar-collection-crud-ready", "true");
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: ownerId, kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: { tree: { projects: [personal(), workspace()] } },
  }));
  await page.route("**/api/projects/prj_workspace/collections", async (route) => {
    const body = route.request().postDataJSON() as { name: string; parentId?: string };
    const id = body.name === "Parent" ? "col_parent" : "col_child";
    const created = collection(
      id,
      body.name,
      workspaceCollections.filter((item) => item.parentId === (body.parentId || null)).length,
      body.parentId || null,
    );
    workspaceCollections = [...workspaceCollections, created];
    await route.fulfill({ json: { collection: created }, status: 201 });
  });
  await page.route("**/api/collections/col_child", async (route) => {
    const method = route.request().method();
    if (method === "PATCH") {
      const body = route.request().postDataJSON() as { name: string };
      workspaceCollections = workspaceCollections.map((item) => item.id === "col_child"
        ? { ...item, name: body.name, updatedAt: "2026-08-18T01:00:00.000Z" }
        : item);
      await route.fulfill({ json: { collection: workspaceCollections.find((item) => item.id === "col_child") } });
      return;
    }
    if (method === "DELETE") {
      inbox = { ...inbox, sessions: [nestedCapture] };
      workspaceCollections = workspaceCollections.filter((item) => item.id !== "col_child");
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: { error: "not found" }, status: 404 });
  });
  await page.route("**/api/collections/col_parent", async (route) => {
    if (route.request().method() === "DELETE") {
      workspaceCollections = workspaceCollections
        .filter((item) => item.id !== "col_parent")
        .map((item) => item.parentId === "col_parent" ? { ...item, parentId: null, position: 0 } : item);
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: { error: "not found" }, status: 404 });
  });

  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Workspace" }).first()).toBeVisible();
  await openWorkspaceSidebar(page, "New collection");
  await page.getByRole("button", { name: "New collection" }).click();
  let dialog = page.getByRole("dialog", { name: "New collection" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Parent");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).not.toBeVisible();
  await openWorkspaceSidebar(page, "Parent");
  await expect(page.getByRole("button", { exact: true, name: "Parent" })).toBeVisible();

  await openButtonMenu(page, "Parent: Collection actions");
  await chooseButtonMenuItem(page, "Parent: Collection actions", "New collection");
  dialog = page.getByRole("dialog", { name: "New nested collection" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Child");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).not.toBeVisible();
  await openWorkspaceSidebar(page, "Child");
  await expect(page.getByRole("button", { exact: true, name: "Child" })).toBeVisible();
  const childCollection = page.locator('[data-collection-id="col_child"]');
  await expect(childCollection).toHaveAttribute("data-collection-depth", "1");
  await expect(childCollection.locator("[data-collection-guide]")).toHaveCount(1);
  expect(workspaceCollections.find((item) => item.id === "col_child")?.parentId).toBe("col_parent");
  if (!isMobileViewport(page)) {
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByRole("link", { name: "Parent" })).toBeVisible();
    await expect(breadcrumb.getByText("Child", { exact: true })).toBeVisible();
    await breadcrumb.getByRole("link", { name: "Parent" }).click();
    await expect(breadcrumb.getByRole("link", { name: "Parent" })).toHaveCount(0);
    await expect(breadcrumb.getByText("Parent", { exact: true })).toBeVisible();
  }

  await openButtonMenu(page, "Child: Collection actions");
  await chooseButtonMenuItem(page, "Child: Collection actions", "Rename");
  dialog = page.getByRole("dialog", { name: "Rename collection" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Child review");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).not.toBeVisible();
  await openWorkspaceSidebar(page, "Child review");
  await expect(page.getByRole("button", { exact: true, name: "Child review" })).toBeVisible();

  workspaceCollections = workspaceCollections.map((item) => item.id === "col_child"
    ? { ...item, sessions: [nestedCapture] }
    : item);
  await page.reload();
  await openWorkspaceSidebar(page, "Child review");
  await page.getByRole("button", { exact: true, name: "Child review" }).click();
  await expect(page.getByText("Nested capture", { exact: true })).toBeVisible();
  if (!isMobileViewport(page)) {
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByRole("link", { name: "Parent" })).toBeVisible();
    await expect(breadcrumb.getByText("Child review", { exact: true })).toBeVisible();
  }

  await openWorkspaceSidebar(page, "Parent");
  const collapseParent = page.getByRole("button", { name: "Collapse Parent" });
  await collapseParent.press("Enter");
  await expect(page.getByRole("button", { exact: true, name: "Child review" })).toHaveCount(0);
  await page.getByRole("button", { name: "Expand Parent" }).press("Enter");
  await expect(page.getByRole("button", { exact: true, name: "Child review" })).toBeVisible();

  await closeWorkspaceSidebar(page);
  await page.getByRole("button", { name: "Workspace" }).first().click();
  await page.getByRole("menuitem", { name: "Personal" }).click();
  await openWorkspaceSidebar(page, "Inbox");
  await openButtonMenu(page, "Inbox: Collection actions");
  await expect(page.getByRole("menuitem", { name: "Remove" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await closeWorkspaceSidebar(page);
  await page.getByRole("button", { name: "Personal" }).first().click();
  await page.getByRole("menuitem", { name: "Workspace" }).click();
  await openWorkspaceSidebar(page, "Parent");

  await openButtonMenu(page, "Parent: Collection actions");
  await chooseButtonMenuItem(page, "Parent: Collection actions", "Remove");
  let confirm = page.getByRole("alertdialog", { name: "Delete collection" });
  await expect(confirm).toContainText("sessions will move to Personal / Inbox");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm).not.toBeVisible();
  await openWorkspaceSidebar(page, "Child review");
  await expect(page.getByRole("button", { exact: true, name: "Parent" })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Child review" })).toBeVisible();
  expect(workspaceCollections.find((item) => item.id === "col_child")?.parentId).toBeNull();
  await page.getByRole("button", { exact: true, name: "Child review" }).click();
  if (!isMobileViewport(page)) {
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByRole("link", { name: "Parent" })).toHaveCount(0);
    await expect(breadcrumb.getByText("Child review", { exact: true })).toBeVisible();
  }

  await openButtonMenu(page, "Child review: Collection actions");
  await chooseButtonMenuItem(page, "Child review: Collection actions", "Remove");
  confirm = page.getByRole("alertdialog", { name: "Delete collection" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm).not.toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Child review" })).toHaveCount(0);

  await closeWorkspaceSidebar(page);
  await page.getByRole("button", { name: "Workspace" }).first().click();
  await page.getByRole("menuitem", { name: "Personal" }).click();
  await openWorkspaceSidebar(page, "Inbox");
  await page.getByRole("button", { exact: true, name: "Inbox" }).click();
  await expect(page.getByText("Nested capture", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nested capture", { exact: true })).toBeVisible();
});
