import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = (file: string) => resolve(process.cwd(), "extension", file);

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Batch fixture</title>
    <style>
      body { font: 16px/1.4 sans-serif; margin: 0; padding: 140px 48px; }
      button { height: 64px; width: 180px; }
    </style>
  </head>
  <body>
    <main>
      <button id="save">Save changes</button>
    </main>
  </body>
</html>`;

async function installHarness(page: Page, batchLabel: string) {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
  await page.route("**/batch-fixture*", (route) => route.fulfill({
    body: fixture,
    contentType: "text/html",
  }));
  await page.goto("/batch-fixture");
  await page.evaluate((label) => {
    // Only the messages the overlay sends while idle; the batch itself lives
    // in the service worker, so the label is all the toolbar ever reads.
    const chromeStub = {
      runtime: {
        sendMessage: async (message: { type?: string }) => {
          if (message.type === "batch:get") return { label, ok: true };
          if (message.type === "pins:sync" || message.type === "pins:list") return { ok: true, pins: [] };
          return { ok: true };
        },
      },
    };
    Object.assign(globalThis, { chrome: chromeStub });
  }, batchLabel);
  await page.addScriptTag({ path: extensionPath("coordinates.js") });
  await page.addScriptTag({ path: extensionPath("frame-path.js") });
  await page.addScriptTag({ path: extensionPath("locators.js") });
  await page.addScriptTag({ path: extensionPath("privacy.js") });
  await page.addScriptTag({ path: extensionPath("keyboard.js") });
  await page.addScriptTag({ path: extensionPath("content.js") });
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
}

const toolbarStatus = '[data-pinar="host"] [data-ref="toolbarStatus"]';

test("mirrors the open batch count in the toolbar", async ({ page }) => {
  await installHarness(page, "Batch: 2");
  await expect(page.locator(toolbarStatus)).toHaveText("Batch: 2");
});

test("stays quiet when no batch is open", async ({ page }) => {
  await installHarness(page, "");
  await expect(page.locator(toolbarStatus)).toBeHidden();
});

test("lets the review banner win the shared status slot", async ({ page }) => {
  await installHarness(page, "Batch: 2");
  await expect(page.locator(toolbarStatus)).toHaveText("Batch: 2");

  await page.evaluate(() => {
    const showUnavailable = Reflect.get(globalThis, "__pinarShowUnavailable");
    if (typeof showUnavailable === "function") showUnavailable("expired");
  });

  await expect(page.locator(toolbarStatus)).toHaveText("Original page is unavailable");
  await expect(page.locator(toolbarStatus)).toHaveAttribute("data-kind", "error");
});
