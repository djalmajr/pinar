import { expect, test, type Page } from "@playwright/test";
import { injectExtensionScripts } from "../helpers/extension-scripts";

// The fixture registers, before the extension is injected, the same
// single-letter shortcut listeners a page app would bind (x, f, j, k and
// space), each in a different place:
//   (a) window, capture        - runs before the extension's own window listener
//   (b) document, capture
//   (c) document, bubble
//   (d) document, keypress, capture
// Every listener counts the keys it sees coming from the prompt (the event
// target is retargeted to the extension host, the only focused element) and
// cancels the shortcut keys with preventDefault.
const fixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Composer host shortcuts fixture</title>
    <style>
      body { font: 16px/1.4 sans-serif; margin: 0; padding: 140px 48px; }
      button { height: 96px; width: 240px; border: 1px solid #94a3b8; border-radius: 12px; background: #f8fafc; }
    </style>
  </head>
  <body>
    <main>
      <button id="target-a">Alpha target</button>
    </main>
    <script>
      const shortcutKeys = new Set(["x", "f", "j", "k", " "]);
      const counters = { documentBubble: 0, documentCapture: 0, keypressCapture: 0, windowCapture: 0 };
      globalThis.__shortcutCounters = counters;
      const fromPrompt = (event) => Boolean(event.target) && event.target.getAttribute("data-pinar") === "host";
      const observe = (name) => (event) => {
        if (!fromPrompt(event)) return;
        counters[name] += 1;
        if (shortcutKeys.has(event.key)) event.preventDefault();
      };
      window.addEventListener("keydown", observe("windowCapture"), true);
      document.addEventListener("keydown", observe("documentCapture"), true);
      document.addEventListener("keydown", observe("documentBubble"), false);
      document.addEventListener("keypress", observe("keypressCapture"), true);
    </script>
  </body>
</html>`;

// Same page, but the site binds ONLY a keypress listener on the window in
// capture (registered before the extension): keydown is never canceled, so
// Chromium still dispatches the keypress, and the site cancels the printable
// keypresses. The character is lost natively unless the extension recovers
// the canceled keypress on Pinar's own fields.
const keypressOnlyFixture = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Composer host shortcuts fixture</title>
    <style>
      body { font: 16px/1.4 sans-serif; margin: 0; padding: 140px 48px; }
      button { height: 96px; width: 240px; border: 1px solid #94a3b8; border-radius: 12px; background: #f8fafc; }
    </style>
  </head>
  <body>
    <main>
      <button id="target-a">Alpha target</button>
    </main>
    <script>
      const shortcutKeys = new Set(["x", "f", "j", "k", " "]);
      const counters = { keypressWindow: 0 };
      globalThis.__shortcutCounters = counters;
      const fromPrompt = (event) => Boolean(event.target) && event.target.getAttribute("data-pinar") === "host";
      window.addEventListener("keypress", (event) => {
        if (!fromPrompt(event)) return;
        counters.keypressWindow += 1;
        if (shortcutKeys.has(event.key)) event.preventDefault();
      }, true);
    </script>
  </body>
</html>`;

type ShadowMode = "open" | "closed";

async function installExtensionHarness(page: Page, mode: ShadowMode = "open", fixtureHtml = fixture) {
  await page.addInitScript((shadowMode: ShadowMode) => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function patchedAttachShadow(init) {
      const root = original.call(this, { ...init, mode: shadowMode });
      // The production extension keeps its root closed, so a closed-mode run
      // stashes the root in a test global: pages (and the test) cannot reach
      // a closed root through host.shadowRoot, only through this reference.
      if (shadowMode === "closed" && this.getAttribute?.("data-pinar") === "host") {
        (globalThis as any).__pinarClosedShadow = root;
      }
      return root;
    };
  }, mode);
  await page.route("**/extension-fixture", (route) => route.fulfill({
    body: fixtureHtml,
    contentType: "text/html",
  }));
  await page.goto("/extension-fixture");
  await page.evaluate(() => {
    const runtimeState = { clipboard: "", messages: [] as unknown[], pins: [] as unknown[], batch: { active: false, label: "", shortcut: "", entries: [] as unknown[], nextNumber: 1 } };
    const messageListeners: any[] = [];
    runtimeState.messageListeners = messageListeners;
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
          if (message.type === "pins:sync") {
            runtimeState.pins = structuredClone(message.pins);
            return { ok: true, pins: structuredClone(runtimeState.pins) };
          }
          // The service worker owns the batch; batch:get answers with the
          // state pushed through batch:changed (kept in runtimeState.batch).
          if (message.type === "batch:get") {
            return structuredClone({ ok: true, ...(runtimeState.batch as object) });
          }
          if (message.type === "capture") return { ok: true, shot: "data:image/png;base64,cGluYXI=" };
          return { ok: true };
        },
      },
    };
  });
  await injectExtensionScripts(page);
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
}

