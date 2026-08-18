import { expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    __pinarE2EClipboard?: string;
  }
}

export async function installClipboardHarness(page: Page) {
  await page.addInitScript(() => {
    window.__pinarE2EClipboard = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => window.__pinarE2EClipboard || "",
        writeText: async (value: string) => {
          window.__pinarE2EClipboard = String(value);
        },
      },
    });
  });
}

export async function readClipboardHarness(page: Page) {
  return page.evaluate(() => window.__pinarE2EClipboard || "");
}

export function isMobileViewport(page: Page) {
  return (page.viewportSize()?.width || 0) < 768;
}

export async function openPrimaryNavigation(page: Page) {
  const trigger = page.getByRole("button", { name: "Primary navigation" });
  if (await trigger.isVisible()) await trigger.click();
}

export async function primaryNavigationItem(page: Page, name: string) {
  await openPrimaryNavigation(page);
  return isMobileViewport(page)
    ? page.getByRole("menuitem", { exact: true, name })
    : page.getByRole("link", { exact: true, name });
}

export async function openWorkspaceSidebar(page: Page, visibleControl: string) {
  const target = page.getByRole("button", { exact: true, name: visibleControl });
  if (await target.isVisible()) return;

  if (!isMobileViewport(page)) {
    await expect(target).toBeVisible();
    return;
  }

  const mobileSidebar = page.locator('[data-mobile="true"]');
  const toggle = page.getByRole("button", { exact: true, name: /^(Collections|Coleções)$/ });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await target.isVisible()) break;
    if (await mobileSidebar.isVisible()) await page.keyboard.press("Escape");
    await expect(toggle).toBeVisible();
    await toggle.click();
    try {
      await target.waitFor({ state: "visible", timeout: 2_000 });
      break;
    } catch {
      // A completed tree refresh remounts the mobile Sheet. Reopen the current tree.
    }
  }

  await expect(target).toBeVisible();
  await mobileSidebar.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
}

export async function closeWorkspaceSidebar(page: Page) {
  if (!isMobileViewport(page)) return;
  const mobileSidebar = page.locator('[data-mobile="true"]');
  if (await mobileSidebar.isVisible()) await page.keyboard.press("Escape");
}

export async function openButtonMenu(page: Page, name: string) {
  const menu = page.getByRole("menu", { name });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openWorkspaceSidebar(page, name);
    const trigger = page.getByRole("button", { name });

    try {
      await trigger.click({ timeout: 2_000 });
      await expect(menu).toBeVisible({ timeout: 2_000 });
      return;
    } catch {
      if (await menu.isVisible()) return;
      // A tree refresh can replace the mobile Sheet between visibility and action.
    }
  }

  await expect(menu).toBeVisible();
}

export async function chooseButtonMenuItem(page: Page, menuName: string, itemName: string) {
  const menu = page.getByRole("menu", { name: menuName });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await menu.isVisible())) await openButtonMenu(page, menuName);
    const item = menu.getByRole("menuitem", { name: itemName });

    try {
      await item.click({ timeout: 2_000 });
      return;
    } catch {
      // A tree refresh can close and replace the mobile Sheet and its menu.
    }
  }

  await menu.getByRole("menuitem", { name: itemName }).click();
}
