import { expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { resolve } from "node:path";
import { CONTENT_INJECTION_FILES } from "../../../extension/session.js";
import { launchExtensionContext } from "./extension-context";

// Since continuous sessions (1ec1ecc) the page only syncs its pins: the
// service worker captures each one into the session draft, assigns its
// captureId, uploads it with the pin's own id on finish and copies the
// session handoff the destination renders. launchHandoffSession drives that
// path with the real service worker in local mode; only the transport is
// stubbed, and what the worker uploads, finishes and hands to the offscreen
// clipboard writer is recorded on globalThis.__handoff.

export const HANDOFF_MARKDOWN = "## Handoff fixture\n\n1. Make the CTA bolder\n";

export async function launchHandoffSession(): Promise<{ context: BrowserContext; page: Page; worker: Worker }> {
  const extension = resolve("extension");
  const context = await launchExtensionContext("", {
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    channel: "chromium",
    headless: true,
  });
  // Everything after the launch can fail before the caller's try/finally owns
  // the context: close it here (Chromium and the isolation proxy) and rethrow.
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(async (markdown) => {
      const state = { clipboard: [] as string[], finished: [] as string[], shots: [] as any[] };
      (globalThis as any).__handoff = state;
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" }, status,
      });
      const originalFetch = globalThis.fetch.bind(globalThis);
      // Each route matches the local router's method and path
      // (apps/server/src/server/api.local.ts); anything else is a test failure.
      globalThis.fetch = async (input, init) => {
        if (String(input).startsWith("data:")) return originalFetch(input, init);
        const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
        const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
        const route = `${method} ${path}`;
        // api.local.ts:802
        if (route === "GET /api/health") return json({ ok: true, runtime: "local", service: "pinar" });
        // api.local.ts:790
        if (route === "GET /api/local/capability") return json({ token: "isolated-test-capability" });
        // api.local.ts:808
        if (route === "GET /api/preferences") return json({ copyOnFinishBatch: "prompt", includeScreenshot: true, includeViewer: true, language: "en" });
        // api.local.ts:843
        if (route === "GET /api/project-tree") return json({ tree: { projects: [{ collections: [{ id: "collection", isProtected: true }], id: "project" }] } });
        // api.local.ts:823-824
        if (route === "POST /api/shots" || route === "POST /api/history") {
          state.shots.push(JSON.parse(String(init?.body)));
          return json({ ok: true, path: "/shots/handoff.png" }, 201);
        }
        // api.local.ts:850-851
        if (method === "GET" && /^\/api\/batches\/[^/]+\/markdown$/.test(path)) return new Response(markdown);
        // api.local.ts:849,871
        const finish = method === "POST" ? /^\/api\/batches\/([^/]+)\/finish$/.exec(path) : null;
        if (finish) {
          state.finished.push(decodeURIComponent(finish[1]));
          return json({ ok: true });
        }
        throw new Error(`Unexpected test request: ${route}`);
      };
      // Observe what the service worker hands to the offscreen clipboard writer.
      const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((message: any, ...rest: any[]) => {
        if (message?.type === "clipboard:write") state.clipboard.push(message.plain);
        return (sendMessage as any)(message, ...rest);
      }) as typeof chrome.runtime.sendMessage;
      await chrome.storage.sync.set({ copyOnFinishBatch: "prompt", enableHistory: true, language: "en", storageMode: "local" });
    }, HANDOFF_MARKDOWN);
    await context.route("https://handoff.pinar.test/**", (route) => route.fulfill({
      body: '<html lang="en"><title>Handoff fixture</title><body style="margin:0;padding:140px 48px;font:16px sans-serif"><main><button id="save" style="height:64px;width:180px">Save changes</button></main></body></html>',
      contentType: "text/html",
    }));
    const page = await context.newPage();
    await page.goto("https://handoff.pinar.test/");
    await worker.evaluate(async (files) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      // Expose the production shadow tree in the extension's isolated world for assertions.
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: "open" }); };
      } });
      await chrome.scripting.executeScript({ files, target: { tabId: tab.id! } });
    }, CONTENT_INJECTION_FILES);
    await expect(page.locator('[data-pinar="host"]')).toBeVisible();
    return { context, page, worker };
  } catch (error) {
    // A failed close must not replace the setup error that caused it.
    await context.close().catch((closeError) => console.warn("launchHandoffSession: context.close failed", closeError));
    throw error;
  }
}

export const readDraft = (worker: Worker) => worker.evaluate(async () => new Promise<any>((resolveDraft, reject) => {
  const request = indexedDB.open("pinar-review-draft", 1);
  request.onsuccess = () => {
    const database = request.result;
    const read = database.transaction("drafts").objectStore("drafts").get("active");
    read.onsuccess = () => { resolveDraft(read.result || null); database.close(); };
    read.onerror = () => reject(read.error);
  };
  request.onerror = () => reject(request.error);
}));

export async function createPin(page: Page, comment: string, target = "#save") {
  await page.locator(target).click();
  const composer = page.locator('[data-pinar="host"] [data-ref="composer"]');
  await expect(composer).toBeVisible();
  await composer.locator("textarea").fill(comment);
  await composer.getByRole("button", { name: "Add" }).click();
}