// Deliver a message the way the service worker would (chrome.runtime.onMessage
// listener), so the content script runs its own handlers end to end.
async function pushRuntimeMessage(page: Page, message: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => {
    const state = (globalThis as any).__pinarRuntimeState;
    for (const listener of state.messageListeners ?? []) listener(payload, {}, () => {});
  }, message);
}

test("site one-letter shortcuts do not swallow typing in the Pinar prompt (open shadow, harness view)", async ({ page }) => {
  await installExtensionHarness(page, "open");

  const bounds = await page.locator("#target-a").boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.move(bounds.x + 20, bounds.y + 20);
  await page.mouse.click(bounds.x + 20, bounds.y + 20);
  const prompt = page.locator('[data-pinar="host"] [data-ref="composer"] textarea');
  await expect(prompt).toBeVisible();
  await expect(prompt).toBeFocused();

  const counters = () => page.evaluate(() => (globalThis as any).__shortcutCounters);

  // (b), (c) and (d) must never see a key typed in the prompt. (a) was
  // registered before the extension and cancels the shortcut keys, so the
  // safety net has to keep the typed text complete.
  await page.keyboard.type("fix the x key");
  await expect(prompt).toHaveValue("fix the x key");
  expect(await counters()).toEqual({
    documentBubble: 0,
    documentCapture: 0,
    keypressCapture: 0,
    windowCapture: 13,
  });

  // Backspace keeps editing the field while the site listener (a) is active.
  await page.keyboard.press("Backspace");
  await expect(prompt).toHaveValue("fix the x ke");
  await page.keyboard.type("y");
  await expect(prompt).toHaveValue("fix the x key");
  expect(await counters().then((value: any) => value.windowCapture)).toBe(15);

  // Enter still saves the pin.
  await page.keyboard.press("Enter");
  await expect.poll(async () => page.evaluate(() => (globalThis as any).__pinarRuntimeState?.pins?.length ?? 0)).toBe(1);
  const pin = await page.evaluate(() => (globalThis as any).__pinarRuntimeState.pins[0]);
  expect(pin.comment).toBe("fix the x key");
  expect(await counters()).toEqual({
    documentBubble: 0,
    documentCapture: 0,
    keypressCapture: 0,
    windowCapture: 16,
  });
});

// The production mode: the extension calls attachShadow({ mode: "closed" })
// (extension/content.js). From a window/document listener the event target
// is retargeted to the host and composedPath() hides the inner nodes, so the
// test reads the prompt, focus and counters through the stashed root instead
// of locators that cross an open shadow.
test("site one-letter shortcuts do not swallow typing in the Pinar prompt (closed shadow, real mode)", async ({ page }) => {
  await installExtensionHarness(page, "closed");

  // The shadow must really be closed: no host.shadowRoot, and the root is
  // only reachable through the test global the attachShadow patch stashed.
  await expect.poll(async () =>
    page.evaluate(() => {
      const host = document.querySelector('[data-pinar="host"]');
      return Boolean(host) && host.shadowRoot === null && Boolean((globalThis as any).__pinarClosedShadow);
    }),
  ).toBeTruthy();

  const promptState = () =>
    page.evaluate((query: string) => {
      const root = (globalThis as any).__pinarClosedShadow as ShadowRoot;
      const field = root.querySelector(query);
      return { focused: root.activeElement === field, value: field instanceof HTMLTextAreaElement ? field.value : null };
    }, "[data-ref=\"composer\"] textarea");

  const counters = () => page.evaluate(() => (globalThis as any).__shortcutCounters);

  const bounds = await page.locator("#target-a").boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.move(bounds.x + 20, bounds.y + 20);
  await page.mouse.click(bounds.x + 20, bounds.y + 20);

  // The composer opens and the prompt takes focus inside the closed root.
  await expect.poll(promptState).toEqual({ focused: true, value: "" });

  // (b), (c) and (d) must never see a key typed in the prompt. (a) was
  // registered before the extension and cancels the shortcut keys, so the
  // safety net has to keep the typed text complete.
  await page.keyboard.type("fix the x key");
  expect((await promptState()).value).toBe("fix the x key");
  expect(await counters()).toEqual({
    documentBubble: 0,
    documentCapture: 0,
    keypressCapture: 0,
    windowCapture: 13,
  });

  // Backspace keeps editing the field while the site listener (a) is active.
  await page.keyboard.press("Backspace");
  expect((await promptState()).value).toBe("fix the x ke");
  await page.keyboard.type("y");
  expect((await promptState()).value).toBe("fix the x key");
  expect(await counters().then((value: any) => value.windowCapture)).toBe(15);

  // Enter still saves the pin.
  await page.keyboard.press("Enter");
  await expect.poll(async () => page.evaluate(() => (globalThis as any).__pinarRuntimeState?.pins?.length ?? 0)).toBe(1);
  const pin = await page.evaluate(() => (globalThis as any).__pinarRuntimeState.pins[0]);
  expect(pin.comment).toBe("fix the x key");
  expect(await counters()).toEqual({
    documentBubble: 0,
    documentCapture: 0,
    keypressCapture: 0,
    windowCapture: 16,
  });
});

