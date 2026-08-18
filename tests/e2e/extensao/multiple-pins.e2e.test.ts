import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = (file: string) => resolve(process.cwd(), "extension", file);

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Extension multiple pins fixture</title>
    <style>
      body { font: 16px/1.4 sans-serif; margin: 0; padding: 140px 48px; }
      main { display: grid; grid-template-columns: repeat(4, 180px); gap: 32px; }
      button { height: 96px; border: 1px solid #94a3b8; border-radius: 12px; background: #f8fafc; }
    </style>
  </head>
  <body>
    <main>
      <button id="target-a">Alpha target</button>
      <button id="target-b">Beta target</button>
      <button id="target-c">Gamma target</button>
      <button id="target-d">Draft target</button>
    </main>
  </body>
</html>`;

async function installExtensionHarness(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
  await page.route("**/extension-fixture", (route) => route.fulfill({
    body: fixture,
    contentType: "text/html",
  }));
  await page.goto("/extension-fixture");
  await page.evaluate(() => {
    const runtimeState = { clipboard: "", messages: [] as unknown[], pins: [] as unknown[] };
    (globalThis as any).__pinarRuntimeState = runtimeState;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          runtimeState.clipboard = value;
        },
      },
    });
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
          if (message.type === "capture") return { ok: true, shot: "data:image/png;base64,cGluYXI=" };
          if (message.type === "clipboard") {
            return {
              ok: true,
              plain: message.pins.map((pin: any) => pin.comment).join("\n"),
              viewerUrl: "/v/captured-e2e",
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
  });
  await page.addScriptTag({ path: extensionPath("coordinates.js") });
  await page.addScriptTag({ path: extensionPath("keyboard.js") });
  await page.addScriptTag({ path: extensionPath("content.js") });
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
}

async function createPin(page: Page, target: string, comment: string) {
  const bounds = await page.locator(target).boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const composer = page.locator('[data-pinar="host"] [data-ref="composer"]');
  await expect(composer).toBeVisible();
  await composer.locator("textarea").fill(comment);
  await composer.getByRole("button", { name: "Add" }).click();
}

async function pinSnapshot(page: Page) {
  return page.locator('[data-pinar="host"] [data-pin]').evaluateAll((markers) => markers.map((marker) => ({
    color: marker.querySelector("path")?.getAttribute("fill"),
    number: marker.querySelector(".marker-n")?.textContent,
  })));
}

test("power user edits, deletes, clears and preserves pin order through the viewer", async ({ page }) => {
  await installExtensionHarness(page);

  await createPin(page, "#target-a", "Alpha comment");
  await createPin(page, "#target-b", "Beta comment");
  await createPin(page, "#target-c", "Gamma comment");
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(3);
  const original = await pinSnapshot(page);
  expect(original.map(({ number }) => number)).toEqual(["1", "2", "3"]);
  expect(new Set(original.map(({ color }) => color)).size).toBe(3);

  await page.locator('[data-pinar="host"] [data-pin]').nth(1).click();
  const composer = page.locator('[data-pinar="host"] [data-ref="composer"]');
  await expect(composer.locator("textarea")).toHaveValue("Beta comment");
  await composer.locator("textarea").fill("Beta comment edited");
  await composer.getByRole("button", { name: "Add" }).click();
  await page.locator('[data-pinar="host"] [data-pin]').nth(1).click();
  await expect(composer.locator("textarea")).toHaveValue("Beta comment edited");
  await composer.getByRole("button", { name: "Cancel" }).click();

  await page.locator('[data-pinar="host"] [data-pin]').first().click();
  await composer.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(2);
  const afterDelete = await pinSnapshot(page);
  expect(afterDelete.map(({ number }) => number)).toEqual(["1", "2"]);
  expect(afterDelete.map(({ color }) => color)).toEqual([original[1]?.color, original[2]?.color]);

  const draftBounds = await page.locator("#target-d").boundingBox();
  expect(draftBounds).not.toBeNull();
  if (draftBounds) {
    await page.mouse.move(draftBounds.x + 20, draftBounds.y + 20);
    await page.mouse.click(draftBounds.x + 20, draftBounds.y + 20);
  }
  await composer.locator("textarea").fill("This draft must disappear");
  await page.keyboard.press("Escape");
  await expect(composer).toBeHidden();
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-pinar="host"]')).toBeHidden();
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(0);

  await page.evaluate(() => (globalThis as any).__pinarToggle());
  await createPin(page, "#target-c", "First bundled comment");
  await createPin(page, "#target-a", "Second bundled comment");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator('[data-pinar="host"]')).toBeHidden();

  const clipboardMessage = await page.evaluate(() => {
    const messages = (globalThis as any).__pinarRuntimeState.messages as any[];
    return messages.findLast((message) => message.type === "clipboard");
  });
  expect(clipboardMessage.pins.map((pin: any) => pin.comment)).toEqual([
    "First bundled comment",
    "Second bundled comment",
  ]);
  expect(clipboardMessage.pins.map((pin: any) => pin.color)).toHaveLength(2);

  await page.route("**/api/sessions/captured-e2e", (route) => route.fulfill({
    json: {
      session: {
        createdAt: "2026-08-18T02:00:00.000Z",
        id: "captured-e2e",
        page: { title: "Captured extension order", url: "https://example.test/review" },
        pins: clipboardMessage.pins.map((pin: any, index: number) => ({
          ...pin,
          areaBox: pin.kind === "area" ? pin.box : undefined,
          coords: pin.anchor,
          number: index + 1,
          type: pin.kind === "area" ? "area" : "point",
        })),
        shotId: "captured-e2e",
        shotUrl: "/shots/captured-e2e.svg",
      },
    },
  }));
  await page.route("**/shots/captured-e2e.svg", (route) => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#e2e8f0"/></svg>',
    contentType: "image/svg+xml",
  }));
  await page.goto("/v/captured-e2e");
  const pinCards = page.locator("aside").getByTitle(/Open pin/);
  await expect(pinCards).toHaveCount(2);
  await pinCards.nth(0).click();
  await expect(page.locator('[data-slot="dialog-content"]')).toContainText("First bundled comment");
  await page.getByRole("button", { name: "Close" }).click();
  await pinCards.nth(1).click();
  await expect(page.locator('[data-slot="dialog-content"]')).toContainText("Second bundled comment");
});
