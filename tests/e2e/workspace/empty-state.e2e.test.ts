import { expect, test } from "@playwright/test";
import {
  closeWorkspaceSidebar,
  isMobileViewport,
  openWorkspaceSidebar,
} from "../helpers/ui";

const createdAt = "2026-08-18T00:00:00.000Z";

test.beforeEach(async ({ page }) => {
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

test("first use keeps the protected tree, both views and an actionable extension path", async ({ page }) => {
  await page.goto("/app");

  await expect(page.getByRole("heading", { name: "No annotation sessions found" })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Personal" })).toBeVisible();
  await openWorkspaceSidebar(page, "Inbox");
  await expect(page.getByRole("button", { exact: true, name: "Inbox" })).toBeVisible();
  await closeWorkspaceSidebar(page);

  await page.getByRole("button", { name: "Table view" }).click();
  await expect(page.getByRole("heading", { name: "No annotation sessions found" })).toBeVisible();
  await page.getByRole("button", { name: "Grid view" }).click();
  await expect(page.getByRole("heading", { name: "No annotation sessions found" })).toBeVisible();

  const setup = page.getByRole("link", { name: "Set up the extension" });
  await expect(setup).toHaveAttribute("href", "https://github.com/djalmajr/pinar#load-the-extension");
  await page.context().route("https://github.com/djalmajr/pinar", (route) => route.fulfill({
    body: "<title>Pinar extension guide</title><main>Load the extension</main>",
    contentType: "text/html",
  }));
  const guidePromise = page.waitForEvent("popup");
  await setup.click();
  const guide = await guidePromise;
  await expect(guide).toHaveURL("https://github.com/djalmajr/pinar#load-the-extension");
  await expect(guide.getByText("Load the extension")).toBeVisible();
  await guide.close();
});

test("preferences persist and the account trigger survives the active sidebar layout", async ({ page }) => {
  await page.goto("/app");

  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: "Português" }).click();
  await expect(page.getByRole("heading", { name: "Nenhuma sessão de anotação encontrada" })).toBeVisible();

  await page.getByRole("button", { name: "Alternar tema" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nenhuma sessão de anotação encontrada" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  if (isMobileViewport(page)) {
    await openWorkspaceSidebar(page, "Inbox");
    const accountMenu = page.locator('[data-mobile="true"]')
      .getByRole("button", { name: "Menu da conta" });
    await expect(accountMenu).toBeVisible();
    await accountMenu.click();
    await expect(page.getByRole("menuitem", { name: "Assinar o Pro" })).toBeVisible();
    await page.keyboard.press("Escape");
    await closeWorkspaceSidebar(page);
    await expect(page.getByRole("heading", { name: "Nenhuma sessão de anotação encontrada" })).toBeVisible();
    return;
  }

  const sidebarPanel = page.locator('[data-slot="resizable-panel"]').first();
  await expect.poll(async () => (await sidebarPanel.boundingBox())?.width || 0).toBeGreaterThan(190);
  await page.locator("header").getByRole("button", { name: "Coleções" }).click();
  await expect.poll(async () => (await sidebarPanel.boundingBox())?.width || 999).toBeLessThan(60);

  const accountMenu = page.locator('[data-sidebar="footer"]')
    .getByRole("button", { name: "Menu da conta" });
  await expect(accountMenu).toBeVisible();
  await accountMenu.click();
  await expect(page.getByRole("menuitem", { name: "Assinar o Pro" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator("header").getByRole("button", { name: "Coleções" }).click();
  await expect.poll(async () => (await sidebarPanel.boundingBox())?.width || 0).toBeGreaterThan(190);
});

test("mobile sidebar opens, exposes the user panel and returns focus to the workspace", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/app");

  const toggle = page.getByRole("button", { exact: true, name: "Collections" });
  await expect(page.getByRole("button", { exact: true, name: "Inbox" })).toBeHidden();
  await toggle.click();
  await expect(page.getByRole("button", { exact: true, name: "Inbox" })).toBeVisible();

  await page.locator('[data-mobile="true"]')
    .getByRole("button", { name: "Account menu" })
    .click();
  await expect(page.getByRole("menuitem", { name: "Upgrade to Pro" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await expect(page.getByRole("button", { exact: true, name: "Inbox" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "No annotation sessions found" })).toBeVisible();
});