// Review comments must stay out of the global shortcuts even in the closed
// shadow: keys typed in a comment never trigger copy/Tab/Esc, Tab moves to
// the next control (and the comment's change persists through review:edit),
// and Esc keeps the review open. The site's window-capture keydown listeners
// are active the whole time: they count the keys (retargeted to the host) and
// cancel the shortcut ones, so the safety net must keep the text complete.
test("review comments stay out of the copy/Tab/Esc shortcuts (closed shadow, real mode)", async ({ page }) => {
  await installExtensionHarness(page, "closed");

  await expect.poll(async () =>
    page.evaluate(() => {
      const host = document.querySelector('[data-pinar="host"]');
      return Boolean(host) && host.shadowRoot === null && Boolean((globalThis as any).__pinarClosedShadow);
    }),
  ).toBeTruthy();

  const reviewState = () =>
    page.evaluate(() => {
      const root = (globalThis as any).__pinarClosedShadow as ShadowRoot | undefined;
      const host = document.querySelector('[data-pinar="host"]');
      const comment = root?.querySelector(".review-comment");
      return {
        comment: comment instanceof HTMLTextAreaElement ? comment.value : null,
        commentFocused: Boolean(root && root.activeElement === comment),
        finishFocused: root?.activeElement?.getAttribute?.("data-ref") === "reviewFinish",
        open: host?.hasAttribute("data-review-open") ?? false,
      };
    });

  // Pin the target with a comment, exactly like the prompt tests do.
  const bounds = await page.locator("#target-a").boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.move(bounds.x + 20, bounds.y + 20);
  await page.mouse.click(bounds.x + 20, bounds.y + 20);
  const promptState = () =>
    page.evaluate((query: string) => {
      const root = (globalThis as any).__pinarClosedShadow as ShadowRoot;
      const field = root.querySelector(query);
      return { focused: root.activeElement === field, value: field instanceof HTMLTextAreaElement ? field.value : null };
    }, "[data-ref=\"composer\"] textarea");
  await expect.poll(promptState).toEqual({ focused: true, value: "" });
  await page.keyboard.type("alpha note");
  await page.keyboard.press("Enter");
  await expect.poll(async () => page.evaluate(() => (globalThis as any).__pinarRuntimeState?.pins?.length ?? 0)).toBe(1);

  // The service worker pushes the saved pin into the batch and opens the
  // review panel; the saved comment renders in the editor.
  const pinId = await page.evaluate(() => (globalThis as any).__pinarRuntimeState.pins[0].id);
  await page.evaluate((id: string) => {
    const state = (globalThis as any).__pinarRuntimeState;
    const entry = {
      captureId: "cap-alpha",
      pinId: id,
      number: 1,
      type: "element",
      tag: "button",
      page: { title: document.title, url: location.href },
      comment: "alpha note",
      status: "saved",
    };
    // The service worker keeps the batch and answers batch:get with it (the
    // review:open path pulls batch:get again, so the fake must remember it).
    state.batch = { active: true, label: "1 pin", shortcut: "", nextNumber: 2, entries: [entry] };
    const message = { type: "batch:changed", ...(state.batch as object) };
    for (const listener of state.messageListeners ?? []) listener(message, {}, () => {});
  }, pinId);
  await pushRuntimeMessage(page, { type: "review:open" });
  await expect.poll(reviewState).toMatchObject({ open: true, comment: "alpha note" });

  // Focus the comment (caret at the end) and type with the site's listeners
  // active: the space and x are canceled by the site and the safety net has
  // to keep the text complete.
  await page.evaluate(() => {
    const root = (globalThis as any).__pinarClosedShadow;
    const comment = root.querySelector(".review-comment");
    comment.focus();
    comment.setSelectionRange(comment.value.length, comment.value.length);
  });
  await expect.poll(reviewState).toMatchObject({ commentFocused: true });
  const countersBefore = await page.evaluate(() => (globalThis as any).__shortcutCounters);
  await page.keyboard.type(" fix x now");
  expect((await reviewState()).comment).toBe("alpha note fix x now");
  const countersAfter = await page.evaluate(() => (globalThis as any).__shortcutCounters);
  // The site's window capture listener saw all ten keydowns (retargeted to
  // the host) and nothing reached the document-level listeners.
  expect(countersAfter.windowCapture - countersBefore.windowCapture).toBe(10);
  expect(countersAfter.documentCapture - countersBefore.documentCapture).toBe(0);
  expect(countersAfter.documentBubble - countersBefore.documentBubble).toBe(0);
  expect(countersAfter.keypressCapture - countersBefore.keypressCapture).toBe(0);

  // Tab moves to the next control, the review stays open, and the comment's
  // change persists through review:edit.
  await page.keyboard.press("Tab");
  await expect.poll(reviewState).toMatchObject({ open: true, finishFocused: true, comment: "alpha note fix x now" });
  await expect.poll(async () =>
    page.evaluate(() => {
      const state = (globalThis as any).__pinarRuntimeState;
      return state.messages.find((message: { type: string }) => message.type === "review:edit");
    }),
  ).toMatchObject({ captureId: "cap-alpha", comment: "alpha note fix x now" });

  // Esc inside the comment does not close the review.
  await page.evaluate(() => {
    const root = (globalThis as any).__pinarClosedShadow;
    const comment = root.querySelector(".review-comment");
    comment.focus();
  });
  await page.keyboard.press("Escape");
  expect(await reviewState()).toMatchObject({ open: true, comment: "alpha note fix x now", commentFocused: true });
});

