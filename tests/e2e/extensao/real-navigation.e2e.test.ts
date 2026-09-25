import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("pins from another Pinar collection do not return when the toolbar reopens", async () => {
  const extension = resolve("extension");
  const context = await chromium.launchPersistentContext("", {
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    channel: "chromium",
    headless: true,
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const draftEntries = () => worker.evaluate(async () => new Promise<any[]>((resolve, reject) => {
      const request = indexedDB.open("pinar-review-draft", 1);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction("drafts").objectStore("drafts").get("active");
        read.onsuccess = () => { resolve(read.result?.entries ?? []); database.close(); };
        read.onerror = () => reject(read.error);
      };
      request.onerror = () => reject(request.error);
    }));
    await worker.evaluate(async () => {
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" }, status,
      });
      const originalFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init) => {
        if (String(input).startsWith("data:")) return originalFetch(input, init);
        const path = new URL(String(input)).pathname;
        if (path === "/api/health") return json({ ok: true, runtime: "local", service: "pinar" });
        if (path === "/api/local/capability") return json({ token: "isolated-test-capability" });
        if (path === "/api/preferences") return json({ includeScreenshot: true, includeViewer: true, language: "en" });
        if (path === "/api/project-tree") return json({ tree: { projects: [{ id: "project", collections: [{ id: "collection", isProtected: true }] }] } });
        if (path === "/api/shots" || path === "/api/history") return json({ ok: true, path: "/shots/test.png" }, 201);
        if (path.startsWith("/api/batches/")) return json({ ok: true });
        throw new Error(`Unexpected test request: ${path}`);
      };
      await chrome.storage.sync.set({ enableHistory: true, language: "en", storageMode: "local" });
    });
    await context.route("**/app?lang=pt", (route) => route.fulfill({
      body: '<html><body style="padding:100px"><main><button id="target" style="height:100px;width:200px">First page</button></main></body></html>',
      contentType: "text/html",
    }));
    const page = await context.newPage();
    await page.goto("/app?lang=pt");
    await page.evaluate(() => {
      localStorage.setItem("pinar-selected-project", "project-a");
      localStorage.setItem("pinar-selected-collection", "collection-a");
    });
    const inject = () => worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({ target: { allFrames: true, tabId: tab.id! }, func: () => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: "open" }); };
      } });
      await chrome.scripting.executeScript({
        files: ["coordinates.js", "frame-path.js", "locators.js", "privacy.js", "snapshot.js", "evidence.js", "keyboard.js", "voice.js", "content.js"],
        target: { allFrames: true, tabId: tab.id! },
      });
    });
    await inject();
    await page.locator("#target").click();
    const composer = page.locator('[data-pinar="host"] [data-ref="composer"]');
    await composer.locator("textarea").fill("First page comment");
    await composer.getByRole("button", { name: "Add" }).click();
    const markers = page.locator('[data-pinar="host"] [data-pin]');
    await expect(markers).toHaveCount(1);
    await expect.poll(async () => (await draftEntries()).length).toBe(1);

    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      localStorage.setItem("pinar-selected-project", "project-b");
      localStorage.setItem("pinar-selected-collection", "collection-c");
    });
    await inject();
    await expect(markers).toHaveCount(0);
    expect(await draftEntries()).toHaveLength(1);
    await page.locator("#target").click();
    await composer.locator("textarea").fill("Second collection comment");
    await composer.getByRole("button", { name: "Add" }).click();
    await expect(markers).toHaveCount(1);
    await expect.poll(async () => (await draftEntries()).length).toBe(2);
    await page.keyboard.press("Escape");
    await page.evaluate(() => localStorage.setItem("pinar-selected-collection", "collection-d"));
    await inject();
    await expect(markers).toHaveCount(0);
    expect(await draftEntries()).toHaveLength(2);
  } finally {
    await context.close();
  }
});
