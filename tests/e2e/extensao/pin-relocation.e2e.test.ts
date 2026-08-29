import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = (file: string) => resolve(process.cwd(), "extension", file);

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Pin relocation fixture</title>
    <style>
      body { font: 16px/1.4 sans-serif; margin: 0; padding: 140px 48px; }
      button { height: 88px; width: 180px; margin: 16px; }
    </style>
  </head>
  <body>
    <main>
      <button id="cta" class="cta">Save changes</button>
      <button class="dup">Edit</button>
    </main>
  </body>
</html>`;

const iframeFixture = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Relocation iframe</title></head>
  <body><iframe id="app-shell" src="https://app.pinar.test/child"></iframe></body>
</html>`;

const childFrameFixture = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Child frame</title></head>
  <body><main><button id="iframe-target" class="go">New project</button></main></body>
</html>`;

async function installHarness(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
  await page.route("**/relocation-fixture", (route) => route.fulfill({
    body: fixture,
    contentType: "text/html",
  }));
  await page.goto("/relocation-fixture");
  await page.evaluate(() => {
    const runtimeState = { pins: [] as unknown[] };
    (globalThis as any).__pinarRuntimeState = runtimeState;
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (message: any) => {
          if (message.type === "pins:sync") {
            runtimeState.pins = structuredClone(message.pins);
            return { ok: true, pins: structuredClone(runtimeState.pins) };
          }
          if (message.type === "pins:list") return { ok: true, pins: structuredClone(runtimeState.pins) };
          return { ok: true };
        },
      },
    };
  });
  await page.addScriptTag({ path: extensionPath("coordinates.js") });
  await page.addScriptTag({ path: extensionPath("frame-path.js") });
  await page.addScriptTag({ path: extensionPath("locators.js") });
  await page.addScriptTag({ path: extensionPath("keyboard.js") });
  await page.addScriptTag({ path: extensionPath("content.js") });
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
}

async function installIframeHarness(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
    const runtimeState = { pins: [] as unknown[] };
    (globalThis as any).__pinarRuntimeState = runtimeState;
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (message: any) => {
          if (message.type === "pins:sync") {
            runtimeState.pins = structuredClone(message.pins);
            return { ok: true, pins: structuredClone(runtimeState.pins) };
          }
          return { ok: true, pins: structuredClone(runtimeState.pins) };
        },
      },
    };
  });
  await page.route("**/relocation-iframe-fixture", (route) => route.fulfill({
    body: iframeFixture,
    contentType: "text/html",
  }));
  await page.route("https://app.pinar.test/child", (route) => route.fulfill({
    body: childFrameFixture,
    contentType: "text/html",
  }));
  await page.goto("/relocation-iframe-fixture");
  await expect.poll(() => page.frames().length).toBe(2);
  for (const frame of page.frames()) {
    await frame.addScriptTag({ path: extensionPath("coordinates.js") });
    await frame.addScriptTag({ path: extensionPath("frame-path.js") });
    await frame.addScriptTag({ path: extensionPath("locators.js") });
    await frame.addScriptTag({ path: extensionPath("keyboard.js") });
    await frame.addScriptTag({ path: extensionPath("content.js") });
  }
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

async function expectMarkerNear(page: Page, target: string, confidence: RegExp) {
  const marker = page.locator('[data-pinar="host"] [data-pin]').first();
  await expect(marker).toHaveAttribute("data-location-confidence", confidence);
  const point = await marker.evaluate((node) => ({
    x: Number.parseFloat((node as HTMLElement).style.left),
    y: Number.parseFloat((node as HTMLElement).style.top),
  }));
  const targetBox = await page.locator(target).boundingBox();
  expect(targetBox).toBeTruthy();
  if (!targetBox) return;
  expect(Math.abs(targetBox.x + targetBox.width / 2 - point.x)).toBeLessThan(24);
  expect(Math.abs(targetBox.y + targetBox.height / 2 - point.y)).toBeLessThan(24);
}

test("relocates a pin after the target moves and its classes change", async ({ page }) => {
  await installHarness(page);
  await createPin(page, "#cta", "Keep this action");
  await page.evaluate(() => {
    const cta = document.querySelector("#cta");
    if (!cta) return;
    cta.className = "primary";
    document.body.append(cta);
  });
  await page.evaluate(() => (globalThis as any).__pinarSyncPins?.());
  await expectMarkerNear(page, "#cta", /exact|probable/);
});

test("falls back without pretending an invalid selector is exact", async ({ page }) => {
  await installHarness(page);
  await createPin(page, "#cta", "Keep this action");
  await page.evaluate(() => {
    const cta = document.querySelector("#cta");
    if (!cta) return;
    cta.removeAttribute("id");
    cta.className = "renamed";
  });
  await page.evaluate(() => (globalThis as any).__pinarSyncPins?.());
  await expectMarkerNear(page, "button.renamed", /probable/);
});

test("keeps duplicate targets as an actionable pending state", async ({ page }) => {
  await installHarness(page);
  await createPin(page, "button.dup", "Do not guess");
  await page.evaluate(() => {
    const orig = document.querySelector("button.dup");
    if (!orig?.parentElement) return;
    orig.parentElement.insertBefore(orig.cloneNode(true), orig);
  });
  await page.evaluate(() => (globalThis as any).__pinarSyncPins?.());
  const pending = page.locator('[data-pinar="host"] [data-pin]');
  await expect(pending).toHaveCount(1);
  await expect(pending).toHaveAttribute("data-location-confidence", /ambiguous|unresolved/);
  await expect(pending).toHaveClass(/is-pending/);
  await expect(pending).not.toHaveAttribute("data-location-confidence", "exact");
});

test("relocates a same-origin iframe pin after the inner target changes", async ({ page }) => {
  await installIframeHarness(page);
  const childFrame = page.frames().find((frame) => frame.url() === "https://app.pinar.test/child");
  expect(childFrame).toBeDefined();
  if (!childFrame) return;

  const target = childFrame.locator("#iframe-target");
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const composer = childFrame.locator('[data-pinar="host"] [data-ref="composer"]');
  await expect(composer).toBeVisible();
  await composer.locator("textarea").fill("Keep the frame chain");
  await composer.getByRole("button", { name: "Add" }).click();

  await childFrame.evaluate(() => {
    const button = document.querySelector("#iframe-target");
    if (!button) return;
    button.className = "primary";
  });
  await childFrame.evaluate(() => (globalThis as any).__pinarSyncPins?.());

  const marker = childFrame.locator('[data-pinar="host"] [data-pin]').first();
  await expect(marker).toHaveAttribute("data-location-confidence", /exact|probable/);
  const targetBox = await target.boundingBox();
  const markerBox = await marker.boundingBox();
  expect(targetBox && markerBox).toBeTruthy();
  if (!targetBox || !markerBox) return;
  expect(Math.abs(targetBox.x + targetBox.width / 2 - (markerBox.x + markerBox.width / 2))).toBeLessThan(40);
});