// A site that only cancels the keypress (window, capture, registered before
// the extension) loses the character natively: keydown was not canceled, so
// the default text insertion is the keypress default, and the site canceled
// it. The extension must recover the canceled keypress on Pinar's own fields
// without duplicating the keys it already recovered on keydown.
test("a site keypress cancel keeps the typed text complete (closed shadow, real mode)", async ({ page }) => {
  await installExtensionHarness(page, "closed", keypressOnlyFixture);

  await expect.poll(async () =>
    page.evaluate(() => {
      const host = document.querySelector('[data-pinar="host"]');
      return Boolean(host) && host.shadowRoot === null && Boolean((globalThis as any).__pinarClosedShadow);
    }),
  ).toBeTruthy();

  const promptState = () =>
    page.evaluate((query: string) => {
      const root = (globalThis as any).__pinarClosedShadow as ShadowRoot;
      const field = root.querySelector(query);
      return { focused: root.activeElement === field, value: field instanceof HTMLTextAreaElement ? field.value : null };
    }, "[data-ref=\"composer\"] textarea");

  const bounds = await page.locator("#target-a").boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.move(bounds.x + 20, bounds.y + 20);
  await page.mouse.click(bounds.x + 20, bounds.y + 20);
  await expect.poll(promptState).toEqual({ focused: true, value: "" });

  // The site sees and cancels the keypresses of x/f/j/k/space on the window;
  // nothing else touches keydown, so the recovered text must be exact.
  await page.keyboard.type("fix the x key");
  expect((await promptState()).value).toBe("fix the x key");
  expect(await page.evaluate(() => (globalThis as any).__shortcutCounters)).toEqual({ keypressWindow: 13 });

  // Enter still saves the pin with the complete text.
  await page.keyboard.press("Enter");
  await expect.poll(async () => page.evaluate(() => (globalThis as any).__pinarRuntimeState?.pins?.length ?? 0)).toBe(1);
  const pin = await page.evaluate(() => (globalThis as any).__pinarRuntimeState.pins[0]);
  expect(pin.comment).toBe("fix the x key");
});
