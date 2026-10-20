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
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(async (markdown) => {
    const state = { clipboard: [] as string[], finished: [] as string[], shots: [] as any[] };
    (globalThis as any).__handoff = state;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" }, status,
    });
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith("data:")) return originalFetch(input, init);
      const path = new URL(String(input)).pathname;
      if (path === "/api/health") return json({ ok: true, runtime: "local", service: "pinar" });
      if (path === "/api/local/capability") return json({ token: "isolated-test-capability" });
      if (path === "/api/preferences") return json({ copyOnFinishBatch: "prompt", includeScreenshot: true, includeViewer: true, language: "en" });
      if (path === "/api/project-tree") return json({ tree: { projects: [{ collections: [{ id: "collection", isProtected: true }], id: "project" }] } });
      if (path === "/api/shots" || path === "/api/history") {
        state.shots.push(JSON.parse(String(init?.body)));
        return json({ ok: true, path: "/shots/handoff.png" }, 201);
      }
      if (path.startsWith("/api/batches/") && path.endsWith("/markdown")) return new Response(markdown);
      if (path.startsWith("/api/batches/") && path.endsWith("/finish")) {
        state.finished.push(path.split("/")[3]);
        return json({ ok: true });
      }
      if (path.startsWith("/api/batches/")) return json({ ok: true });
      throw new Error(`Unexpected test request: ${path}`);
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
