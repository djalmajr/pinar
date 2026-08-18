import { expect, test } from "@playwright/test";
import { installClipboardHarness, readClipboardHarness } from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";
const ownerId = "ins_project_crud";

function fixtureSession() {
  return {
    collectionId: "col_client_review",
    createdAt,
    id: "session_client_checkout",
    page: { title: "Client checkout", url: "https://example.test/checkout" },
    pins: [{ comment: "Clarify the annual offer.", coords: { x: 30, y: 40 }, number: 1, type: "point" }],
    position: 0,
    shotId: "session_client_checkout",
    shotUrl: "/shots/session_client_checkout.svg",
  };
}

function protectedPersonal(sessions: ReturnType<typeof fixtureSession>[] = []) {
  return {
    collections: [{
      createdAt,
      id: "col_personal_inbox",
      isProtected: true,
      name: "Inbox",
      ownerId,
      parentId: null,
      position: 0,
      projectId: "prj_personal",
      sessions,
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
  };
}

test("project CRUD preserves sessions through public sharing and container deletion", async ({ page }) => {
  await installClipboardHarness(page);
  const capture = fixtureSession();
  let personal = protectedPersonal();
  let customProject: ReturnType<typeof protectedPersonal> | null = null;
  const requests: Array<{ body?: unknown; method: string; url: string }> = [];

  const currentTree = () => ({ projects: customProject ? [personal, customProject] : [personal] });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-project-crud-ready")) return;
    localStorage.clear();
    sessionStorage.setItem("pinar-project-crud-ready", "true");
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: ownerId, kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({ json: { tree: currentTree() } }));
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as { icon: string; name: string };
    requests.push({ body, method: "POST", url: route.request().url() });
    customProject = {
      collections: [],
      createdAt,
      icon: body.icon,
      id: "prj_client_portal",
      isProtected: false,
      name: body.name,
      ownerId,
      position: 1,
      updatedAt: createdAt,
    };
    await route.fulfill({ json: { project: customProject }, status: 201 });
  });
  await page.route("**/api/projects/prj_client_portal", async (route) => {
    const method = route.request().method();
    requests.push({
      body: route.request().postData() ? route.request().postDataJSON() : undefined,
      method,
      url: route.request().url(),
    });
    if (method === "PATCH") {
      const body = route.request().postDataJSON() as { icon: string; name: string };
      if (customProject) customProject = { ...customProject, icon: body.icon, name: body.name, updatedAt: "2026-08-18T01:00:00.000Z" };
      await route.fulfill({ json: { project: customProject } });
      return;
    }
    if (method === "DELETE") {
      personal = protectedPersonal([capture]);
      customProject = null;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: { error: "not found" }, status: 404 });
  });
  await page.route("**/api/public/projects/prj_client_portal", (route) => route.fulfill({
    json: { project: customProject },
  }));
  await page.route("**/api/sessions/session_client_checkout", (route) => route.fulfill({ json: { session: capture } }));
  await page.route("**/shots/session_client_checkout.svg", (route) => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><text x="20" y="40">Client checkout</text></svg>',
    contentType: "image/svg+xml",
  }));

  await page.goto("/app");
  await page.getByRole("button", { name: "Personal" }).first().click();
  await page.getByRole("menuitem", { name: "New project" }).click();
  const createDialog = page.getByRole("dialog", { name: "New project" });
  await createDialog.getByRole("textbox", { name: "Name" }).fill("Client portal");
  await createDialog.getByRole("searchbox", { name: "Search icons..." }).fill("rocket");
  await createDialog.getByRole("button", { name: "Rocket" }).click();
  await createDialog.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("button", { name: "Client portal" }).first()).toBeVisible();
  expect(requests[0]).toMatchObject({ body: { icon: "rocket", name: "Client portal" }, method: "POST" });

  if (!customProject) throw new Error("Project fixture was not created");
  customProject = {
    ...customProject,
    collections: [{
      createdAt,
      id: "col_client_review",
      isProtected: false,
      name: "Review",
      ownerId,
      parentId: null,
      position: 0,
      projectId: "prj_client_portal",
      sessions: [capture],
      updatedAt: createdAt,
    }],
  };
  await page.reload();
  await expect(page.getByText("Client checkout", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Client portal: Project actions" }).click();
  await page.getByRole("menuitem", { name: "Edit project" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit project" });
  await editDialog.getByRole("textbox", { name: "Name" }).fill("Checkout redesign");
  await editDialog.getByRole("searchbox", { name: "Search icons..." }).fill("telescope");
  await editDialog.getByRole("button", { name: "Telescope" }).click();
  await editDialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Checkout redesign" }).first()).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Checkout redesign: Project actions" }).click();
  await page.getByRole("menuitem", { name: "Edit project" }).click();
  await expect(page.getByRole("dialog", { name: "Edit project" }).getByRole("img", { name: "Telescope" })).toBeVisible();
  await page.getByRole("dialog", { name: "Edit project" }).getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Checkout redesign: Project actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  const shareUrl = await readClipboardHarness(page);
  expect(shareUrl).toMatch(/\/p\/prj_client_portal$/);

  await page.goto(shareUrl);
  await expect(page.getByRole("heading", { name: "Checkout redesign" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.getByText("Client checkout", { exact: true })).toBeVisible();

  await page.goto("/app");
  await page.getByRole("button", { name: "Checkout redesign: Project actions" }).click();
  await page.getByRole("menuitem", { name: "Delete project" }).click();
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete project" });
  await expect(deleteDialog).toContainText("Its sessions will move to Personal / Inbox.");
  await deleteDialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByRole("button", { name: "Checkout redesign" })).toHaveCount(0);
  await expect(page.getByText("Client checkout", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Personal" }).first()).toBeVisible();
  await expect(page.getByText("Client checkout", { exact: true })).toBeVisible();
  expect(requests.some((request) => request.method === "DELETE")).toBe(true);
});
