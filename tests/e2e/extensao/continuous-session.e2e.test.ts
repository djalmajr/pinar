import { chromium, expect, test, type Worker } from "@playwright/test";
import { resolve } from "node:path";
import { pressCopyShortcut } from "../helpers/extension-shortcut";

// Real MV3 service worker, IndexedDB, content scripts and screenshot API.
// Only the transport is stubbed; backend parity is covered by the API contract.
for (const mode of ["local", "cloud"]) test(`continuous session captures multiple pages in ${mode} mode`, async ({}, testInfo) => {
  test.setTimeout(90_000);
  const extension = resolve("extension");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(async (mode) => {
      const saved: Record<string, any> = {};
      (globalThis as any).__reviewSaved = saved;
      (globalThis as any).__reviewOffline = false;
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      const originalFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init) => {
        if (String(input).startsWith("data:")) return originalFetch(input, init);
        const path = new URL(String(input)).pathname;
        if (path === "/api/health") return json({ service: "pinar", ok: true, runtime: "local" });
        if (path === "/api/local/capability") return json({ token: "isolated-test-capability" });
        if (path === "/api/legal/current") return json({ version: "2026-09-14", termsUrl: "/terms", privacyUrl: "/privacy", acceptableUseUrl: "/use" });
        if (path === "/api/installations") return json({ ok: true });
        if (path === "/api/preferences") return json({ includeScreenshot: true, includeViewer: true, language: "en", handoffMode: "full" });
        if (path === "/api/project-tree") return json({ tree: { projects: [{ id: "project", collections: [{ id: "collection", isProtected: true }] }] } });
        if (path === "/api/shots" || path === "/api/history") {
          if ((globalThis as any).__reviewOffline) return json({ error: "offline" }, 503);
          const body = JSON.parse(String(init?.body));
          saved[body.id] = body;
          return json({ ok: true, path: `/shots/${body.id}.png` }, 201);
        }
        if (path.startsWith("/api/history/") && init?.method === "DELETE") { delete saved[path.split("/").pop()!]; return json({ ok: true }); }
        if (path.startsWith("/api/batches/") && path.endsWith("/markdown")) return new Response(Object.values(saved).flatMap((entry) => entry.pins.map((pin: any) => pin.comment)).join("\n"));
        if (path.startsWith("/api/batches/")) return json({ ok: true });
        if (path.startsWith("/b/")) return new Response(Object.values(saved).flatMap((entry) => entry.pins.map((pin: any) => pin.comment)).join("\n"));
        throw new Error(`Unexpected test request: ${path}`);
      };
      await chrome.storage.sync.set({ storageMode: mode, cloudUrl: "https://review-server.test", language: "en", enableHistory: true });
      await chrome.storage.local.set({ remoteLegalAcceptance: { accepted: true, locale: "en", acceptableUseVersion: "2026-09-14", privacyVersion: "2026-09-14", termsVersion: "2026-09-14" } });
    }, mode);
    const readDraft = () => worker.evaluate(async () => {
      return new Promise<any>((resolve, reject) => {
        const request = indexedDB.open("pinar-review-draft", 1);
        request.onsuccess = () => {
          const database = request.result;
          const read = database.transaction("drafts").objectStore("drafts").get("active");
          read.onsuccess = () => { resolve(read.result || null); database.close(); };
          read.onerror = () => reject(read.error);
        };
        request.onerror = () => reject(request.error);
      });
    });
    await context.route("https://review.pinar.test/**", (route) => route.fulfill({ contentType: "text/html", body: `<html><title>Review fixture</title><body style="margin:0;padding:100px;font:20px sans-serif"><button style="width:250px;height:150px">Target</button><button style="width:250px;height:150px">Second target</button><a href="/two">Next page</a><input type="password" value="PRIVATE_PASSWORD_9283" /></body></html>` }));
    const page = await context.newPage();
    await page.goto("https://review.pinar.test/one?access_token=PRIVATE_QUERY_8293");
    const inject = async (worker: Worker) => worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      // Expose the production shadow tree in the extension's isolated world for assertions.
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: "open" }); };
      } });
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ["coordinates.js", "frame-path.js", "locators.js", "privacy.js", "snapshot.js", "evidence.js", "keyboard.js", "content.js"] });
    });
    await inject(worker);
    await expect(page.locator('[data-pinar="host"]')).toBeVisible();
    const toolbar = page.locator('[data-pinar="host"] .toolbar');
    const review = page.locator('[data-ref="reviewPanel"]');
    await expect(toolbar.locator('[data-hint="review"] .long')).toHaveText("Review session");
    await page.screenshot({ path: testInfo.outputPath("toolbar-tab-review.png") });
    await expect(page.locator('[data-ref="batchPill"]')).toHaveCount(0);
    const bar = (await toolbar.boundingBox())!;
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await expect(toolbar).toHaveCSS("pointer-events", "none");
    await expect(toolbar).toHaveCSS("opacity", "0");
    await page.mouse.move(20, 90);
    await page.keyboard.press("Tab");
    await expect(review).toBeVisible();
    await expect(toolbar).toBeHidden();
    await expect(review).not.toBeFocused();
    await expect(page.getByRole("button", { name: "Back to page" })).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute("data-pinar-active");
    await expect(review).toHaveCSS("cursor", "default");
    const panel = (await review.boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(16);
    expect(panel.y).toBe(16);
    await page.screenshot({ path: testInfo.outputPath("toolbar-review.png") });
    await page.setViewportSize({ width: 360, height: 640 });
    const narrow = (await review.boundingBox())!;
    expect(narrow.x).toBeGreaterThanOrEqual(16);
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(344);
    await page.screenshot({ path: testInfo.outputPath("toolbar-review-narrow.png") });
    await page.keyboard.press("Escape");
    await expect(review).toBeHidden();
    await expect(toolbar).toBeVisible();
    await page.setViewportSize({ width: 1100, height: 720 });
    await expect(toolbar.locator('[data-hint="copy"] .short')).toBeVisible();
    await expect(toolbar.locator('[data-hint="copy"] .short')).toHaveText("Finish");
    await page.setViewportSize({ width: 960, height: 720 });
    await expect(toolbar.locator('.online-view > .state-icon')).toBeHidden();
    await expect(toolbar.locator('[data-hint="pin"]')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("toolbar-compact.png") });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.mouse.move(20, 90);
    await page.mouse.click(180, 160);
    await page.keyboard.press("Tab");
    await expect(review).toBeHidden();
    await page.locator('[data-ref="input"]').focus();
    await page.keyboard.type("First page comment PRIVATE_PASSWORD_9283");
    await page.keyboard.press("Enter");
    await expect.poll(async () => {
      const entry = (await readDraft())?.entries[0];
      return entry?.status === "saved" ? "saved" : entry?.error || entry?.status;
    }).toBe("saved");
    const first = await readDraft();
    expect(first.entries[0].shot).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(first)).not.toContain("PRIVATE_PASSWORD_9283");
    expect(JSON.stringify(first)).not.toContain("PRIVATE_QUERY_8293");
    expect(first.entries[0].pin.comment).toContain("[redacted]");
    await page.keyboard.press("Tab");
    await expect(review).toBeVisible();
    await expect(toolbar).toBeHidden();
    await expect(review).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(review.locator(".review-preview")).toBeVisible();
    await expect(review.locator(".review-path")).toBeVisible();
    await review.locator(".review-comment").fill("Edited from review PRIVATE_PASSWORD_9283");
    await review.locator(".review-heading strong").click();
    await expect.poll(async () => (await readDraft())?.entries[0]?.pin.comment).toBe("Edited from review [redacted]");
    expect((await readDraft()).entries[0].shot).toBe(first.entries[0].shot);
    await expect(review.locator(".review-preview")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("toolbar-review-active.png") });
    await page.setViewportSize({ width: 360, height: 640 });
    expect(await review.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("toolbar-review-active-narrow.png") });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.keyboard.press("Tab");
    await expect(review).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute("data-pinar-active");
    await page.evaluate(() => { document.body.style.background = "#dbeafe"; });
    await page.mouse.click(480, 160);
    await page.keyboard.type("Another state on first page");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries[1]?.status).toBe("saved");
    await page.keyboard.press("Escape");
    expect((await readDraft()).entries).toHaveLength(2);
    await page.goto("https://review.pinar.test/two");
    await expect(page.locator('[data-pinar="host"]')).toBeAttached();
    await expect(page.locator('[data-pinar="host"]')).toBeHidden();
    await inject(worker);
    await expect(page.locator('[data-pinar="host"]')).toBeVisible();
    await worker.evaluate(() => { (globalThis as any).__reviewOffline = true; });
    await page.mouse.click(180, 160);
    await page.keyboard.type("Second page comment");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries.length).toBe(3);
    await expect.poll(async () => Boolean((await readDraft())?.entries[2]?.shot)).toBe(true);
    await pressCopyShortcut(page);
    await expect.poll(async () => (await readDraft())?.entries[2]?.status).toBe("pending");
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("aria-busy", "false");
    await worker.evaluate(() => { (globalThis as any).__reviewOffline = false; });
    await pressCopyShortcut(page);
    await expect.poll(readDraft).toBeNull();
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("data-confirm", "");
    await page.screenshot({ path: testInfo.outputPath("session-finished.png") });
    const saved = await worker.evaluate(() => Object.values((globalThis as any).__reviewSaved) as any[]);
    expect(saved).toHaveLength(3);
    expect(saved.map((entry) => entry.pins[0].number)).toEqual([1, 2, 3]);
    expect(new Set(saved.map((entry) => entry.batch.id)).size).toBe(1);
    expect(saved[0].id).toBe(first.entries[0].captureId);
    expect(saved.map((entry) => entry.page.url.split("?")[0])).toEqual(["https://review.pinar.test/one", "https://review.pinar.test/one", "https://review.pinar.test/two"]);
    expect(saved[0].image).toBe(first.entries[0].shot);
    await expect(page.locator('[data-pinar="host"]')).toBeHidden();
    await page.goto("https://review.pinar.test/three");
    await inject(worker);
    await worker.evaluate(() => { (globalThis as any).__reviewOffline = true; });
    await page.mouse.click(180, 160);
    await page.keyboard.type("Cancel this session");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries[0]?.status).toBe("pending");
    await pressCopyShortcut(page);
    await expect(page.locator('[data-ref="reviewStatus"]')).toBeVisible();
    await expect(page.locator('[data-ref="reviewStatus"]')).toContainText("Could not finish the session");
    await page.screenshot({ path: testInfo.outputPath("session-finish-failed.png") });
    await worker.evaluate(() => { (globalThis as any).__reviewOffline = false; });
    await review.locator('[data-ref="reviewDiscard"]').click();
    await expect.poll(readDraft).toBeNull();
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("data-confirm", "");
    await expect(toolbar).toContainText("Session cancelled");
  } finally { await context.close(); }
});
