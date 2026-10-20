import { expect, test } from "@playwright/test";
import { stubLocalAiSettings } from "../helpers/local-ai-settings";
import {
  closeWorkspaceSidebar,
  isMobileViewport,
  openWorkspaceAccountMenu,
  openWorkspaceSidebar,
} from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";

test.beforeEach(async ({ page }) => {
  await stubLocalAiSettings(page);
  let language = "en";
  await page.route("**/api/preferences", async (route) => {
    if (route.request().method() === "PATCH") {
      const body: unknown = route.request().postDataJSON();
      if (typeof body === "object" && body !== null && "language" in body && typeof body.language === "string") {
        language = body.language;
      }
    }
    await route.fulfill({ json: { handoffMode: "compact", includeScreenshot: true, language, ok: true } });
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("pinar-e2e-storage-ready")) return;
    localStorage.clear();
    sessionStorage.setItem("pinar-e2e-storage-ready", "true");
  });
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      session: {
        installationId: "ins_empty_workspace",
        kind: "installation",
        plan: "free",
      },
    },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [
          {
            collections: [
              {
                createdAt,
                id: "col_empty_inbox",
                isProtected: true,
                name: "Inbox",
                ownerId: "ins_empty_workspace",
                parentId: null,
                position: 0,
                projectId: "prj_empty_personal",
                sessions: [],
                updatedAt: createdAt,
              },
            ],
            createdAt,
            icon: "user-round",
            id: "prj_empty_personal",
            isProtected: true,
            name: "Personal",
            ownerId: "ins_empty_workspace",
            position: 0,
            updatedAt: createdAt,
          },
        ],
      },
    },
  }));
});

test("first use keeps the protected tree and both views without an extension CTA", async ({ page }) => {
  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "No annotation sessions found" })).toBeVisible();
  await expect(page.getByText("Use the Pinar extension to annotate a page.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Set up the extension" })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Personal" })).toBeVisible();
  await openWorkspaceSidebar(page, "Inbox");
  await expect(page.getByRole("button", { exact: true, name: "Inbox" })).toBeVisible();
  await closeWorkspaceSidebar(page);

  await page.getByRole("tab", { name: "Table view" }).click();
  await expect(page.getByRole("heading", { name: "No annotation sessions found" })).toBeVisible();
  await page.getByRole("tab", { name: "Grid view" }).click();
  await expect(page.getByRole("heading", { name: "No annotation sessions found" })).toBeVisible();
});

test("preferences persist language, theme and the collapsed sidebar", async ({ page }) => {
  await page.goto("/app");

  await openWorkspaceAccountMenu(page);
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Português" }).click();
  await page.getByRole("button", { name: "Interface", exact: true }).click();
  await page.getByRole("tab", { name: "Escuro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Fechar configurações" }).click();
  await closeWorkspaceSidebar(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nenhuma sessão de anotação encontrada" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  if (isMobileViewport(page)) {
    await openWorkspaceSidebar(page, "Caixa de entrada");
    await expect(page.getByRole("button", { exact: true, name: "Caixa de entrada" })).toBeVisible();
    await closeWorkspaceSidebar(page);
    await expect(page.getByRole("heading", { name: "Nenhuma sessão de anotação encontrada" })).toBeVisible();
    return;
  }

  const sidebarPanel = page.locator('[data-slot="resizable-panel"]').first();
  await expect.poll(async () => (await sidebarPanel.boundingBox())?.width || 0).toBeGreaterThan(190);
  await page.locator("header").getByRole("button", { name: "Coleções" }).click();
  await expect.poll(async () => (await sidebarPanel.boundingBox())?.width || 999).toBeLessThan(60);
  await page.locator("header").getByRole("button", { name: "Coleções" }).click();
  await expect.poll(async () => (await sidebarPanel.boundingBox())?.width || 0).toBeGreaterThan(190);
});

test("mobile sidebar opens collections and returns focus to the workspace", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/app");

  const toggle = page.getByRole("button", { exact: true, name: "Collections" });
  await expect(page.getByRole("button", { exact: true, name: "Inbox" })).toBeHidden();
  await toggle.click();
  await expect(page.getByRole("button", { exact: true, name: "Inbox" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("button", { exact: true, name: "Inbox" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "No annotation sessions found" })).toBeVisible();

  const workspaceTrigger = page.locator("header").getByRole("button", { exact: true, name: "Personal" });
  const box = await workspaceTrigger.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box?.width ?? Infinity).toBeLessThan((viewport?.width ?? 0) * 0.5);
});
