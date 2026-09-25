import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { pressCopyShortcut } from "../helpers/extension-shortcut";

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

const iframeFixture = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Iframe path fixture</title></head>
  <body><iframe id="workspace-shell" src="https://shell.pinar.test/middle"></iframe></body>
</html>`;

const middleFrameFixture = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Middle frame</title></head>
  <body><iframe id="application-frame" src="https://app.pinar.test/child"></iframe></body>
</html>`;

const childFrameFixture = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Child frame</title></head>
  <body><main><button id="iframe-target">New project</button></main></body>
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
    const messageListeners: any[] = [];
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
        onMessage: {
          addListener: (fn: any) => { messageListeners.push(fn); },
        },
        sendMessage: async (message: any) => {
          runtimeState.messages.push(structuredClone(message));
          if (message.type === "review:finish") {
            runtimeState.messages.push({ type: "clipboard", pins: structuredClone(runtimeState.pins) });
            for (const listener of messageListeners) listener({ type: "review:ended", feedback: "finished" }, {}, () => {});
            return { ok: true };
          }
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
  await page.addScriptTag({ path: extensionPath("frame-path.js") });
  await page.addScriptTag({ path: extensionPath("locators.js") });
  await page.addScriptTag({ path: extensionPath("privacy.js") });
  await page.addScriptTag({ path: extensionPath("keyboard.js") });
  await page.addScriptTag({ path: extensionPath("floating.js") });
  await page.addScriptTag({ path: extensionPath("voice.js") });
  await page.addScriptTag({ path: extensionPath("content.js") });
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
}

async function installIframeExtensionHarness(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
    const runtimeState = { messages: [] as unknown[], pins: [] as unknown[] };
    const messageListeners: any[] = [];
    (globalThis as any).__pinarRuntimeState = runtimeState;
    (globalThis as any).__pinarMessageListeners = messageListeners;
    (globalThis as any).chrome = {
      runtime: {
        onMessage: {
          addListener: (fn: any) => { messageListeners.push(fn); },
        },
        sendMessage: async (message: any) => {
          runtimeState.messages.push(structuredClone(message));
          if (message.type === "pins:sync") {
            runtimeState.pins = structuredClone(message.pins);
            return { ok: true, pins: structuredClone(runtimeState.pins) };
          }
          return { ok: true, pins: structuredClone(runtimeState.pins) };
        },
      },
    };
  });
  await page.route("**/iframe-path-fixture", (route) => route.fulfill({
    body: iframeFixture,
    contentType: "text/html",
  }));
  await page.route("https://shell.pinar.test/middle", (route) => route.fulfill({
    body: middleFrameFixture,
    contentType: "text/html",
  }));
  await page.route("https://app.pinar.test/child", (route) => route.fulfill({
    body: childFrameFixture,
    contentType: "text/html",
  }));
  await page.goto("/iframe-path-fixture");
  await expect.poll(() => page.frames().length).toBe(3);
  for (const frame of page.frames()) {
    await frame.addScriptTag({ path: extensionPath("coordinates.js") });
    await frame.addScriptTag({ path: extensionPath("frame-path.js") });
    await frame.addScriptTag({ path: extensionPath("locators.js") });
    await frame.addScriptTag({ path: extensionPath("privacy.js") });
    await frame.addScriptTag({ path: extensionPath("keyboard.js") });
    await frame.addScriptTag({ path: extensionPath("floating.js") });
    await frame.addScriptTag({ path: extensionPath("voice.js") });
    await frame.addScriptTag({ path: extensionPath("content.js") });
  }
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

