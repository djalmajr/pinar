import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectScrollableComboboxList,
  isMobileViewport,
  openWorkspaceSidebar,
} from "../helpers/ui";

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

async function drag(source: Locator, target: Locator, whileDragging?: () => Promise<void>) {
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
  await whileDragging?.();
  await page.mouse.up();
}

function collectionButton(page: Page, name: string) {
  return page.locator('[data-sidebar="content"]').getByRole("button", { exact: true, name });
}

function sessionTitle(page: Page, name: string) {
  return page.getByText(name, { exact: true });
}

async function selectCollection(page: Page, name: string) {
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openWorkspaceSidebar(page, name);
    await collectionButton(page, name).click();
    if (isMobileViewport(page)) return;
    try {
      await expect(breadcrumb).toContainText(name, { timeout: 2_000 });
      return;
    } catch {
      // A large project-tree refresh can replace the sidebar between pointer down and navigation.
    }
  }
  await expect(breadcrumb).toContainText(name);
}

test("selected sessions move by drag and drop from table and grid views", async ({ page }) => {
  const alpha = session("session_alpha", "Alpha capture", "col_a", 0);
  const beta = session("session_beta", "Beta capture", "col_a", 1);
  const gamma = session("session_gamma", "Gamma capture", "col_b", 0);
  let collectionA = [alpha, beta];
  let collectionB = [gamma];
  const deleted = new Set<string>();
  const scaleProjectId = "prj_scale_00";
  const scaleWorkspaceName = "Scale workspace 00 — Product design and research operations";
  const scaleCollectionName = (index: number) => `Scale collection ${String(index).padStart(2, "0")} — ${index % 2 ? "International customer experience" : "UX"}`;
  const scaleCollections = Array.from({ length: 48 }, (_, index) => ({
    createdAt,
    id: `col_scale_${index}`,
    isProtected: false,
    name: scaleCollectionName(index),
    ownerId,
    parentId: index % 6 === 0 ? null : `col_scale_${index - 1}`,
    position: index,
    projectId: scaleProjectId,
    sessions: [],
    updatedAt: createdAt,
  }));
  const scaleWorkspaces = Array.from({ length: 36 }, (_, index) => {
    const projectId = `prj_scale_${String(index).padStart(2, "0")}`;
    return {
      collections: index === 0 ? scaleCollections : [{
        createdAt,
        id: `col_workspace_${index}`,
        isProtected: false,
        name: `Workspace ${index} collection`,
        ownerId,
        parentId: null,
        position: 0,
        projectId,
        sessions: [],
        updatedAt: createdAt,
      }],
      createdAt,
      icon: "folder-kanban",
      id: projectId,
      isProtected: false,
      name: index === 0
        ? scaleWorkspaceName
        : `Scale workspace ${String(index).padStart(2, "0")} — ${index % 2 ? "International operations" : "UX"}`,
      ownerId,
      position: index + 2,
      updatedAt: createdAt,
    };
  });

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
          parentId: "col_a",
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
    }, {
      collections: [{
        createdAt,
        id: "col_c",
        isProtected: false,
        name: "Collection C",
        ownerId,
        parentId: null,
        position: 0,
        projectId: "prj_other",
        sessions: [],
        updatedAt: createdAt,
      }],
      createdAt,
      icon: "folder-kanban",
      id: "prj_other",
      isProtected: false,
      name: "Other workspace",
      ownerId,
      position: 1,
      updatedAt: createdAt,
    }, ...scaleWorkspaces],
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
  await selectCollection(page, "Collection A");
  await expect(sessionTitle(page, "Alpha capture")).toBeVisible();

  const alphaRow = page.locator('[data-session-id="session_alpha"]');
  await expect(page.getByRole("columnheader", { name: "Drag" })).toHaveCount(0);
  await expect(page.locator("[data-session-drag-handle]")).toHaveCount(0);
  expect(await alphaRow.evaluate((element) => getComputedStyle(element).cursor)).toBe("auto");
  await expect(alphaRow.getByRole("button", { name: "Copy prompt" })).toBeVisible();
  await alphaRow.getByRole("button", { name: "More session actions" }).click();
  const sessionMenu = page.getByRole("menu");
  await expect(sessionMenu.getByRole("menuitem", { name: "Move to…" })).toBeVisible();
  await expect(sessionMenu.getByRole("menuitem", { name: "Copy prompt" })).toHaveCount(0);
  await sessionMenu.getByRole("menuitem", { name: "Move to…" }).click();
  const individualMoveDialog = page.getByRole("dialog", { name: "Move to…" });
  await expect(individualMoveDialog.getByText("Choose the destination workspace and collection.")).toBeVisible();
  const workspaceCombobox = individualMoveDialog.getByRole("combobox", { name: "Workspace" });
  await expect(workspaceCombobox).toHaveValue("Workspace");
  await workspaceCombobox.click();
  await expectScrollableComboboxList(page);
  await workspaceCombobox.fill("Scale workspace 00");
  await expect(page.getByRole("option", { name: "Workspace", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: scaleWorkspaceName }).click();
  const collectionCombobox = individualMoveDialog.getByRole("combobox", { name: "Collection" });
  await expect(collectionCombobox).toHaveValue("");
  await collectionCombobox.click();
  await expectScrollableComboboxList(page);
  await collectionCombobox.fill("Scale collection 47");
  const deepCollection = page.getByRole("option", { name: scaleCollectionName(47) });
  await expect(deepCollection).toBeVisible();
  await expect(deepCollection.locator(":scope > span").first()).toHaveCSS("padding-inline-start", "80px");
  await page.keyboard.press("Escape");
  await individualMoveDialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("checkbox", { name: "Select Alpha capture" }).click();
  await page.getByRole("checkbox", { name: "Select Beta capture" }).click();
  await expect(page.locator("[data-bulk-toolbar]")).not.toContainText("2 selected");
  await expect(page.getByText("Drag any selected session to a collection.")).toHaveCount(0);
  const bulkToolbar = page.locator("[data-bulk-toolbar]");
  await expect(bulkToolbar.getByRole("button", { name: "Move to…" })).toBeVisible();
  await expect(bulkToolbar.getByRole("button", { name: "Delete" })).toHaveClass(/border-destructive/);
  await expect(bulkToolbar.getByRole("button", { name: "Clear selection" })).toHaveClass(/border-transparent/);
  const tableBox = await page.getByRole("table").boundingBox();
  const selectedCountBox = await page.locator("[data-selected-count]").boundingBox();
  expect(tableBox).toBeTruthy();
  expect(selectedCountBox).toBeTruthy();
  expect(selectedCountBox!.y).toBeGreaterThanOrEqual(tableBox!.y + tableBox!.height);
  if (isMobileViewport(page)) return;
  const tableViewport = page.getByRole("table").locator("xpath=ancestor::*[@data-slot='scroll-area-viewport'][1]");
  const tableScrollWidth = await tableViewport.evaluate((viewport) => viewport.scrollWidth);
  await drag(alphaRow.locator("td").nth(2), collectionButton(page, "Collection B"), async () => {
    const overlay = page.locator("[data-session-drag-overlay]");
    await expect(overlay).toContainText("Alpha capture");
    await expect(overlay).toContainText("2 selected");
    expect(await page.evaluate(() => document.body.style.cursor)).toBe("grabbing");
    expect(await tableViewport.evaluate((viewport) => viewport.scrollWidth)).toBe(tableScrollWidth);
  });
  expect(await page.evaluate(() => document.body.style.cursor)).toBe("");
  await expect(sessionTitle(page, "Alpha capture")).toHaveCount(0);
  await expect(sessionTitle(page, "Beta capture")).toHaveCount(0);

  await selectCollection(page, "Collection B");
  await expect(sessionTitle(page, "Gamma capture")).toBeVisible();
  await expect(sessionTitle(page, "Alpha capture")).toBeVisible();
  await expect(sessionTitle(page, "Beta capture")).toBeVisible();

  await page.getByRole("checkbox", { name: "Select Gamma capture" }).click();
  await page.getByRole("checkbox", { name: "Select Alpha capture" }).click();
  await page.locator("[data-bulk-toolbar]").getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete 2 annotation sessions?" });
  await expect(confirm).toContainText("The screenshots and pins will be permanently removed.");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(sessionTitle(page, "Gamma capture")).toHaveCount(0);
  await expect(sessionTitle(page, "Alpha capture")).toHaveCount(0);
  await expect(sessionTitle(page, "Beta capture")).toBeVisible();
  expect([...deleted].sort()).toEqual(["session_alpha", "session_gamma"]);

  await selectCollection(page, "Collection B");
  await drag(
    page.locator('[data-session-id="session_beta"] td').nth(2),
    collectionButton(page, "Collection A"),
  );
  await expect(sessionTitle(page, "Beta capture")).toHaveCount(0);
  await page.getByRole("searchbox").click();
  await selectCollection(page, "Collection A");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Collection A");
  await expect(sessionTitle(page, "Beta capture")).toBeVisible();

  await page.getByRole("tab", { name: "Grid view" }).click();
  await expect(page.locator('[data-session-id="session_beta"]')).not.toHaveCSS("cursor", "grab");
  await drag(
    page.locator('[data-session-id="session_beta"] [data-slot="card-header"]'),
    collectionButton(page, "Collection B"),
  );
  await expect(sessionTitle(page, "Beta capture")).toHaveCount(0);
  await page.getByRole("searchbox").click();
  await selectCollection(page, "Collection B");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Collection B");
  await expect(page.getByRole("heading", { name: "Beta capture" })).toBeVisible();
});
