import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = (file: string) => resolve(process.cwd(), "extension", file);

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Toolbar modal fixture</title>
  </head>
  <body>
    <button id="open-modal" type="button">Open modal</button>
    <dialog id="site-dialog">
      <p>Site modal</p>
      <button id="close-modal" type="button">Close</button>
    </dialog>
    <script>
      const dialog = document.getElementById("site-dialog");
      document.getElementById("open-modal").addEventListener("click", () => dialog.showModal());
      document.getElementById("close-modal").addEventListener("click", () => dialog.close());
    </script>
  </body>
</html>`;

const scripts = [
  "coordinates.js",
  "frame-path.js",
  "locators.js",
  "privacy.js",
  "keyboard.js",
  "floating.js",
  "voice.js",
  "content.js",
];

async function installExtensionHarness(page: Page) {
  await page.route("**/toolbar-modal-fixture", (route) => route.fulfill({
    body: fixture,
    contentType: "text/html",
  }));
  await page.goto("/toolbar-modal-fixture");
  await page.evaluate(() => {
    const listeners: Array<(message: unknown, sender: unknown, sendResponse: () => void) => void> = [];
    (globalThis as { __pinarEmitRuntimeMessage?: (message: unknown) => void }).__pinarEmitRuntimeMessage = (message) => {
      for (const listener of listeners) listener(message, {}, () => undefined);
    };
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        onMessage: {
          addListener(fn: (message: unknown, sender: unknown, sendResponse: () => void) => void) {
            listeners.push(fn);
          },
        },
        sendMessage: async () => ({ ok: true }),
      },
    };
  });
  for (const file of scripts) {
    await page.addScriptTag({ path: extensionPath(file) });
  }
}

async function openAndCloseModal(page: Page) {
  await page.locator("#open-modal").click();
  await expect(page.locator("#site-dialog")).toBeVisible();
  await page.locator("#close-modal").click();
  await expect(page.locator("#site-dialog")).toBeHidden();
}

test("a hidden toolbar stays hidden across a site modal, a re-render, and content reinjection", async ({ page }) => {
  await installExtensionHarness(page);
  const overlay = page.locator('[data-pinar="host"]');
  await expect(overlay).toBeVisible();

  await page.evaluate(() => { (globalThis as { __pinarSetHidden?: (hidden: boolean) => void }).__pinarSetHidden?.(true); });
  await expect(overlay).toBeHidden();
  await page.evaluate(() => { (globalThis as { __pinarSetHidden?: (hidden: boolean) => void }).__pinarSetHidden?.(false); });
  await expect(overlay).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await page.evaluate(() => { (globalThis as { __pinarSetHidden?: (hidden: boolean) => void }).__pinarSetHidden?.(false); });
  await expect(overlay).toBeHidden();

  await openAndCloseModal(page);
  await page.evaluate(() => {
    history.pushState({}, "", "/rerendered");
    document.body.classList.add("spa-rerender");
  });
  await page.addScriptTag({ path: extensionPath("content.js") });
  await expect(overlay).toBeHidden();

  await page.evaluate(() => { (globalThis as { __pinarToggle?: () => void }).__pinarToggle?.(); });
  await expect(overlay).toBeVisible();

  await page.evaluate(() => {
    (globalThis as { __pinarEmitRuntimeMessage?: (message: unknown) => void }).__pinarEmitRuntimeMessage?.({
      feedback: "finished",
      type: "review:ended",
    });
  });
  await expect(overlay).toBeHidden();
  await openAndCloseModal(page);
  await page.addScriptTag({ path: extensionPath("content.js") });
  await expect(overlay).toBeHidden();

  await page.evaluate(() => { (globalThis as { __pinarToggle?: () => void }).__pinarToggle?.(); });
  await expect(overlay).toBeVisible();
});
