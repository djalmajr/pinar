import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = (file: string) => resolve(process.cwd(), "extension", file);
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Closed loop fixture</title>
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

async function installHarness(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
  await page.route("**/closed-loop-fixture", (route) => route.fulfill({
    body: fixture,
    contentType: "text/html",
  }));
  await page.goto("/closed-loop-fixture");
  await page.evaluate(() => {
    const runtimeState = { clipboard: "", messages: [] as unknown[], pins: [] as unknown[] };
    (globalThis as any).__pinarRuntimeState = runtimeState;
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
            return { ok: true, shot: "data:image/png;base64,cGluYXI=" };
          }
          if (message.type === "clipboard") {
            return { degraded: false, ok: true, plain: "copied", warnings: [] };
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
  await page.addScriptTag({ path: extensionPath("content.js") });
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
}

test("pin copy keeps capture ids for the four-agent handoff", async ({ page }) => {
  await installHarness(page);
  const bounds = await page.locator("#save").boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const composer = page.locator('[data-pinar="host"] [data-ref="composer"]');
  await expect(composer).toBeVisible();
  await composer.locator("textarea").fill("Make the CTA bolder");
  await composer.getByRole("button", { name: "Add" }).click();
  await page.keyboard.press("Control+Enter");
  await expect(page.locator('[data-pinar="host"] [data-ref="status"]')).toHaveText("Copied");

  const clipboardMessage = await page.evaluate(() => {
    const messages = (globalThis as any).__pinarRuntimeState.messages as any[];
    return messages.findLast((message) => message.type === "clipboard");
  });
  expect(clipboardMessage.captureId).toBeTruthy();
  expect(clipboardMessage.pins[0].pinId || clipboardMessage.pins[0].id).toBeTruthy();
  expect(clipboardMessage.pins[0].comment).toBe("Make the CTA bolder");
});

test("workspace records handoff return, accept, reopen and keeps metrics empty without opt-in", async ({ page }) => {
  await page.goto("/app");
  const uploaded = await page.evaluate(async ({ image }) => {
    const response = await fetch("/api/shots", {
      body: JSON.stringify({
        captureId: "e2e_closed_loop",
        id: "e2e_closed_loop",
        image,
        page: { title: "Closed loop", url: "https://example.test/closed-loop" },
        pins: [{ comment: "Make the CTA bolder", kind: "element", pinId: "pin_cta" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return { status: response.status };
  }, { image: VALID_PNG });
  expect(uploaded.status).toBe(201);

  const ready = await page.evaluate(async () => {
    const created = await fetch("/api/agent-executions", {
      body: JSON.stringify({
        agent: "claude",
        captureId: "e2e_closed_loop",
        idempotencyKey: "exec_e2e_closed_loop_01",
        results: [{ pinId: "pin_cta", status: "changed", summary: "First correction" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const session = await (await fetch("/api/sessions/e2e_closed_loop")).json();
    return { created: created.status, status: session.reviews?.[0]?.status };
  });
  expect(ready.created).toBe(201);
  expect(ready.status).toBe("correction_ready");

  const accepted = await page.evaluate(async () => {
    const response = await fetch("/api/sessions/e2e_closed_loop/pins/pin_cta/review", {
      body: JSON.stringify({ action: "accept" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await response.json();
    return { status: response.status, review: body.review?.status };
  });
  expect(accepted.status).toBe(200);
  expect(accepted.review).toBe("accepted");

  const second = await page.evaluate(async () => {
    await fetch("/api/sessions/e2e_closed_loop/pins/pin_cta/review", {
      body: JSON.stringify({ action: "reopen" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const created = await fetch("/api/agent-executions", {
      body: JSON.stringify({
        agent: "grok",
        captureId: "e2e_closed_loop",
        idempotencyKey: "exec_e2e_closed_loop_02",
        results: [{ pinId: "pin_cta", status: "changed", summary: "Second correction" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const session = await (await fetch("/api/sessions/e2e_closed_loop")).json();
    return { created: created.status, status: session.reviews?.[0]?.status };
  });
  expect(second.created).toBe(201);
  expect(second.status).toBe("correction_ready");

  const metrics = await page.evaluate(async () => {
    const off = await fetch("/api/loop-metrics", {
      body: JSON.stringify({
        events: [{ comment: "Make the CTA bolder", event: "handoff", url: "https://example.test/closed-loop" }],
        optIn: false,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const listed = await (await fetch("/api/loop-metrics")).json();
    return { listed, off: await off.json() };
  });
  expect(metrics.off.stored).toBe(0);
  expect(JSON.stringify(metrics.listed)).not.toContain("Make the CTA bolder");
  expect(JSON.stringify(metrics.listed)).not.toContain("https://example.test/closed-loop");
});
