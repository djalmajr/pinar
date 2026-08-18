import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  closeWorkspaceSidebar,
  isMobileViewport,
  openWorkspaceSidebar,
} from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";

async function dragSeparator(page: Page, separator: Locator, targetX: number) {
  const box = await separator.boundingBox();
  if (!box) throw new Error("Sidebar separator is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("resizer limits and viewer navigation preserve language and theme", async ({ page }) => {
  const capture = {
    collectionId: "col_preferences",
    createdAt,
    id: "session_preferences",
    page: { title: "Preference capture", url: "https://example.test/preferences" },
    pins: [{ comment: "Keep my workspace preferences", coords: { x: 20, y: 30 }, number: 1, type: "point" }],
    position: 0,
    shotId: "shot_preferences",
    shotUrl: "/shots/shot_preferences.svg",
    viewerUrl: "/v/session_preferences.md",
  };

  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-layout-preferences-ready")) return;
    localStorage.clear();
    localStorage.setItem("pinar-selected-project", "prj_preferences");
    sessionStorage.setItem("pinar-layout-preferences-ready", "true");
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: "ins_preferences", kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [{
          collections: [{
            createdAt,
            id: "col_preferences",
            isProtected: false,
            name: "Preferences",
            ownerId: "ins_preferences",
            parentId: null,
            position: 0,
            projectId: "prj_preferences",
            sessions: [capture],
            updatedAt: createdAt,
          }],
          createdAt,
          icon: "settings",
          id: "prj_preferences",
          isProtected: false,
          name: "Workspace",
          ownerId: "ins_preferences",
          position: 0,
          updatedAt: createdAt,
        }],
      },
    },
  }));
  await page.route("**/api/sessions/session_preferences", (route) => route.fulfill({
    json: { session: capture },
  }));
  await page.route("**/shots/shot_preferences.svg", (route) => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><text x="20" y="40">Preferences</text></svg>',
    contentType: "image/svg+xml",
  }));

  await page.goto("/app");
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: "Português" }).click();
  await page.getByRole("button", { name: "Alternar tema" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  if (isMobileViewport(page)) {
    await openWorkspaceSidebar(page, "Preferences");
    await closeWorkspaceSidebar(page);
  } else {
    const panel = page.locator('[data-slot="resizable-panel"]').first();
    const separator = page.locator('[data-slot="resizable-handle"]');

    await dragSeparator(page, separator, 900);
    await expect.poll(async () => (await panel.boundingBox())?.width || 0).toBeGreaterThanOrEqual(447);
    await expect.poll(async () => (await panel.boundingBox())?.width || 999).toBeLessThanOrEqual(449);

    await dragSeparator(page, separator, 192);
    await expect.poll(async () => (await panel.boundingBox())?.width || 0).toBeGreaterThanOrEqual(191);
    await expect.poll(async () => (await panel.boundingBox())?.width || 999).toBeLessThanOrEqual(193);
  }

  await page.getByRole("img", { name: "Preference capture" }).click();
  await expect(page.getByRole("heading", { name: "Preference capture" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goBack();
  await expect(page.getByText("Preference capture", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.getByRole("button", { name: "Idioma" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
