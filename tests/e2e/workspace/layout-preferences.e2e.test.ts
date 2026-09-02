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

test("global settings and viewer navigation preserve language, theme, and capture preferences", async ({ page }) => {
  let includeScreenshot = true;
  let handoffMode: "compact" | "full" = "compact";
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
  await page.route("**/api/preferences", async (route) => {
    if (route.request().method() === "PATCH") {
      const body: unknown = route.request().postDataJSON();
      if (typeof body === "object" && body !== null && "includeScreenshot" in body) {
        includeScreenshot = body.includeScreenshot !== false;
      }
      if (typeof body === "object" && body !== null && "handoffMode" in body) {
        handoffMode = body.handoffMode === "full" ? "full" : "compact";
      }
    }
    await route.fulfill({ json: { handoffMode, includeScreenshot, ok: true } });
  });
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
  const gridViewTab = page.getByRole("tab", { name: "Grid view" });
  const tableViewTab = page.getByRole("tab", { name: "Table view" });
  await expect(gridViewTab).toHaveAttribute("aria-selected", "true");
  await expect(tableViewTab).toHaveAttribute("aria-selected", "false");
  await tableViewTab.click();
  await expect(tableViewTab).toHaveAttribute("aria-selected", "true");
  await gridViewTab.click();
  await expect(gridViewTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("header").getByRole("button", { exact: true, name: "Settings" })).toHaveCount(0);
  await openWorkspaceSidebar(page, "Settings");
  const settingsButton = page.locator('[data-sidebar="footer"]')
    .getByRole("button", { exact: true, name: "Settings" });
  await expect(settingsButton).toHaveText("Settings");
  await settingsButton.click();
  const settingsDialog = page.locator('[data-slot="dialog-content"]');
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("button", { name: "General", exact: true })).toHaveText("General");
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Português" }).click();
  await page.getByRole("button", { exact: true, name: "Captura" }).click();
  const detailSwitch = page.getByRole("switch", { name: "Detalhamento da cópia para IA" });
  await expect(detailSwitch).not.toBeChecked();
  await detailSwitch.click();
  await expect(detailSwitch).toBeChecked();
  const screenshotSwitch = page.getByRole("switch", { name: "Incluir captura no copy para agentes" });
  await expect(screenshotSwitch).toBeChecked();
  await screenshotSwitch.click();
  await expect(screenshotSwitch).not.toBeChecked();
  await page.getByRole("button", { exact: true, name: "Interface" }).click();
  const darkThemeTab = page.getByRole("tab", { name: "Escuro" });
  await darkThemeTab.click();
  await expect(darkThemeTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const closeSettings = page.getByRole("button", { name: "Fechar configurações" });
  await expect.poll(() => closeSettings.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
  await closeSettings.click();
  await expect(settingsDialog).toBeHidden();
  await expect(page.locator("[data-dashboard-scroll-area] > [data-slot=scroll-area-scrollbar]")).toBeHidden();

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
  await expect(page.locator("header").getByRole("button", { exact: true, name: "Configurações" })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "pt");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openWorkspaceSidebar(page, "Configurações");
  await page.locator('[data-sidebar="footer"]')
    .getByRole("button", { exact: true, name: "Configurações" })
    .click();
  await page.getByRole("button", { exact: true, name: "Captura" }).click();
  await expect(page.getByRole("switch", { name: "Detalhamento da cópia para IA" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Incluir captura no copy para agentes" })).not.toBeChecked();
});