test("mask shortcut highlights only its key without shifting the toolbar", async ({ page }) => {
  await installExtensionHarness(page);
  const hint = page.locator('[data-pinar="host"] [data-hint="mask"]');
  const nextHint = page.locator('[data-pinar="host"] [data-hint="regions"]');
  const beforeHint = await hint.boundingBox();
  const beforeNext = await nextHint.boundingBox();
  expect(beforeHint).not.toBeNull();
  expect(beforeNext).not.toBeNull();
  await expect(hint).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await page.keyboard.press("m");

  await expect(hint).toHaveAttribute("data-active", "");
  await expect(hint).toHaveCSS("background-color", "rgb(243, 247, 255)");
  await expect(hint.locator("kbd")).toHaveCSS("background-color", "rgb(232, 240, 255)");
  await expect(hint.locator("kbd")).toHaveCSS("border-top-color", "rgb(31, 90, 166)");
  await expect(hint.locator(".long")).toHaveCSS("color", "rgb(23, 74, 154)");
  await expect(hint.locator(".long")).toHaveCSS("font-weight", "400");
  const afterHint = await hint.boundingBox();
  const afterNext = await nextHint.boundingBox();
  expect(afterHint?.width).toBe(beforeHint?.width);
  expect(afterNext?.x).toBe(beforeNext?.x);
});

test("reopening the toolbar on a client-side route drops the previous page's markers", async ({ page }) => {
  await installExtensionHarness(page);
  await createPin(page, "#target-a", "First page comment");
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(1);

  await page.evaluate(() => {
    history.pushState({}, "", "/next-page");
    document.querySelector("main")!.innerHTML = '<button id="next-target">Next page target</button>';
    (globalThis as any).__pinarToggle();
    (globalThis as any).__pinarToggle();
  });

  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(0);
  await createPin(page, "#next-target", "Second page comment");
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(1);
});
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
  expect(afterDelete.map(({ number }) => number)).toEqual(["2", "3"]);
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
  await expect(page.locator('[data-pinar="host"] [data-pin]').first()).toBeHidden();

  await page.evaluate(() => {
    history.pushState({}, "", "/next-review-page");
    (globalThis as any).__pinarToggle();
  });
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(0);
  await createPin(page, "#target-c", "First bundled comment");
  await createPin(page, "#target-a", "Second bundled comment");
  await pressCopyShortcut(page);
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
  await expect(page.getByRole("dialog", { name: "Pin 1" })).toContainText("First bundled comment");
  await page.getByRole("dialog", { name: "Pin 1" }).getByRole("button", { name: "Close" }).click();
  await pinCards.nth(1).click();
  await expect(page.getByRole("dialog", { name: "Pin 2" })).toContainText("Second bundled comment");
});

test("a pin inside nested cross-origin iframes keeps the complete DOM path", async ({ page }) => {
  await installIframeExtensionHarness(page);
  const childFrame = page.frames().find((frame) => frame.url() === "https://app.pinar.test/child");
  expect(childFrame).toBeDefined();
  if (!childFrame) return;

  const target = childFrame.locator("#iframe-target");
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const composer = childFrame.locator('[data-pinar="host"] [data-ref="composer"]');
  await composer.locator("textarea").fill("Keep the frame chain");
  await composer.getByRole("button", { name: "Add" }).click();

  await expect.poll(async () => {
    const pins = await childFrame.evaluate(() => (globalThis as any).__pinarRuntimeState?.pins ?? []);
    return pins.length;
  }).toBe(1);
  const [pin] = await childFrame.evaluate(() => (globalThis as any).__pinarRuntimeState.pins);
  expect(pin.path).toBe(
    "body > iframe#workspace-shell ::frame:: body > iframe#application-frame ::frame:: body > main > button#iframe-target",
  );
});

