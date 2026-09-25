import { chromium, expect, test, type Worker } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveCloudUrl } from "../../../extension/environment.js";
import { remoteProfileKey } from "../../../extension/remote-profile.js";
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
    const manifest = JSON.parse(readFileSync(resolve("extension/manifest.json"), "utf8"));
    const deviceTokenKey = remoteProfileKey(resolveCloudUrl(manifest), "deviceToken");
    await worker.evaluate(async ({ mode, deviceTokenKey }) => {
      const saved: Record<string, any> = {};
      (globalThis as any).__reviewSaved = saved;
      (globalThis as any).__reviewOffline = false;
      (globalThis as any).__reviewFinishCalls = 0;
      (globalThis as any).__reviewFinishBlocked = false;
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
        if (path.startsWith("/api/batches/") && path.endsWith("/finish")) {
          (globalThis as any).__reviewFinishCalls += 1;
          while ((globalThis as any).__reviewFinishBlocked) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return json({ ok: true });
        }
        if (path.startsWith("/api/batches/")) return json({ ok: true });
        if (path.startsWith("/b/")) return new Response(Object.values(saved).flatMap((entry) => entry.pins.map((pin: any) => pin.comment)).join("\n"));
        throw new Error(`Unexpected test request: ${path}`);
      };
      await chrome.storage.sync.set({ storageMode: mode, cloudUrl: "https://review-server.test", language: "en", enableHistory: true });
      await chrome.storage.local.set({
        remoteLegalAcceptance: { accepted: true, locale: "en", acceptableUseVersion: "2026-09-14", privacyVersion: "2026-09-14", termsVersion: "2026-09-14" },
        ...(mode === "cloud" ? { [deviceTokenKey]: `pdt_${"A".repeat(43)}` } : {}),
      });
    }, { mode, deviceTokenKey });
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
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ["coordinates.js", "frame-path.js", "locators.js", "privacy.js", "snapshot.js", "evidence.js", "keyboard.js", "voice.js", "content.js"] });
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
    await expect(page.locator('[data-pinar="host"]')).not.toHaveAttribute("data-progress", "");
    await worker.evaluate(() => {
      (globalThis as any).__reviewOffline = false;
      (globalThis as any).__reviewFinishBlocked = true;
    });
    await pressCopyShortcut(page);
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("aria-busy", "true");
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("aria-label", "Saving the session…");
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("data-progress", "");
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("data-indeterminate", "");
    await expect(page.locator('[data-pinar="host"]')).not.toHaveAttribute("data-review-open", "");
    await page.mouse.click(180, 160);
    await expect.poll(async () => (await readDraft())?.entries.length).toBe(3);
    await pressCopyShortcut(page);
    await expect.poll(() => worker.evaluate(() => (globalThis as any).__reviewFinishCalls)).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("session-finishing.png") });
    await page.setViewportSize({ width: 360, height: 640 });
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("aria-label", "Saving the session…");
    await page.screenshot({ path: testInfo.outputPath("session-finishing-narrow.png") });
    await page.setViewportSize({ width: 1280, height: 720 });
    await worker.evaluate(() => { (globalThis as any).__reviewFinishBlocked = false; });
    await expect.poll(readDraft).toBeNull();
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("data-confirm", "");
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("aria-label", "Session saved");
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

