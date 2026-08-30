import { expect, test, type Page } from "@playwright/test";
import {
  installClipboardHarness,
  openWorkspaceSidebar,
  readClipboardHarness,
} from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";
const ownerId = "ins_session_operations";

function session(id: string, title: string, collectionId: string, position: number) {
  return {
    collectionId,
    createdAt: new Date(Date.parse(createdAt) + position * 1_000).toISOString(),
    id,
    page: { title, url: `https://example.test/${id}` },
    pins: [{ comment: `${title} feedback`, coords: { x: 10, y: 20 }, number: 1, type: "point" }],
    position,
    shotId: id,
    shotUrl: `/shots/${id}.svg`,
    viewerUrl: `/v/${id}.md`,
  };
}

function card(page: Page, title: string) {
  return page.locator('[data-slot="card"]').filter({ hasText: title }).first();
}

function openSessionMenu(page: Page) {
  return page.locator('[role="menu"][data-open]').filter({
    has: page.getByRole("menuitem", { exact: true, name: "View" }),
  });
}

test("move, manual order, copy and confirmed deletion remain precise and persistent", async ({ page }) => {
  await installClipboardHarness(page);
  const moved = session("session_moved", "Moved capture", "col_a", 0);
  const second = session("session_second", "Second capture", "col_b", 0);
  const third = session("session_third", "Third capture", "col_b", 1);
  let collectionA = [moved];
  let collectionB = [second, third];
  const deleted = new Set<string>();

  const tree = () => ({
    projects: [{
      collections: [
        { createdAt, id: "col_a", isProtected: false, name: "Collection A", ownerId, parentId: null, position: 0, projectId: "prj_workspace", sessions: collectionA, updatedAt: createdAt },
        { createdAt, id: "col_b", isProtected: false, name: "Collection B", ownerId, parentId: null, position: 1, projectId: "prj_workspace", sessions: collectionB, updatedAt: createdAt },
      ],
      createdAt,
      icon: "folder-kanban",
      id: "prj_workspace",
      isProtected: false,
      name: "Workspace",
      ownerId,
      position: 0,
      updatedAt: createdAt,
    }],
  });
  const allSessions = () => [...collectionA, ...collectionB];

  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-session-operations-ready")) return;
    localStorage.clear();
    localStorage.setItem("pinar-selected-project", "prj_workspace");
    sessionStorage.setItem("pinar-session-operations-ready", "true");
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: ownerId, kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({ json: { tree: tree() } }));
  await page.route("**/api/sessions/session_moved/move", async (route) => {
    const { collectionId } = route.request().postDataJSON() as { collectionId: string };
    expect(collectionId).toBe("col_b");
    collectionA = collectionA.filter(({ id }) => id !== moved.id);
    collectionB = [...collectionB, { ...moved, collectionId: "col_b", position: collectionB.length }];
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/collections/col_b/sessions/reorder", async (route) => {
    const { ids } = route.request().postDataJSON() as { ids: string[] };
    const byId = new Map(collectionB.map((item) => [item.id, item]));
    collectionB = ids.flatMap((id, position) => {
      const item = byId.get(id);
      return item ? [{ ...item, position }] : [];
    });
    await route.fulfill({ json: { ok: true, sessions: collectionB } });
  });
  await page.route("**/api/history/*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }
    const id = new URL(route.request().url()).pathname.split("/").pop() || "";
    deleted.add(id);
    collectionA = collectionA.filter((item) => item.id !== id);
    collectionB = collectionB.filter((item) => item.id !== id).map((item, position) => ({ ...item, position }));
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/sessions/*", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/move")) {
      await route.fallback();
      return;
    }
    const id = pathname.split("/").pop() || "";
    const item = allSessions().find((candidate) => candidate.id === id);
    await route.fulfill(item && !deleted.has(id)
      ? { json: { session: item } }
      : { json: { error: "Session not found" }, status: 404 });
  });
  await page.route("**/shots/*.svg", (route) => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><text x="20" y="40">Session</text></svg>',
    contentType: "image/svg+xml",
  }));

  await page.goto("/app");
  await openWorkspaceSidebar(page, "Collection A");
  await page.getByRole("button", { exact: true, name: "Collection A" }).click();
  await card(page, "Moved capture").getByRole("button", { name: "More session actions" }).click();
  await openSessionMenu(page)
    .getByText("Workspace / Collection B", { exact: true })
    .click();
  await expect(page.getByText("Moved capture", { exact: true })).toHaveCount(0);

  await openWorkspaceSidebar(page, "Collection B");
  await page.getByRole("button", { exact: true, name: "Collection B" }).click();
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(["Second capture", "Third capture", "Moved capture"]);
  for (let move = 0; move < 2; move += 1) {
    await card(page, "Moved capture").getByRole("button", { name: "More session actions" }).click();
    await openSessionMenu(page).getByRole("menuitem", { name: "Move earlier" }).click();
  }
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(["Moved capture", "Second capture", "Third capture"]);

  await page.reload();
  await openWorkspaceSidebar(page, "Collection B");
  await page.getByRole("button", { exact: true, name: "Collection B" }).click();
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(["Moved capture", "Second capture", "Third capture"]);

  await card(page, "Moved capture").getByRole("button", { name: "More session actions" }).click();
  await expect(openSessionMenu(page).getByRole("menuitem", { name: "Review on page" })).toBeVisible();
  await openSessionMenu(page).getByRole("menuitem", { exact: true, name: "View" }).click();
  await expect(page.getByRole("heading", { name: "Moved capture" })).toBeVisible();
  await page.goBack();
  await openWorkspaceSidebar(page, "Collection B");
  await page.getByRole("button", { exact: true, name: "Collection B" }).click();
  await card(page, "Moved capture").getByRole("button", { name: "More session actions" }).click();
  await openSessionMenu(page).getByRole("menuitem", { name: "Copy prompt" }).click();
  const copied = await readClipboardHarness(page);
  expect(copied).toContain("Moved capture feedback");
  expect(copied).toContain("/v/session_moved.md");

  await card(page, "Second capture").getByRole("button", { name: "More session actions" }).click();
  await openSessionMenu(page).getByRole("menuitem", { name: "Delete session" }).click();
  let confirm = page.getByRole("alertdialog", { name: "Delete this annotation session?" });
  await expect(confirm).toContainText("The screenshot and its pins will be permanently removed.");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Second capture", { exact: true })).toBeVisible();

  await card(page, "Second capture").getByRole("button", { name: "More session actions" }).click();
  await openSessionMenu(page).getByRole("menuitem", { name: "Delete session" }).click();
  confirm = page.getByRole("alertdialog", { name: "Delete this annotation session?" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Second capture", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Moved capture", { exact: true })).toBeVisible();
  await expect(page.getByText("Third capture", { exact: true })).toBeVisible();

  await page.goto("/v/session_second");
  await expect(page.getByRole("heading", { name: "Annotation session not found" })).toBeVisible();
});
