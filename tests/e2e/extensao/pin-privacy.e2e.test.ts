import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { pressCopyShortcut } from "../helpers/extension-shortcut";

const extensionPath = (file: string) => resolve(process.cwd(), "extension", file);
const SECRET = "PINAR_FIXTURE_SECRET_s3cretValue";
const TOKEN = "tok_live_fixture_9f3aXXXX";

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Privacy fixture</title>
    <style>
      body { font: 16px/1.4 sans-serif; margin: 0; padding: 140px 48px; }
      label { display: block; margin: 16px 0; }
      input { height: 48px; width: 280px; }
      button { height: 64px; width: 180px; }
    </style>
  </head>
  <body>
    <main>
      <label>Password <input id="secret-pass" name="password" type="password" value="${SECRET}" /></label>
      <label>Token <input id="api-key" name="api_key" type="text" value="${TOKEN}" /></label>
      <button id="save">Save changes</button>
    </main>
  </body>
</html>`;

async function installHarness(page: Page, html = fixture, path = `/privacy-fixture?access_token=${TOKEN}&keep=1`) {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
  await page.route("**/privacy-fixture*", (route) => route.fulfill({
    body: html,
    contentType: "text/html",
  }));
  await page.goto(path);
  await page.evaluate(() => {
    const runtimeState = { clipboard: "", messages: [] as unknown[], pins: [] as unknown[] };
    const messageListeners: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void)[] = [];
    (globalThis as any).__pinarRuntimeState = runtimeState;
    (globalThis as any).chrome = {
      runtime: {
        onMessage: { addListener: (listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void) => messageListeners.push(listener) },
        sendMessage: async (message: any) => {
          runtimeState.messages.push(structuredClone(message));
          if (message.type === "review:finish") {
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
            return { ok: true, plain: "copied", viewerUrl: "/v/privacy-e2e" };
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

test("redacts secrets and lets the user add or remove mask regions before copy", async ({ page }) => {
  await installHarness(page);
  const autoMasks = page.locator('[data-pinar="host"] [data-privacy-mask]');
  await expect(autoMasks).toHaveCount(1);

  await autoMasks.first().click();
  await expect(autoMasks).toHaveCount(0);

  await page.keyboard.press("m");
  await page.mouse.move(40, 200);
  await page.mouse.down();
  await page.mouse.move(200, 320);
  await page.mouse.up();
  await expect(page.locator('[data-pinar="host"] [data-privacy-mask][data-source="user"]')).toHaveCount(1);
  await page.locator('[data-pinar="host"] [data-privacy-mask][data-source="user"]').click();
  await expect(page.locator('[data-pinar="host"] [data-privacy-mask][data-source="user"]')).toHaveCount(0);
  await page.keyboard.press("m");

  await createPin(page, "#save", `Do not leak ${SECRET}`);
  await page.keyboard.press("m");
  await page.mouse.move(220, 200);
  await page.mouse.down();
  await page.mouse.move(340, 320);
  await page.mouse.up();
  await expect(page.locator('[data-pinar="host"] [data-privacy-mask][data-source="user"]')).toHaveCount(1);
  await pressCopyShortcut(page);
  await expect(page.locator('[data-pinar="host"]')).toBeHidden();

  const { sanitized, masks, finished } = await page.evaluate(() => {
    const messages = (globalThis as any).__pinarRuntimeState.messages as any[];
    const persisted = messages.findLast((message) => message.type === "pins:sync" && message.persist);
    return {
      finished: messages.filter((message) => message.type === "review:finish").length,
      masks: persisted.masks,
      sanitized: (globalThis as any).__pinarPrivacy.sanitizeCapture({
        fields: persisted.fields,
        page: { title: document.title, url: location.href },
        pins: persisted.pins,
        unevaluated: persisted.unevaluated,
      }),
    };
  });
  const payload = JSON.stringify(sanitized);
  expect(payload.includes(SECRET)).toBe(false);
  expect(payload.includes(TOKEN)).toBe(false);
  expect(finished).toBe(1);
  expect(masks).toHaveLength(1);
  expect(sanitized.page.url).toMatch(/access_token=/);
  expect(sanitized.page.url.includes(TOKEN)).toBe(false);
  expect(sanitized.privacy.redacted).toEqual(expect.arrayContaining(["password", "token", "secret-query"]));
  expect(sanitized.pins[0].comment).toContain("[redacted]");
});

const loginFixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Login fixture</title>
    <style>
      body { font: 16px/1.4 sans-serif; margin: 0; padding: 140px 48px; }
      label { display: block; margin: 16px 0; }
      input { height: 48px; width: 280px; }
      button { height: 64px; width: 180px; }
    </style>
  </head>
  <body>
    <main>
      <label>Email <input id="login-email" name="email" type="email" value="user@example.test" /></label>
      <label>Password <input id="login-pass" name="password" type="password" value="${SECRET}" /></label>
      <button id="save">Sign in</button>
    </main>
  </body>
</html>`;

test("copies on the first shortcut when only password and email fields are present", async ({ page }) => {
  await installHarness(page, loginFixture, "/privacy-fixture");
  await expect(page.locator('[data-pinar="host"] [data-privacy-mask]')).toHaveCount(0);

  await createPin(page, "#save", `Do not leak ${SECRET}`);
  await pressCopyShortcut(page);
  await expect(page.locator('[data-pinar="host"]')).toBeHidden();

  const { sanitized, finished } = await page.evaluate(() => {
    const messages = (globalThis as any).__pinarRuntimeState.messages as any[];
    const persisted = messages.findLast((message) => message.type === "pins:sync" && message.persist);
    return {
      finished: messages.filter((message) => message.type === "review:finish").length,
      sanitized: (globalThis as any).__pinarPrivacy.sanitizeCapture({
        fields: persisted.fields,
        page: { title: document.title, url: location.href },
        pins: persisted.pins,
        unevaluated: persisted.unevaluated,
      }),
    };
  });
  const payload = JSON.stringify(sanitized);
  expect(payload.includes(SECRET)).toBe(false);
  expect(finished).toBe(1);
  expect(sanitized.privacy.redacted).toEqual(["password"]);
  expect(sanitized.privacy.redacted).not.toContain("email");
  expect(sanitized.pins[0].comment).toContain("[redacted]");
});
