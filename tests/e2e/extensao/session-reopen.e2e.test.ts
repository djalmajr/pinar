import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = (file: string) => resolve(process.cwd(), "extension", file);

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Pin reopen fixture</title>
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
  <head><meta charset="utf-8" /><title>Reopen iframe</title></head>
  <body><iframe id="app-shell" src="https://app.pinar.test/child"></iframe></body>
</html>`;

const childFrameFixture = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Child frame</title></head>
  <body><main><button id="iframe-target" class="go">New project</button></main></body>
</html>`;

const savedPin = {
  anchor: { x: 138, y: 184 },
  box: { height: 88, width: 180, x: 48, y: 140 },
  comment: "Keep this action",
  id: "pin_cta",
  kind: "element",
  number: 1,
  path: "main > button#cta",
  pinId: "pin_cta",
  selector: "#cta",
  tag: "button",
  text: "Save changes",
  type: "point",
};

const savedSession = {
  id: "session_reopen",
  page: { title: "Pin reopen fixture", url: "https://app.example.test/reopen" },
  pins: [savedPin],
};

async function installHarness(page: Page, path = "/reopen-fixture") {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
  await page.route("**/reopen-fixture", (route) => route.fulfill({
    body: fixture,
    contentType: "text/html",
  }));
  await page.goto(path === "/reopen-fixture" ? "/reopen-fixture" : path);
  await page.evaluate(() => {
    const runtimeState = { pins: [] as unknown[], rejected: [] as unknown[] };
    (globalThis as any).__pinarRuntimeState = runtimeState;
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (message: any) => {
          if (message.type === "pins:sync") {
            if (message.sessionId && message.sessionId !== "session_reopen") {
              runtimeState.rejected.push(message.sessionId);
              return { error: "session_mismatch", ok: false };
            }
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
  await page.addScriptTag({ path: extensionPath("privacy.js") });
  await page.addScriptTag({ path: extensionPath("keyboard.js") });
  await page.addScriptTag({ path: extensionPath("content.js") });
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
}

async function hydrate(page: Page, session = savedSession, reviews = [{ pinId: "pin_cta", status: "open" }]) {
  return page.evaluate(({ payload }) => (globalThis as any).__pinarHydrateSession?.(payload), {
    payload: { reviews, session, sessionId: session.id },
  });
}

test("rehydrates a saved session onto a stable DOM with review state and confidence", async ({ page }) => {
  await installHarness(page);
  await expect.poll(async () => hydrate(page)).toBe(true);
  const marker = page.locator('[data-pinar="host"] [data-pin="pin_cta"]');
  await expect(marker).toHaveAttribute("data-location-confidence", /exact|probable/);
  await expect(marker).toHaveAttribute("data-review-status", "open");
  const point = await marker.evaluate((node) => ({
    x: Number.parseFloat((node as HTMLElement).style.left),
    y: Number.parseFloat((node as HTMLElement).style.top),
  }));
  const targetBox = await page.locator("#cta").boundingBox();
  expect(targetBox).toBeTruthy();
  if (!targetBox) return;
  expect(Math.abs(targetBox.x + targetBox.width / 2 - point.x)).toBeLessThan(24);
  expect(Math.abs(targetBox.y + targetBox.height / 2 - point.y)).toBeLessThan(24);
});

test("relocates a moved element without treating it as a different session", async ({ page }) => {
  await installHarness(page);
  await page.evaluate(() => {
    const cta = document.querySelector("#cta");
    if (!cta) return;
    cta.className = "primary";
    document.body.append(cta);
  });
  await expect.poll(async () => hydrate(page)).toBe(true);
  const marker = page.locator('[data-pinar="host"] [data-pin="pin_cta"]');
  await expect(marker).toHaveAttribute("data-location-confidence", /exact|probable/);
  const historical = await page.evaluate(() => {
    const pins = (globalThis as any).__pinarRuntimeState.pins as Array<{ historicalSelector?: string; selector?: string }>;
    return pins[0]?.selector;
  });
  expect(historical).toBe("#cta");
});

test("broken selectors stay pending instead of snapping to an exact lookalike", async ({ page }) => {
  await installHarness(page);
  await expect.poll(async () => hydrate(page, {
    ...savedSession,
    pins: [{
      ...savedPin,
      box: { height: 10, width: 10, x: 8, y: 8 },
      path: "footer > button#missing-cta",
      selector: "#missing-cta",
      text: "This comment does not appear in the DOM",
    }],
  })).toBe(true);
  const pending = page.locator('[data-pinar="host"] [data-pin="pin_cta"]');
  await expect(pending).toHaveAttribute("data-location-confidence", /ambiguous|unresolved/);
  await expect(pending).toHaveClass(/is-pending/);
  await expect(pending).not.toHaveAttribute("data-location-confidence", "exact");
});

test("manual reposition preserves the historical anchor", async ({ page }) => {
  await installHarness(page);
  await expect.poll(async () => hydrate(page, {
    ...savedSession,
    pins: [{
      ...savedPin,
      box: { height: 10, width: 10, x: 8, y: 8 },
      path: "footer > button#missing",
      selector: "#missing",
      text: "This comment does not appear in the DOM",
    }],
  })).toBe(true);
  await expect(page.locator('[data-pinar="host"] [data-pin="pin_cta"]')).toHaveClass(/is-pending/);
  await expect.poll(async () => page.evaluate(() => (globalThis as any).__pinarRepositionPin?.("pin_cta", "button.dup"))).toBe(true);
  const placed = page.locator('[data-pinar="host"] [data-pin="pin_cta"]');
  await expect(placed).toHaveAttribute("data-location-confidence", "exact");
  const preserved = await page.evaluate(() => {
    const pin = ((globalThis as any).__pinarRuntimeState.pins as Array<Record<string, unknown>>)[0];
    return {
      historicalAnchor: pin.historicalAnchor,
      selector: pin.selector,
      source: (pin.locationHistory as Array<{ source: string }>)?.at(-1)?.source,
    };
  });
  expect(preserved.selector).toBe("#missing");
  expect(preserved.historicalAnchor).toEqual(savedPin.anchor);
  expect(preserved.source).toBe("manual");
});

test("unavailable original pages surface a review error instead of leftover pins", async ({ page }) => {
  await installHarness(page);
  await expect.poll(async () => hydrate(page)).toBe(true);
  await page.evaluate(() => (globalThis as any).__pinarShowUnavailable?.("unavailable"));
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(0);
  await expect(page.locator('[data-pinar="host"] [data-ref="status"]')).toContainText("unavailable");
});

test("rejects a second session id while hydrating the chosen session", async ({ page }) => {
  await installHarness(page);
  await expect.poll(async () => hydrate(page)).toBe(true);
  const rejected = await page.evaluate(async () => {
    const result = await (globalThis as any).chrome.runtime.sendMessage({
      pins: [{ comment: "from another session", id: "pin_other" }],
      sessionId: "session_other",
      type: "pins:sync",
    });
    return {
      rejected: (globalThis as any).__pinarRuntimeState.rejected,
      result,
    };
  });
  expect(rejected.result.ok).toBe(false);
  expect(rejected.rejected).toEqual(["session_other"]);
});

test("rehydrates a same-origin iframe pin without treating it as exact on the top page", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
  await page.route("**/reopen-iframe-fixture", (route) => route.fulfill({
    body: iframeFixture,
    contentType: "text/html",
  }));
  await page.route("https://app.pinar.test/child", (route) => route.fulfill({
    body: childFrameFixture,
    contentType: "text/html",
  }));
  await page.goto("/reopen-iframe-fixture");
  await expect.poll(() => page.frames().length).toBe(2);
  for (const frame of page.frames()) {
    await frame.evaluate(() => {
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
    await frame.addScriptTag({ path: extensionPath("coordinates.js") });
    await frame.addScriptTag({ path: extensionPath("frame-path.js") });
    await frame.addScriptTag({ path: extensionPath("locators.js") });
    await frame.addScriptTag({ path: extensionPath("privacy.js") });
    await frame.addScriptTag({ path: extensionPath("keyboard.js") });
    await frame.addScriptTag({ path: extensionPath("content.js") });
  }
  const childFrame = page.frames().find((frame) => frame.url() === "https://app.pinar.test/child");
  expect(childFrame).toBeDefined();
  if (!childFrame) return;
  const iframeSession = {
    id: "session_reopen",
    page: { title: "Reopen iframe", url: "https://app.pinar.test/" },
    pins: [{
      ...savedPin,
      comment: "Keep the frame chain",
      id: "pin_frame",
      path: `iframe#app-shell ::frame:: main > button#iframe-target`,
      pinId: "pin_frame",
      selector: "#iframe-target",
      text: "New project",
    }],
  };
  await expect.poll(async () => childFrame.evaluate((payload) => (globalThis as any).__pinarHydrateSession?.(payload), {
    reviews: [{ pinId: "pin_frame", status: "open" }],
    session: iframeSession,
    sessionId: iframeSession.id,
  })).toBe(true);
  const marker = childFrame.locator('[data-pinar="host"] [data-pin="pin_frame"]');
  await expect(marker).toHaveAttribute("data-location-confidence", /exact|probable/);
  await expect(page.locator('[data-pinar="host"] [data-pin="pin_frame"]')).toHaveCount(0);
});
