import { expect, test, type Locator, type Page } from "@playwright/test";
import { isMobileViewport, openWorkspaceSidebar } from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";
const ownerId = "ins_listing_organize";

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

async function drag(source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Drag target is not visible");
  const page = source.page();
  const sourcePoint = {
    x: sourceBox.x + Math.min(48, sourceBox.width / 2),
    y: sourceBox.y + sourceBox.height / 2,
  };
  const targetPoint = {
    x: targetBox.x + Math.min(28, targetBox.width / 2),
    y: targetBox.y + targetBox.height / 2,
  };
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoint.x + 8, sourcePoint.y, { steps: 3 });
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 12 });
  await page.mouse.up();
}

function collectionButton(page: Page, name: string) {
  return page.locator('[data-sidebar="content"]').getByRole("button", { exact: true, name });
}

test("checkboxes move and delete in bulk, and a row can be dropped on a folder", async ({ page }) => {
  const alpha = session("session_alpha", "Alpha capture", "col_a", 0);
  const beta = session("session_beta", "Beta capture", "col_a", 1);
  const gamma = session("session_gamma", "Gamma capture", "col_b", 0);
  let collectionA = [alpha, beta];
  let collectionB = [gamma];
  const deleted = new Set<string>();

  const tree = () => ({
    projects: [{
      collections: [
        {
          createdAt,
          id: "col_a",
          isProtected: false,
          name: "Collection A",
          ownerId,
          parentId: null,
          position: 0,
          projectId: "prj_workspace",
          sessions: collectionA,
          updatedAt: createdAt,
        },
        {
          createdAt,
          id: "col_b",
          isProtected: false,
          name: "Collection B",
          ownerId,
          parentId: null,
          position: 1,
          projectId: "prj_workspace",
          sessions: collectionB,
          updatedAt: createdAt,
        },
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

  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-listing-organize-ready")) return;
    localStorage.clear();
    localStorage.setItem("pinar-selected-project", "prj_workspace");
    localStorage.setItem("pinar-history-view", "table");
    sessionStorage.setItem("pinar-listing-organize-ready", "true");
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: ownerId, kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({ json: { tree: tree() } }));
  await page.route("**/api/sessions/*/move", async (route) => {
    const sessionId = new URL(route.request().url()).pathname.split("/")[3] || "";
    const { collectionId } = route.request().postDataJSON() as { collectionId: string };
    const moving = [...collectionA, ...collectionB].find((item) => item.id === sessionId);
    expect(moving).toBeTruthy();
    collectionA = collectionA.filter(({ id }) => id !== sessionId);
    collectionB = collectionB.filter(({ id }) => id !== sessionId);
    if (moving && collectionId === "col_a") {
      collectionA = [...collectionA, { ...moving, collectionId: "col_a", position: collectionA.length }];
    } else if (moving) {
      collectionB = [...collectionB, { ...moving, collectionId: "col_b", position: collectionB.length }];
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/history/*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }
    const id = new URL(route.request().url()).pathname.split("/").pop() || "";
    deleted.add(id);
    collectionA = collectionA.filter((item) => item.id !== id);
    collectionB = collectionB.filter((item) => item.id !== id);
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/shots/*.svg", (route) => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><text x="20" y="40">Session</text></svg>',
    contentType: "image/svg+xml",
  }));

  await page.goto("/app");
  await openWorkspaceSidebar(page, "Collection A");
  await page.getByRole("button", { exact: true, name: "Collection A" }).click();
  await expect(page.getByRole("link", { name: "Alpha capture" })).toBeVisible();

  await page.getByRole("checkbox", { name: "Select Alpha capture" }).click();
  await page.getByRole("checkbox", { name: "Select Beta capture" }).click();
  await expect(page.locator("[data-bulk-toolbar]")).toContainText("2 selected");
  await page.getByRole("button", { name: "Move to collection" }).click();
  await page.getByRole("menuitem", { name: "Workspace / Collection B" }).click();
  await expect(page.getByRole("link", { name: "Alpha capture" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Beta capture" })).toHaveCount(0);

  await page.getByRole("button", { exact: true, name: "Collection B" }).click();
  await expect(page.getByRole("link", { name: "Gamma capture" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alpha capture" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Beta capture" })).toBeVisible();

  await page.getByRole("checkbox", { name: "Select Gamma capture" }).click();
  await page.getByRole("checkbox", { name: "Select Alpha capture" }).click();
  await page.locator("[data-bulk-toolbar]").getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete 2 annotation sessions?" });
  await expect(confirm).toContainText("The screenshots and pins will be permanently removed.");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: "Gamma capture" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Alpha capture" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Beta capture" })).toBeVisible();
  expect([...deleted].sort()).toEqual(["session_alpha", "session_gamma"]);

  if (isMobileViewport(page)) return;

  await page.getByRole("button", { exact: true, name: "Collection B" }).click();
  await drag(
    page.locator('[data-session-id="session_beta"]'),
    collectionButton(page, "Collection A"),
  );
  await expect(page.getByRole("link", { name: "Beta capture" })).toHaveCount(0);
  await page.getByRole("searchbox").click();
  await collectionButton(page, "Collection A").click();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Collection A");
  await expect(page.getByRole("link", { name: "Beta capture" })).toBeVisible();
});