test("navigation drops markers in nested cross-origin iframes via broadcast", async ({ page }) => {
  await installIframeExtensionHarness(page);
  const childFrame = page.frames().find((frame) => frame.url() === "https://app.pinar.test/child");
  expect(childFrame).toBeDefined();
  if (!childFrame) return;

  const target = childFrame.locator("#iframe-target");
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const composer = childFrame.locator('[data-pinar="host"] [data-ref="composer"]');
  await composer.locator("textarea").fill("Pin before navigation");
  await composer.getByRole("button", { name: "Add" }).click();

  await expect(childFrame.locator('[data-pinar="host"] [data-pin]')).toHaveCount(1);

  // Trigger client-side navigation on top page; clearNavigationPins broadcasts FRAME_CLEAR to iframes
  await page.evaluate(() => {
    history.pushState({}, "", "/client-navigated-nested");
    (globalThis as any).__pinarToggle();
    (globalThis as any).__pinarToggle();
  });

  await expect(childFrame.locator('[data-pinar="host"] [data-pin]')).toHaveCount(0);
});
test("review:navigated drops markers in nested cross-origin iframes via broadcast", async ({ page }) => {
  await installIframeExtensionHarness(page);
  const childFrame = page.frames().find((frame) => frame.url() === "https://app.pinar.test/child");
  expect(childFrame).toBeDefined();
  if (!childFrame) return;

  const target = childFrame.locator("#iframe-target");
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const composer = childFrame.locator('[data-pinar="host"] [data-ref="composer"]');
  await composer.locator("textarea").fill("Pin before review:navigated");
  await composer.getByRole("button", { name: "Add" }).click();

  await expect(childFrame.locator('[data-pinar="host"] [data-pin]')).toHaveCount(1);

  // Dispatch review:navigated on the top window; clearNavigationPins broadcasts FRAME_CLEAR to child iframes
  await page.evaluate(() => {
    for (const listener of (globalThis as any).__pinarMessageListeners || []) {
      listener({ type: "review:navigated" }, {}, () => {});
    }
  });

  await expect(childFrame.locator('[data-pinar="host"] [data-pin]')).toHaveCount(0);
});

test("SPA route navigation and return immediately clears markers and prevents pin resurrection", async ({ page }) => {
  await installExtensionHarness(page);

  // 1. Create Pin 1 on #target-a on /page-a
  await page.evaluate(() => history.replaceState({}, "", "/page-a"));
  await createPin(page, "#target-a", "First page comment");
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(1);

  // 2. SPA navigate via history.pushState to /page-b (mutating DOM)
  await page.evaluate(() => {
    history.pushState({}, "", "/page-b");
    document.querySelector("main")!.innerHTML = '<button id="target-b">Page B Target</button>';
  });

  // Markers from Page A disappear immediately without having to close/reopen toolbar
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(0);

  // 3. Create Pin 2 on /page-b
  await createPin(page, "#target-b", "Second page comment");
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(1);

  // Verify that the sync message for Page B did not associate Pin 1 geometry
  const syncMessages = await page.evaluate(() => {
    return ((globalThis as any).__pinarRuntimeState?.messages || [])
      .filter((m: any) => m.type === "pins:sync" && m.persist);
  });
  const lastSync = syncMessages[syncMessages.length - 1];
  expect(lastSync.pins).toHaveLength(1);
  expect(lastSync.pins[0].comment).toBe("Second page comment");

  // 4. SPA navigate back to /page-a
  await page.evaluate(() => {
    history.pushState({}, "", "/page-a");
    document.querySelector("main")!.innerHTML = '<button id="target-a">Alpha target restored</button>';
  });

  // Markers disappear immediately; does not resurrect Pin 2 or old Pin 1
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(0);

  // 5. Create Pin 3 on /page-a
  await createPin(page, "#target-a", "Third pin comment");
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(1);
  const syncMessagesAfterReturn = await page.evaluate(() => {
    return ((globalThis as any).__pinarRuntimeState?.messages || [])
      .filter((m: any) => m.type === "pins:sync" && m.persist);
  });
  const returnSync = syncMessagesAfterReturn[syncMessagesAfterReturn.length - 1];
  expect(returnSync.pins).toHaveLength(1);
  expect(returnSync.pins[0].comment).toBe("Third pin comment");
});