test("session screenshot waits until the pin popover is off the composited frame", async () => {
  test.setTimeout(60_000);
  const extension = resolve("extension");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
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
        if (path === "/api/shots" || path === "/api/history") return json({ ok: true, path: "/shots/popover.png" }, 201);
        if (path.startsWith("/api/batches/")) return json({ ok: true });
        throw new Error(`Unexpected test request: ${path}`);
      };
      await chrome.storage.sync.set({ storageMode: "local", cloudUrl: "https://review-server.test", language: "en", enableHistory: true });
      await chrome.storage.local.set({
        remoteLegalAcceptance: { accepted: true, locale: "en", acceptableUseVersion: "2026-09-14", privacyVersion: "2026-09-14", termsVersion: "2026-09-14" },
      });
    });
    const readDraft = () => worker.evaluate(async () => {
      return new Promise<any>((resolvePromise, reject) => {
        const request = indexedDB.open("pinar-review-draft", 1);
        request.onsuccess = () => {
          const database = request.result;
          const read = database.transaction("drafts").objectStore("drafts").get("active");
          read.onsuccess = () => { resolvePromise(read.result || null); database.close(); };
          read.onerror = () => reject(read.error);
        };
        request.onerror = () => reject(request.error);
      });
    });
    await context.route("https://review.pinar.test/**", (route) => route.fulfill({
      contentType: "text/html",
      body: "<html><head><style>html,body{margin:0;background:#ff00aa;min-height:100%}</style></head><body><iframe src=\"about:blank\" title=\"hidden-frame\" style=\"display:none\"></iframe></body></html>",
    }));
    const page = await context.newPage();
    await page.goto("https://review.pinar.test/popover");
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: "open" }); };
      } });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        files: ["coordinates.js", "frame-path.js", "locators.js", "privacy.js", "snapshot.js", "evidence.js", "keyboard.js", "voice.js", "floating.js", "content.js"],
      });
    });
    await expect(page.locator('[data-pinar="host"]')).toBeVisible();
    await expect.poll(async () => worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        func: () => window.frameElement ? getComputedStyle(window.frameElement).display : "top",
        target: { allFrames: true, tabId: tab.id! },
      });
      return results.map((item) => item.result);
    })).toContain("none");
    await page.mouse.click(200, 180);
    await page.locator('[data-ref="input"]').focus();
    await page.keyboard.type("desalinhado");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries[0]?.status).toBe("saved");
    const marker = page.locator('[data-pinar="host"] .marker');
    await marker.hover();
    const preview = page.locator('[data-pinar="host"] .preview.is-open');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("desalinhado");
    const pinPoint = await marker.evaluate((pin) => {
      if (!(pin instanceof HTMLElement)) throw new Error("marker missing");
      return { x: Number.parseFloat(pin.style.left), y: Number.parseFloat(pin.style.top) };
    });
    const card = await preview.boundingBox();
    if (!card) throw new Error("preview box missing");
    const geometry = {
      dpr: await page.evaluate(() => window.devicePixelRatio),
      pinX: pinPoint.x,
      pinY: pinPoint.y,
      sampleX: card.x + Math.min(card.width - 4, 46),
      sampleY: card.y + card.height / 2,
    };
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await Promise.race([
        chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          func: () => globalThis.__pinarSyncPins(true, true),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("capture hung")), 5000)),
      ]);
    });
    await expect(page.locator('[data-pinar="host"]')).toBeVisible();
    const shot = (await readDraft()).entries[0].shot as string;
    expect(shot).toMatch(/^data:image\/png;base64,/);
    const pixel = await page.evaluate(async ({ shot, geometry }) => {
      const image = new Image();
      image.src = shot;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(image, 0, 0);
      const pad = 200 * geometry.dpr;
      const cropX = Math.max(0, Math.round(geometry.pinX * geometry.dpr - pad));
      const cropY = Math.max(0, Math.round(geometry.pinY * geometry.dpr - pad));
      const x = Math.round(geometry.sampleX * geometry.dpr) - cropX;
      const y = Math.round(geometry.sampleY * geometry.dpr) - cropY;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const inside = x >= 0 && y >= 0 && x < canvas.width && y < canvas.height;
      const offset = (y * canvas.width + x) * 4;
      return {
        b: inside ? data[offset + 2] : -1,
        g: inside ? data[offset + 1] : -1,
        height: canvas.height,
        inside,
        r: inside ? data[offset] : -1,
        width: canvas.width,
        x,
        y,
      };
    }, { geometry, shot });
    expect(pixel.inside).toBe(true);
    // Page fixture is #ff00aa. The pin popover is a near-white card; capturing
    // it moves this sample from low green / mid blue to high green and blue.
    expect(pixel.g).toBeLessThan(40);
    expect(pixel.b).toBeGreaterThan(120);
    expect(pixel.b).toBeLessThan(210);
  } finally {
    await context.close();
  }
});
