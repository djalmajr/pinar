import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  closeWorkspaceSidebar,
  isMobileViewport,
  openWorkspaceSidebar,
} from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";
const ownerId = "ins_tree_reorder";

function collection(
  id: string,
  name: string,
  projectId: string,
  position: number,
  parentId: string | null = null,
  isProtected = false,
) {
  return {
    createdAt,
    id,
    isProtected,
    name,
    ownerId,
    parentId,
    position,
    projectId,
    sessions: [],
    updatedAt: createdAt,
  };
}

function project(id: string, name: string, position: number, collections: ReturnType<typeof collection>[]) {
  return {
    collections,
    createdAt,
    icon: "folder-kanban",
    id,
    isProtected: id === "prj_personal",
    name,
    ownerId,
    position,
    updatedAt: createdAt,
  };
}

async function drag(source: Locator, target: Locator, deltaX = 0) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Collection drag target is not visible");
  const page = source.page();

  if (isMobileViewport(page)) {
    await expect(source).toHaveAttribute("aria-roledescription", "sortable");
    await source.press("Space");
    await expect(source).toHaveAttribute("aria-pressed", "true");
    if (deltaX !== 0) {
      await source.press(deltaX > 0 ? "ArrowRight" : "ArrowLeft");
    } else {
      const direction = targetBox.y < sourceBox.y ? "ArrowUp" : "ArrowDown";
      const steps = Math.max(1, Math.round(Math.abs(targetBox.y - sourceBox.y) / sourceBox.height));
      for (let step = 0; step < steps; step += 1) await source.press(direction);
    }
    await source.press("Space");
    await expect(source).not.toHaveAttribute("aria-pressed", "true");
    return;
  }

  const sourcePoint = {
    x: sourceBox.x + Math.min(28, sourceBox.width / 2),
    y: sourceBox.y + sourceBox.height / 2,
  };
  const targetPoint = {
    x: targetBox.x + Math.min(28, targetBox.width / 2) + deltaX,
    y: targetBox.y + targetBox.height / 2,
  };
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoint.x + Math.sign(deltaX || 1) * 8, sourcePoint.y, { steps: 3 });
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 12 });
  await page.mouse.up();
}

function collectionButton(page: Page, name: string) {
  return page.locator('[data-sidebar="content"]')
    .getByRole("button", { exact: true, name });
}

