import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = (file: string) => resolve(process.cwd(), "extension", file);

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Handoff fixture</title>
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

async function installHarness(page: Page, { failCapture = false } = {}) {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
  await page.route("**/handoff-fixture*", (route) => route.fulfill({
    body: fixture,
    contentType: "text/html",
  }));
  await page.goto("/handoff-fixture");
  await page.evaluate((shouldFailCapture) => {
    const runtimeState = { clipboard: "", messages: [] as unknown[], pins: [] as unknown[] };
    (globalThis as any).__pinarRuntimeState = runtimeState;
    (globalThis as any).__pinarFailCapture = shouldFailCapture;
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (message: any) => {
          runtimeState.messages.push(structuredClone(message));
          if (message.type === "pins:sync") {
            runtimeState.pins = structuredClone(message.pins);
            return { ok: true, pins: structuredClone(runtimeState.pins) };
          }
          if (message.type === "pins:list") return { ok: true, pins: structuredClone(runtimeState.pins) };
          if (message.type === "pins:refresh") return { ok: true };
          if (message.type === "capture") {
            if ((globalThis as any).__pinarFailCapture) return { ok: false, error: "capture failed" };
            return { ok: true, shot: "data:image/png;base64,cGluYXI=" };
          }
          if (message.type === "clipboard") {
            const warnings = message.shot ? [] : ["screenshot_missing"];
            return {
              degraded: warnings.length > 0,
              ok: true,
              plain: "copied",
              warnings,
            };
          }
          if (message.type === "pins:clear") {
            runtimeState.pins = [];
            return { ok: true };
          }
          return { ok: true };
        },
      },
    };
  }, failCapture);
  await page.addScriptTag({ path: extensionPath("coordinates.js") });
  await page.addScriptTag({ path: extensionPath("frame-path.js") });
  await page.addScriptTag({ path: extensionPath("locators.js") });
  await page.addScriptTag({ path: extensionPath("privacy.js") });
  await page.addScriptTag({ path: extensionPath("keyboard.js") });
  await page.addScriptTag({ path: extensionPath("content.js") });
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
}

async function createPin(page: Page, target: string, comment: string) {
  const bounds = await page.locator(target).boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const composer = page.locator('[data-pinar="host"] [data-ref="composer"]');
  await expect(composer).toBeVisible();
  await composer.locator("textarea").fill(comment);
  await composer.getByRole("button", { name: "Add" }).click();
}

test("complete copy keeps captureId and pinId without editing the bundle", async ({ page }) => {
  await installHarness(page);
  await createPin(page, "#save", "Make the CTA bolder");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator('[data-pinar="host"] [data-ref="status"]')).toHaveText("Copied");
  await expect(page.locator('[data-pinar="host"]')).toBeHidden();

  const clipboardMessage = await page.evaluate(() => {
    const messages = (globalThis as any).__pinarRuntimeState.messages as any[];
    return messages.findLast((message) => message.type === "clipboard");
  });
  expect(clipboardMessage.captureId).toBeTruthy();
  expect(clipboardMessage.pins[0].pinId || clipboardMessage.pins[0].id).toBeTruthy();
  expect(clipboardMessage.pins[0].comment).toBe("Make the CTA bolder");
  expect(clipboardMessage.shot).toBeTruthy();
});

test("screenshot failure still copies comment and DOM context", async ({ page }) => {
  await installHarness(page, { failCapture: true });
  await createPin(page, "#save", "Still useful without pixels");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator('[data-pinar="host"] [data-ref="status"]')).toContainText("no screenshot");
  await expect(page.locator('[data-pinar="host"]')).toBeHidden();

  const clipboardMessage = await page.evaluate(() => {
    const messages = (globalThis as any).__pinarRuntimeState.messages as any[];
    return messages.findLast((message) => message.type === "clipboard");
  });
  expect(clipboardMessage.captureId).toBeTruthy();
  expect(clipboardMessage.shot == null || clipboardMessage.shot === "").toBe(true);
  expect(clipboardMessage.pins[0].comment).toBe("Still useful without pixels");
  expect(clipboardMessage.pins[0].path || clipboardMessage.pins[0].selector).toBeTruthy();
});