test("project actions and collection drag persist order, hierarchy, protection and subtrees", async ({ page }) => {
  let projects = [
    project("prj_personal", "Personal", 0, [
      collection("col_inbox", "Inbox", "prj_personal", 0, null, true),
    ]),
    project("prj_alpha", "Alpha", 1, [
      collection("col_root_a", "Root A", "prj_alpha", 0),
      collection("col_child_a", "Child A", "prj_alpha", 0, "col_root_a"),
      collection("col_root_b", "Root B", "prj_alpha", 1),
      collection("col_root_c", "Root C", "prj_alpha", 2),
    ]),
    project("prj_beta", "Beta", 2, []),
  ];
  let collectionReorderCalls = 0;

  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-tree-reorder-ready")) return;
    localStorage.clear();
    localStorage.setItem("pinar-selected-project", "prj_beta");
    sessionStorage.setItem("pinar-tree-reorder-ready", "true");
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: ownerId, kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({ json: { tree: { projects } } }));
  await page.route("**/api/projects/reorder", async (route) => {
    const { ids } = route.request().postDataJSON() as { ids: string[] };
    const byId = new Map(projects.map((item) => [item.id, item]));
    projects = ids.flatMap((id, position) => {
      const item = byId.get(id);
      return item ? [{ ...item, position }] : [];
    });
    await route.fulfill({ json: { ok: true, projects } });
  });
  await page.route("**/api/projects/prj_alpha/collections/reorder", async (route) => {
    const { items } = route.request().postDataJSON() as {
      items: Array<{ id: string; parentId: string | null }>;
    };
    collectionReorderCalls += 1;
    const alpha = projects.find(({ id }) => id === "prj_alpha");
    expect(alpha).toBeTruthy();
    const byId = new Map(alpha!.collections.map((item) => [item.id, item]));
    const siblingPositions = new Map<string | null, number>();
    alpha!.collections = items.flatMap(({ id, parentId }) => {
      const item = byId.get(id);
      if (!item) return [];
      const position = siblingPositions.get(parentId) || 0;
      siblingPositions.set(parentId, position + 1);
      return [{ ...item, parentId, position }];
    });
    await route.fulfill({ json: { ok: true, collections: alpha!.collections } });
  });

  await page.goto("/app");

  await page.getByRole("button", { name: "Beta: Project actions" }).click();
  await page.getByRole("menuitem", { name: "Move earlier" }).click();
  await page.getByRole("button", { name: "Beta: Project actions" }).click();
  await page.getByRole("menuitem", { name: "Move earlier" }).click();

  await page.reload();
  await page.getByRole("button", { exact: true, name: "Beta" }).click();
  const projectItems = page.getByRole("menu").getByRole("menuitem");
  await expect(projectItems.nth(0)).toContainText("Beta");
  await expect(projectItems.nth(1)).toContainText("Personal");
  await expect(projectItems.nth(2)).toContainText("Alpha");
  await projectItems.nth(2).click();
  await openWorkspaceSidebar(page, "Root A");

  const rootA = collectionButton(page, "Root A");
  const childA = collectionButton(page, "Child A");
  const rootB = collectionButton(page, "Root B");
  const rootC = collectionButton(page, "Root C");

  await drag(rootC, rootA);
  await expect.poll(() => collectionReorderCalls).toBe(1);
  await expect(rootC).toHaveAttribute("style", /padding-inline-start: 8px/);

  await page.reload();
  await openWorkspaceSidebar(page, "Root C");
  await expect(collectionButton(page, "Root C")).toBeVisible();
  await expect(collectionButton(page, "Root A")).toBeVisible();

  if (isMobileViewport(page)) {
    await closeWorkspaceSidebar(page);
    await page.getByRole("button", { exact: true, name: "Alpha" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Personal" }).click();
    await openWorkspaceSidebar(page, "Inbox");
    await expect(collectionButton(page, "Inbox")).not.toHaveAttribute("aria-roledescription", "sortable");
    await expect.poll(() => collectionReorderCalls).toBe(1);
    return;
  }

  await drag(collectionButton(page, "Root B"), collectionButton(page, "Root B"), 24);
  await expect.poll(() => collectionReorderCalls).toBe(2);
  await expect(collectionButton(page, "Root B")).toHaveAttribute("style", /padding-inline-start: 26px/);

  await drag(collectionButton(page, "Root B"), collectionButton(page, "Root B"), -24);
  await expect.poll(() => collectionReorderCalls).toBe(3);
  await expect(collectionButton(page, "Root B")).toHaveAttribute("style", /padding-inline-start: 8px/);

  await drag(collectionButton(page, "Root A"), collectionButton(page, "Root B"));
  await expect.poll(() => collectionReorderCalls).toBe(4);
  await expect(collectionButton(page, "Child A")).toHaveAttribute("style", /padding-inline-start: 26px/);

  await closeWorkspaceSidebar(page);
  await page.getByRole("button", { exact: true, name: "Alpha" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Personal" }).click();
  await openWorkspaceSidebar(page, "Inbox");
  const beforeProtectedDrag = collectionReorderCalls;
  await drag(collectionButton(page, "Inbox"), collectionButton(page, "Inbox"), 36);
  await expect.poll(() => collectionReorderCalls).toBe(beforeProtectedDrag);
  await expect(collectionButton(page, "Inbox")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { exact: true, name: "Personal" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Alpha" }).click();
  await openWorkspaceSidebar(page, "Child A");
  await expect(collectionButton(page, "Child A")).toHaveAttribute("style", /padding-inline-start: 26px/);
  await expect(collectionButton(page, "Root B")).toHaveAttribute("style", /padding-inline-start: 8px/);
});
