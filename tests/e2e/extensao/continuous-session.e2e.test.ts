import { chromium, expect, test, type Worker } from "@playwright/test";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
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
    // Same path as the action/shortcut: the toolbar's persisted visibility is
    // owned by the service worker, so an explicit show must go through the
    // content toggle, not a fresh injection.
    const showToolbar = () => worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { frameIds: [0], tabId: tab.id! },
        func: () => globalThis.__pinarToggle?.(),
      });
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
    // The service worker re-injects the overlay with the persisted toolbar
    // visibility: the test never used the action, so the toolbar stays hidden
    // across the navigation. The manual inject only re-exposes the shadow tree.
    await expect(page.locator('[data-pinar="host"]')).toBeAttached();
    await expect(page.locator('[data-pinar="host"]')).toBeHidden();
    await inject(worker);
    await showToolbar();
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
    // A failed finish keeps review closed (it only reopens if it was already open)
    // and the host announces the failure; the timed banner is not asserted.
    await expect(page.locator('[data-pinar="host"]')).not.toHaveAttribute("data-review-open", "");
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("data-confirm", "");
    await expect(page.locator('[data-pinar="host"]')).toHaveAttribute("aria-label", /Could not finish the session/);
    await page.screenshot({ path: testInfo.outputPath("session-finish-failed.png") });
    await worker.evaluate(() => { (globalThis as any).__reviewOffline = false; });
    // Tab is the manual review: the pending pin is still there and can be discarded.
    await page.keyboard.press("Tab");
    await expect(review).toBeVisible();
    await expect(review.locator(".review-status")).toContainText("Pending");
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

// Pins of an active (unfinished) session must come back when the user returns
// to their original page: the durable draft lives in the service worker, the
// page-local overlay state does not. Restore pulls only the sanitized entries
// of the current page/frame; it never re-captures, never shows a hidden
// toolbar, and a finished or discarded draft restores nothing.
test("active session pins survive back/forward, reload and re-injection on their original pages", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const extension = resolve("extension");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  // Evidence trail: draft count/ids before and after every pin, attached to
  // the test result so a failure shows exactly where a pin was lost.
  const pinTrail: { label: string; phase: "before" | "after"; at: string; draft: unknown }[] = [];
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
     const saved: Record<string, any> = {};
     const deleted: string[] = [];
     (globalThis as any).__reviewDeleted = deleted;
     // The product shadow is closed by design. chrome.scripting.executeScript
     // (func and files) shares a world per frame, so opening attachShadow
     // through the same channel reaches content.js without adding a second
     // live content instance to the page.
     const originalExecuteScript = chrome.scripting.executeScript.bind(chrome.scripting);
     (chrome.scripting as any).executeScript = (injection: any) => {
       const files: unknown = injection?.files;
       if (Array.isArray(files) && files.includes("content.js")) {
         const { files: _files, ...rest } = injection;
         return originalExecuteScript({
           ...rest,
           func: () => {
             if ((globalThis as any).__pinarShadowOpen) return;
             (globalThis as any).__pinarShadowOpen = true;
             const attach = Element.prototype.attachShadow;
             Element.prototype.attachShadow = function (options: any) {
               return attach.call(this, { ...options, mode: "open" });
             };
           },
         }).then(() => originalExecuteScript(injection));
       }
       return originalExecuteScript(injection);
     };
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
          const body = JSON.parse(String(init?.body));
          saved[body.id] = body;
          return json({ ok: true, path: `/shots/${body.id}.png` }, 201);
        }
        if (path.startsWith("/api/history/") && init?.method === "DELETE") { deleted.push(path.split("/").pop()!); delete saved[path.split("/").pop()!]; return json({ ok: true }); }
        if (path.startsWith("/api/batches/")) return json({ ok: true });
        throw new Error(`Unexpected test request: ${path}`);
      };
      await chrome.storage.sync.set({ storageMode: "local", cloudUrl: "https://review-server.test", language: "en", enableHistory: true });
      await chrome.storage.local.set({
        remoteLegalAcceptance: { accepted: true, locale: "en", acceptableUseVersion: "2026-09-14", privacyVersion: "2026-09-14", termsVersion: "2026-09-14" },
      });
    });
    const readDraft = () => worker.evaluate(async () => {
      return new Promise<any>((resolveDraft, reject) => {
        const request = indexedDB.open("pinar-review-draft", 1);
        request.onsuccess = () => {
          const database = request.result;
          const read = database.transaction("drafts").objectStore("drafts").get("active");
          read.onsuccess = () => { resolveDraft(read.result || null); database.close(); };
          read.onerror = () => reject(read.error);
        };
        request.onerror = () => reject(request.error);
      });
    });
    const inject = async () => worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: "open" }); };
      } });
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ["coordinates.js", "frame-path.js", "locators.js", "privacy.js", "snapshot.js", "evidence.js", "keyboard.js", "voice.js", "content.js"] });
    });
    // The toolbar's persisted visibility is owned by the service worker; the
    // explicit show/hide must go through the same toggle as the action.
    // The resume chain may still be injecting content.js, so the instance
    // (and __pinarToggle) can be absent from the current document: a toggle
    // issued then would be silently consumed by the no-op. Wait, bounded,
    // for the instance to exist before toggling - the assertions that follow
    // still exercise the product's visibility/restore races.
    const toggleToolbar = async () => {
      const [tab] = await worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
      await expect.poll(async () => worker.evaluate(async (tabId: number) => {
        const r = await chrome.scripting.executeScript({
          target: { frameIds: [0], tabId },
          func: () => Boolean((globalThis as any).__pinarToggle),
        }).catch(() => []);
        return Boolean(r?.[0]?.result);
      }, tab?.id ?? -1), { timeout: 15_000, message: "the toolbar instance never mounted" }).toBe(true);
      await worker.evaluate(async (tabId: number) => {
        await chrome.scripting.executeScript({
          target: { frameIds: [0], tabId },
          func: () => (globalThis as any).__pinarToggle?.(),
        }).catch(() => null);
      }, tab?.id ?? -1);
    };
    const alphaUrl = "https://review.pinar.test/alpha?access_token=PRIVATE_QUERY_4571";
    const betaUrl = "https://review.pinar.test/beta";
    const gammaUrl = "https://review.pinar.test/gamma";
    const alphaBody = `<html><title>Alpha</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="alpha-one" style="width:250px;height:150px">Alpha one</button><button id="alpha-two" style="width:250px;height:150px">Alpha two</button><button id="alpha-three" style="width:250px;height:100px;margin-top:80px">Alpha three</button><a href="/beta">go beta</a></body></html>`;
    const betaBody = `<html><title>Beta</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="beta-one" style="width:250px;height:150px">Beta one</button><button id="beta-two" style="width:250px;height:150px">Beta two</button><a href="/alpha">go alpha</a></body></html>`;
    let gammaBody = `<html><title>Gamma</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="gamma-target" style="width:250px;height:150px">Gamma target</button><a href="/beta">go beta</a></body></html>`;
    await context.route("https://review.pinar.test/alpha*", (route) => route.fulfill({ contentType: "text/html", body: alphaBody }));
    await context.route("https://review.pinar.test/beta*", (route) => route.fulfill({ contentType: "text/html", body: betaBody }));
    await context.route("https://review.pinar.test/gamma*", (route) => route.fulfill({ contentType: "text/html", body: gammaBody }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const markerShape = () => page.locator('[data-pinar="host"] .marker').evaluateAll((nodes) => nodes.map((node) => ({
      dataPin: node.getAttribute("data-pin"),
      number: node.querySelector(".marker-n")?.textContent ?? "",
      pending: node.classList.contains("is-pending"),
      x: Number.parseFloat(node.style.left),
      y: Number.parseFloat(node.style.top),
    })));
    const pinAt = async (x: number, y: number, comment: string) => {
      await page.mouse.click(x, y);
      // Wait until Pinar has opened the composer and focused its input; the
      // click-to-focus handoff is product-owned, so typing before it races.
      await expect(page.locator('[data-ref="input"]')).toBeFocused({ timeout: 15_000 });
      await page.keyboard.type(comment);
      await page.keyboard.press("Enter");
    };
    const draftSnapshot = async () => {
      const draft = await readDraft();
      return {
        count: draft?.entries?.length ?? null,
        entries: (draft?.entries ?? []).map((entry: any) => ({
          captureId: entry.captureId,
          pinId: entry.pin?.pinId,
          number: entry.pin?.number,
          comment: entry.pin?.comment,
          status: entry.status,
          deleted: entry.deleted === true,
        })),
      };
    };
    // The composer must be closed before the next pin click so a click can
    // never land while a confirmation/capture is still settling.
    const pin = async (label: string, x: number, y: number, comment: string) => {
      pinTrail.push({ label, phase: "before", at: new Date().toISOString(), draft: await draftSnapshot() });
      await pinAt(x, y, comment);
      await expect(page.locator('[data-ref="composer"]')).toBeHidden({ timeout: 15_000 });
      pinTrail.push({ label, phase: "after", at: new Date().toISOString(), draft: await draftSnapshot() });
    };
    const review = page.locator('[data-ref="reviewPanel"]');

    // ---- Alpha: pins 1 and 2, on a URL with a secret query parameter.
    await page.goto(alphaUrl);
    await inject();
    await expect(host()).toBeVisible();
    await pin("alpha-one", 180, 160, "Alpha one");
    // First pin fully saved (and composer closed) before the second click.
    await expect.poll(async () => (await readDraft())?.entries[0]?.status, { timeout: 15_000 }).toBe("saved");
    await pin("alpha-two", 480, 160, "Alpha two");
    await expect.poll(async () => (await readDraft())?.entries.length, { timeout: 15_000 }).toBe(2);
    await expect.poll(async () => (await readDraft())?.entries.every((entry: any) => entry.status === "saved"), { timeout: 15_000 }).toBe(true);
    const alphaDraft = await readDraft();
    const [alphaOne, alphaTwo] = alphaDraft.entries.map((entry: any) => entry.pin.pinId as string);
    const alphaTwoCaptureId = alphaDraft.entries[1].captureId as string;
    expect(alphaDraft.entries.map((entry: any) => entry.pin.number)).toEqual([1, 2]);
    // The durable draft keeps the sanitized URL (query value redacted, raw
    // secret never stored) - restore matches against this same form.
    const redactedAlphaUrl = "https://review.pinar.test/alpha?access_token=%5Bredacted%5D";
    expect(alphaDraft.entries.map((entry: any) => entry.page.url)).toEqual([redactedAlphaUrl, redactedAlphaUrl]);
    expect(JSON.stringify(alphaDraft)).not.toContain("PRIVATE_QUERY_4571");
    let markers = await markerShape();
    expect(markers.map((marker) => marker.number)).toEqual(["1", "2"]);
    expect(new Set(markers.map((marker) => marker.dataPin))).toEqual(new Set([alphaOne, alphaTwo]));
    const alphaOneBox = (await page.locator("#alpha-one").boundingBox())!;

    // ---- Hidden toolbar stays hidden across navigation; no restore shows.
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await page.click("a");
    await expect(page).toHaveURL(betaUrl);
    await expect(host()).toBeAttached();
    await expect(host()).toBeHidden();
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await expect(page.locator('[data-pinar="host"] .marker')).toHaveCount(0);
    await pin("beta-one", 180, 160, "Beta one");
    // First beta pin fully saved (and composer closed) before the second click.
    await expect.poll(async () => (await readDraft())?.entries[2]?.status, { timeout: 15_000 }).toBe("saved");
    await pin("beta-two", 480, 160, "Beta two");
    await expect.poll(async () => (await readDraft())?.entries.length, { timeout: 15_000 }).toBe(4);
    await expect.poll(async () => (await readDraft())?.entries.every((entry: any) => entry.status === "saved"), { timeout: 15_000 }).toBe(true);
    const betaDraft = await readDraft();
    const [betaOne, betaTwo] = betaDraft.entries.slice(2).map((entry: any) => entry.pin.pinId as string);
    expect(betaDraft.entries.slice(2).map((entry: any) => entry.pin.number)).toEqual([3, 4]);
    markers = await markerShape();
    expect(markers.map((marker) => marker.number)).toEqual(["3", "4"]);
    expect(new Set(markers.map((marker) => marker.dataPin))).toEqual(new Set([betaOne, betaTwo]));

    // ---- Back to Alpha (browser back): hidden persists, explicit show
    // restores pins 1 and 2 with their ids, numbers and saved geometry.
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(alphaUrl);
    await expect(host()).toBeAttached();
    await expect(host()).toBeHidden();
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await expect.poll(markerShape, { timeout: 15_000 }).toEqual([
      { dataPin: alphaOne, number: "1", pending: false, x: expect.any(Number), y: expect.any(Number) },
      { dataPin: alphaTwo, number: "2", pending: false, x: expect.any(Number), y: expect.any(Number) },
    ]);
    markers = await markerShape();
    const restoredOne = markers.find((marker) => marker.dataPin === alphaOne)!;
    expect(restoredOne.x).toBeGreaterThanOrEqual(alphaOneBox.x - 12);
    expect(restoredOne.x).toBeLessThanOrEqual(alphaOneBox.x + alphaOneBox.width + 12);
    expect(restoredOne.y).toBeGreaterThanOrEqual(alphaOneBox.y - 12);
    expect(restoredOne.y).toBeLessThanOrEqual(alphaOneBox.y + alphaOneBox.height + 12);

    // ---- Reload + re-injection: hidden persists again, restore still returns
    // the same pins (no duplicates, no new captures).
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await page.reload();
    await expect(host()).toBeAttached();
    await expect(host()).toBeHidden();
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await expect.poll(markerShape, { timeout: 15_000 }).toEqual([
      { dataPin: alphaOne, number: "1", pending: false, x: expect.any(Number), y: expect.any(Number) },
      { dataPin: alphaTwo, number: "2", pending: false, x: expect.any(Number), y: expect.any(Number) },
    ]);
    expect((await readDraft()).entries.length).toBe(4);

    // ---- Editing a restored pin updates the same draft entry, no recapture.
    await page.keyboard.press("Tab");
    await expect(review).toBeVisible();
    const firstShot = (await readDraft()).entries[0].shot;
    await review.locator(".review-comment").first().fill("Edited restored alpha one");
    // fill() only dispatches input; the real change event fires on blur.
    await review.locator(".review-heading strong").first().click();
    await expect.poll(async () => (await readDraft())?.entries[0]?.pin.comment, { timeout: 15_000 }).toBe("Edited restored alpha one");
    expect((await readDraft()).entries[0].pin.pinId).toBe(alphaOne);
    expect((await readDraft()).entries[0].shot).toBe(firstShot);
    await page.keyboard.press("Escape");
    await expect(review).toBeHidden();
    await expect.poll(markerShape, { timeout: 15_000 }).toEqual([
      { dataPin: alphaOne, number: "1", pending: false, x: expect.any(Number), y: expect.any(Number) },
      { dataPin: alphaTwo, number: "2", pending: false, x: expect.any(Number), y: expect.any(Number) },
    ]);

    // ---- Deleting a restored pin removes the same draft entry.
    await page.locator(`[data-pinar="host"] .marker[data-pin="${alphaTwo}"]`).click();
    const composer = page.locator('[data-ref="composer"]');
    await expect(composer).toBeVisible();
    await composer.locator('[data-ref="deleteDraft"]').click();
    await expect.poll(async () => (await readDraft())?.entries[1]?.deleted, { timeout: 15_000 }).toBe(true);
    markers = await markerShape();
    expect(markers).toHaveLength(1);
    expect(markers[0].dataPin).toBe(alphaOne);
    // Numbers are stable global numbers; deletion never renumbers survivors.
    expect(markers[0].number).toBe("1");

    // ---- A new pin continues the global numbering: 5.
    await pin("alpha-three", 180, 400, "Alpha three");
    await expect.poll(async () => (await readDraft())?.entries.length, { timeout: 15_000 }).toBe(5);
    await expect.poll(async () => (await readDraft())?.entries[4]?.status, { timeout: 15_000 }).toBe("saved");
    expect((await readDraft()).entries[4].pin.number).toBe(5);
    const fifth = (await readDraft()).entries[4].pin.pinId as string;
    await expect.poll(markerShape, { timeout: 15_000 }).toEqual([
      { dataPin: alphaOne, number: "1", pending: false, x: expect.any(Number), y: expect.any(Number) },
      { dataPin: fifth, number: "5", pending: false, x: expect.any(Number), y: expect.any(Number) },
    ]);

    // ---- Missing-location fallback: the pinned element disappears while the
    // user is away; the restored marker keeps the saved geometry (pending)
    // instead of snapping to the unrelated element that took its place.
    await page.goto(gammaUrl);
    await expect(host()).toBeAttached();
    // The toolbar was visible when the user left, so the persisted visibility
    // carries over; restore shows the page's own pins and no foreign ones.
    await expect(host()).toBeVisible();
    await expect(page.locator('[data-pinar="host"] .marker')).toHaveCount(0);
    await pin("gamma-one", 180, 160, "Gamma one");
    await expect.poll(async () => (await readDraft())?.entries.length, { timeout: 15_000 }).toBe(6);
    await expect.poll(async () => (await readDraft())?.entries[5]?.status, { timeout: 15_000 }).toBe("saved");
    const gammaOne = (await readDraft()).entries[5].pin.pinId as string;
    const gammaBox = (await page.locator("#gamma-target").boundingBox())!;
    gammaBody = `<html><title>Gamma</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="gamma-other" style="width:250px;height:150px;margin-left:300px">Gamma other</button><a href="/beta">go beta</a></body></html>`;
    await page.goto(betaUrl);
    await expect(host()).toBeAttached();
    await expect(host()).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(gammaUrl);
    await expect(host()).toBeAttached();
    await expect(host()).toBeVisible();
    await expect.poll(async () => {
      const current = await markerShape();
      return current.length === 1 && current[0].dataPin === gammaOne && current[0].pending;
    }, { timeout: 15_000 }).toBe(true);
    const fallback = (await markerShape())[0];
    expect(fallback.x).toBeGreaterThanOrEqual(gammaBox.x - 12);
    expect(fallback.x).toBeLessThanOrEqual(gammaBox.x + gammaBox.width + 12);
    expect(fallback.y).toBeGreaterThanOrEqual(gammaBox.y - 12);
    expect(fallback.y).toBeLessThanOrEqual(gammaBox.y + gammaBox.height + 12);

    // ---- Finish: the completed draft cannot restore pins.
    await pressCopyShortcut(page);
    await expect.poll(readDraft, { timeout: 15_000 }).toBeNull();
    await expect(host()).toHaveAttribute("data-confirm", "");
    await expect(host()).toHaveAttribute("aria-label", "Session saved");
    await expect(host()).toBeHidden();
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await expect(page.locator('[data-pinar="host"] .marker')).toHaveCount(0);

    // ---- Discard: the discarded draft cannot restore pins either.
    await pin("gamma-two", 480, 160, "Gamma two");
    await expect.poll(async () => (await readDraft())?.entries.length, { timeout: 15_000 }).toBe(1);
    await page.keyboard.press("Tab");
    await expect(review).toBeVisible();
    await review.locator('[data-ref="reviewDiscard"]').click();
    await expect.poll(readDraft, { timeout: 15_000 }).toBeNull();
    await expect(host()).toBeHidden();
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await expect(page.locator('[data-pinar="host"] .marker')).toHaveCount(0);
    // Deleting the restored pin removed the same durable entry's evidence by
    // capture id (not the pin id); the survivor kept its stable number above.
    expect(await worker.evaluate(() => (globalThis as any).__reviewDeleted as string[])).toContain(alphaTwoCaptureId);
  } finally {
    // Attach the pin evidence trail regardless of outcome, so a failure shows
    // the draft count/ids captured before and after every pin.
    if (pinTrail.length) {
      await testInfo.attach("pin-trail", {
        body: JSON.stringify(pinTrail, null, 2),
        contentType: "application/json",
      }).catch(() => {});
    }
    await context.close();
  }
});

// Shared isolated-context setup: real MV3 service worker, IndexedDB, content
// scripts and screenshot API; only the HTTP transport is mocked. The shadow
// wrapper opens the product's shadow root (through the same isolated-world
// injection channel) so assertions can read markers/composer state in every
// frame without adding a second live content instance.
const extensionCopies: string[] = [];
test.afterAll(async () => {
  for (const dir of extensionCopies.splice(0)) await rm(dir, { recursive: true, force: true }).catch(() => null);
});

// The product's shadow root is closed by design, and the marker/composer
// assertions read it through the isolated world. A main-world init patch
// cannot help: DOM interface prototypes are per-world, so a patch applied in
// the page's main world is invisible to the isolated world that content.js
// runs in. The isolated-world wrapper below therefore re-opens the shadow
// ahead of every content.js files injection it observes - but the resume
// chain injects content.js on its own (by tab only): that patch can land in
// the older document while content.js lands in the newer one, and the newer
// document's closed shadow then keeps markers invisible to assertions even
// though the product state is correct. To close that window deterministically,
// load a temporary copy of the extension that registers a document_start
// content script in the isolated world: it patches the prototype in every
// document and every frame before any product injection can run, with no
// ordering window left. The checkout's extension/ directory stays untouched.
async function setupRaceContext() {
  const extensionSource = resolve("extension");
  const extension = await mkdtemp(join(tmpdir(), "pinar-e2e-ext-"));
  extensionCopies.push(extension);
  await cp(extensionSource, extension, { recursive: true });
  await writeFile(join(extension, "__test-shadow-open.js"), [
    "(() => {",
    "  if (globalThis.__pinarShadowOpen) return;",
    "  globalThis.__pinarShadowOpen = true;",
    "  const attach = Element.prototype.attachShadow;",
    "  Element.prototype.attachShadow = function (options) {",
    "    return attach.call(this, { ...options, mode: \"open\" });",
    "  };",
    "})();",
    "",
  ].join("\n"));
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(async () => {
    // Test-only, session-scoped: it dies with the worker. Runs in the
    // isolated world of every document/frame of the fixture origin, before
    // the product's own document_start work and long before its files
    // injections (which only fire on navigation complete).
    try {
      await chrome.scripting.registerContentScripts([{
        allFrames: true,
        id: "pinar-test-shadow-open",
        js: ["__test-shadow-open.js"],
        matches: ["https://review.pinar.test/*"],
        runAt: "document_start",
        world: "ISOLATED",
      }]);
    } catch (error) {
      throw new Error(`test shadow-open content script registration failed: ${String((error as any)?.message ?? error)}`);
    }
    const saved: Record<string, any> = {};
    (globalThis as any).__reviewSaved = saved;
    const originalExecuteScript = chrome.scripting.executeScript.bind(chrome.scripting);
    (chrome.scripting as any).executeScript = (injection: any) => {
      const files: unknown = injection?.files;
      if (Array.isArray(files) && files.includes("content.js")) {
        const { files: _files, ...rest } = injection;
        return originalExecuteScript({
          ...rest,
          func: () => {
            if ((globalThis as any).__pinarShadowOpen) return;
            (globalThis as any).__pinarShadowOpen = true;
            const attach = Element.prototype.attachShadow;
            Element.prototype.attachShadow = function (options: any) {
              return attach.call(this, { ...options, mode: "open" });
            };
          },
        }).then(() => originalExecuteScript(injection));
      }
      return originalExecuteScript(injection);
    };
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
        const body = JSON.parse(String(init?.body));
        saved[body.id] = body;
        return json({ ok: true, path: `/shots/${body.id}.png` }, 201);
      }
      if (path.startsWith("/api/history/") && init?.method === "DELETE") { delete saved[path.split("/").pop()!]; return json({ ok: true }); }
      if (path.startsWith("/api/batches/")) return json({ ok: true });
      throw new Error(`Unexpected test request: ${path}`);
    };
    await chrome.storage.sync.set({ storageMode: "local", cloudUrl: "https://review-server.test", language: "en", enableHistory: true });
    await chrome.storage.local.set({
      remoteLegalAcceptance: { accepted: true, locale: "en", acceptableUseVersion: "2026-09-14", privacyVersion: "2026-09-14", termsVersion: "2026-09-14" },
    });
  });
  const readDraft = () => worker.evaluate(async () => new Promise<any>((resolveDraft, reject) => {
    const request = indexedDB.open("pinar-review-draft", 1);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction("drafts").objectStore("drafts").get("active");
      read.onsuccess = () => { resolveDraft(read.result || null); database.close(); };
      read.onerror = () => reject(read.error);
    };
    request.onerror = () => reject(request.error);
  }));
  const injectAll = () => worker.evaluate(async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({ target: { tabId: t.id!, allFrames: true }, func: () => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (options: any) { return attach.call(this, { ...options, mode: "open" }); };
    } });
    await chrome.scripting.executeScript({ target: { tabId: t.id!, allFrames: true }, files: ["coordinates.js", "frame-path.js", "locators.js", "privacy.js", "snapshot.js", "evidence.js", "keyboard.js", "voice.js", "content.js"] });
  });
  // The resume chain injects content.js per tab, so right after a
  // navigation the instance (and __pinarToggle) can still be missing from
  // the current document: a toggle issued then is silently consumed as a
  // no-op, the toolbar stays hidden, and a preceding toBeHidden had passed
  // vacuously on the missing host. Wait, bounded, for the mounted instance
  // before the explicit toggle. The probe is written so it does not match
  // the product's own probe string (Boolean(globalThis.__pinarToggle)):
  // test15's __chainHold wrapper holds exactly that injection, and holding
  // the harness wait would deadlock it (typeof is the same observable
  // check). The holds of tests 11/12/15 are all released before their
  // toggleToolbar calls, so the wait never blocks on a held injection.
  const toggleToolbar = async () => {
    const [t] = await worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
    await expect.poll(async () => {
      const r = await worker.evaluate(async (tabId: number) => {
        const res = await chrome.scripting.executeScript({
          target: { frameIds: [0], tabId },
          func: () => typeof globalThis.__pinarToggle === "function",
        }).catch(() => []);
        return Boolean(res?.[0]?.result);
      }, t?.id ?? -1);
      return r;
    }, { timeout: 15_000, message: "the toolbar instance never mounted" }).toBe(true);
    await worker.evaluate(async (tabId: number) => {
      await chrome.scripting.executeScript({
        target: { frameIds: [0], tabId },
        func: () => globalThis.__pinarToggle?.(),
      });
    }, t?.id ?? -1);
  };
  return { context, worker, readDraft, injectAll, toggleToolbar };
}

test("iframe pins restore into their own frame and the top frame keeps its own pins", async () => {
  test.setTimeout(180_000);
  const { context, worker, readDraft, injectAll, toggleToolbar } = await setupRaceContext();
  try {
    const betaUrl = "https://review.pinar.test/beta";
    await context.route("https://review.pinar.test/frame*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Frame</title><body style="margin:0;padding:20px;font:16px sans-serif"><button id="in-frame" style="width:200px;height:80px">In frame</button></body></html>' }));
    await context.route("https://review.pinar.test/host*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Host</title><body style="margin:0;padding:40px;font:20px sans-serif"><button id="top-btn" style="width:250px;height:100px">Top button</button><iframe id="fr" src="/frame" style="display:block;margin-top:40px;width:420px;height:260px;border:1px solid #888"></iframe><a href="/beta">go beta</a></body></html>' }));
    await context.route("https://review.pinar.test/beta*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Beta</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="beta-btn" style="width:250px;height:150px">Beta button</button></body></html>' }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const perFrame = async () => Promise.all(page.frames().map(async (f) => ({
      url: f.url().replace("https://review.pinar.test", ""),
      markers: await f.evaluate(() => Array.from(document.querySelectorAll('[data-pinar="host"]')).flatMap((h: any) =>
        Array.from(h.shadowRoot?.querySelectorAll(".marker") ?? [])
          .map((m: any) => `${m.querySelector(".marker-n")?.textContent}@${Math.round(parseFloat(m.style.left))},${Math.round(parseFloat(m.style.top))}`),
      )).catch(() => ["?"]),
    })));
    const anyFrameComposerFocused = async () => (await Promise.all(page.frames().map((f) => f
      .evaluate(() => {
        const h = document.querySelector('[data-pinar="host"]') as any;
        const input = h?.shadowRoot?.querySelector('[data-ref="input"]');
        return Boolean(input && h.shadowRoot.activeElement === input);
      }).catch(() => false)))).some(Boolean);

    await page.goto("https://review.pinar.test/host");
    await injectAll();
    await expect(host()).toBeVisible();

    // Pin on the top frame.
    const topBtn = (await page.locator("#top-btn").boundingBox())!;
    await page.mouse.click(topBtn.x + 40, topBtn.y + 30);
    await expect(page.locator('[data-ref="input"]')).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Top pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await readDraft())?.entries[0]?.status, { timeout: 15_000 }).toBe("saved");

    // Pin inside the iframe: the click lands on the frame's own overlay and
    // the composer opens inside the frame.
    const iframeEl = (await page.locator("#fr").boundingBox())!;
    await page.mouse.click(iframeEl.x + 80, iframeEl.y + 60);
    await expect.poll(anyFrameComposerFocused, { timeout: 15_000 }).toBe(true);
    await page.keyboard.type("Frame pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 15_000 }).toBe(2);
    await expect.poll(async () => (await readDraft())?.entries[1]?.status, { timeout: 15_000 }).toBe("saved");

    const before = await readDraft();
    expect(before.entries.map((entry: any) => entry.pin.number)).toEqual([1, 2]);
    // Both entries carry the trusted top page url; the iframe pin keeps its
    // frame identity in the dom path prefix and its local geometry intact.
    expect(before.entries.map((entry: any) => entry.page.url)).toEqual(["https://review.pinar.test/host", "https://review.pinar.test/host"]);
    expect(before.entries[1].pin.path).toBe("body > iframe#fr ::frame:: body > button#in-frame");
    const frameShot = before.entries[1].shot;
    expect(frameShot).toMatch(/^data:image\/png;base64,/);

    // Before leaving: each frame shows only its own pin.
    let frames = await perFrame();
    expect(frames.find((f) => f.url === "/host")!.markers).toEqual([expect.stringMatching(/^1@/)]);
    expect(frames.find((f) => f.url === "/frame")!.markers).toEqual([expect.stringMatching(/^2@/)]);

    // Leave with the toolbar hidden and come back: hidden persists.
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await page.click("a[href=\"/beta\"]");
    await expect(page).toHaveURL(betaUrl);
    await expect(host()).toBeAttached();
    await expect(host()).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL("https://review.pinar.test/host");
    await expect(host()).toBeAttached();
    await expect(host()).toBeHidden();

    // Explicit show: each pin comes back to the frame it belongs to, at its
    // own frame's saved geometry - never the top or a sibling frame.
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await expect.poll(async () => {
      const current = await perFrame();
      const top = current.find((f) => f.url === "/host")!;
      const frame = current.find((f) => f.url === "/frame")!;
      return top.markers.length === 1 && top.markers[0].startsWith("1@")
        && frame.markers.length === 1 && frame.markers[0].startsWith("2@");
    }, { timeout: 15_000 }).toBe(true);
    // The iframe followed the top frame's show with its own overlay.
    await expect(page.frameLocator("#fr").locator('[data-pinar="host"]')).toBeVisible();
    frames = await perFrame();
    const topMarker = frames.find((f) => f.url === "/host")!.markers[0].match(/^1@(-?\d+),(-?\d+)$/)!;
    expect(Number(topMarker[1])).toBeGreaterThanOrEqual(topBtn.x - 12);
    expect(Number(topMarker[1])).toBeLessThanOrEqual(topBtn.x + topBtn.width + 12);
    expect(Number(topMarker[2])).toBeGreaterThanOrEqual(topBtn.y - 12);
    expect(Number(topMarker[2])).toBeLessThanOrEqual(topBtn.y + topBtn.height + 12);
    const frameMarker = frames.find((f) => f.url === "/frame")!.markers[0].match(/^2@(-?\d+),(-?\d+)$/)!;
    const iframeBox = (await page.locator("#fr").boundingBox())!;
    const inFrameBox = (await page.frameLocator("#fr").locator("#in-frame").boundingBox())!;
    const localX = inFrameBox.x - iframeBox.x;
    const localY = inFrameBox.y - iframeBox.y;
    expect(Number(frameMarker[1])).toBeGreaterThanOrEqual(localX - 12);
    expect(Number(frameMarker[1])).toBeLessThanOrEqual(localX + inFrameBox.width + 12);
    expect(Number(frameMarker[2])).toBeGreaterThanOrEqual(localY - 12);
    expect(Number(frameMarker[2])).toBeLessThanOrEqual(localY + inFrameBox.height + 12);

    // No recapture and no new entries: the draft is exactly what was left.
    const after = await readDraft();
    expect(after.entries).toHaveLength(2);
    expect(after.entries.map((entry: any) => entry.pin.pinId)).toEqual(before.entries.map((entry: any) => entry.pin.pinId));
    expect(after.entries.every((entry: any) => entry.status === "saved")).toBe(true);
    expect(after.entries[1].shot).toBe(frameShot);
    expect(Object.keys(await worker.evaluate(() => (globalThis as any).__reviewSaved))).toHaveLength(2);
  } finally {
    await context.close();
  }
});

test("a quick second pin during a delayed capture keeps its text and saves once", async () => {
  test.setTimeout(180_000);
  const { context, worker, readDraft, injectAll } = await setupRaceContext();
  try {
    // Deliberately delay the shutter: the previous pin's screenshot stays in
    // flight while the next pin is clicked and typed.
    await worker.evaluate(() => {
      const g: any = globalThis;
      if (!g.__origCaptureVisibleTab) {
        g.__origCaptureVisibleTab = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
        chrome.tabs.captureVisibleTab = (windowId: any, options?: any) => new Promise((resolveShutter, reject) => {
          setTimeout(() => g.__origCaptureVisibleTab(windowId, options).then(resolveShutter, reject), 2500);
        });
      }
    });
    await context.route("https://review.pinar.test/race*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Race</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="race-a" style="width:250px;height:150px">Race A</button><button id="race-b" style="width:250px;height:150px">Race B</button><button id="race-c" style="width:250px;height:100px;margin-top:80px">Race C</button><script>window.leakedKeys = []; document.addEventListener("keydown", (event) => { const path = event.composedPath ? event.composedPath() : [event.target]; if (!path.some((node) => node instanceof HTMLElement && node.getAttribute("data-pinar") === "host")) window.leakedKeys.push(event.key); }, true);</script></body></html>' }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const input = () => page.locator('[data-ref="input"]');
    await page.goto("https://review.pinar.test/race");
    await injectAll();
    await expect(host()).toBeVisible();

    // Warm-up pin: gives the capture rate limiter a recent shutter timestamp.
    await page.mouse.click(180, 160);
    await expect(input()).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Warm up");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 30_000 }).toBe(1);
    await expect.poll(async () => (await readDraft())?.entries[0]?.status, { timeout: 30_000 }).toBe("saved");

    // Second pin: its capture starts right after Enter.
    await page.mouse.click(480, 160);
    await expect(input()).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Mid comment");
    await page.keyboard.press("Enter");

    // Third pin immediately: the previous screenshot is still in flight. The
    // typed comment must arrive in full, exactly once.
    await page.mouse.click(180, 400);
    await expect(input()).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Fast follow-up comment stays", { delay: 25 });
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 30_000 }).toBe(3);
    await expect.poll(async () => (await readDraft())?.entries?.every((entry: any) => entry.status === "saved"), { timeout: 30_000 }).toBe(true);
    const draft = await readDraft();
    expect(draft.entries.map((entry: any) => entry.pin.comment)).toEqual(["Warm up", "Mid comment", "Fast follow-up comment stays"]);
    expect(draft.entries.map((entry: any) => entry.pin.number)).toEqual([1, 2, 3]);
    // The second comment survived and saved exactly once.
    expect(draft.entries.filter((entry: any) => entry.pin.comment === "Fast follow-up comment stays")).toHaveLength(1);
    // The delayed screenshot still completed for every pin.
    expect(draft.entries.every((entry: any) => typeof entry.shot === "string" && entry.shot.startsWith("data:image/png;base64,"))).toBe(true);
    // No key reached the fixture page's controls.
    await expect.poll(async () => page.evaluate(() => (window as any).leakedKeys), { timeout: 3_000 }).toEqual([]);
    // The capture that waited for the composer still finished: no stuck state
    // (the toolbar is back, no confirm overlay stuck on the host).
    await expect(host()).toBeVisible();
    await expect(host()).not.toHaveAttribute("data-confirm", "");
  } finally {
    await context.close();
  }
});

test("a next pin opened while the previous shutter is in flight keeps the composer, focus and text", async () => {
  test.setTimeout(180_000);
  const { context, worker, readDraft, injectAll } = await setupRaceContext();
  try {
    // Deterministic overlap: every captureVisibleTab call is recorded with a
    // start/end mark and delayed, so the test can wait until the previous
    // pin's shutter is actually in flight before clicking the next pin.
    await worker.evaluate(() => {
      const g: any = globalThis;
      if (g.__origCaptureVisibleTab) return;
      g.__origCaptureVisibleTab = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
      g.__captureCalls = [];
      chrome.tabs.captureVisibleTab = (windowId: any, options?: any) => {
        const record: any = { s: Date.now(), e: 0 };
        g.__captureCalls.push(record);
        return new Promise((resolveShutter, reject) => {
          setTimeout(() => g.__origCaptureVisibleTab(windowId, options).then(
            (value: any) => { record.e = Date.now(); resolveShutter(value); },
            (error: any) => { record.e = Date.now(); reject(error); },
          ), 2500);
        });
      };
    });
    const inFlightShutters = () => worker.evaluate(async () => (globalThis as any).__captureCalls.filter((call: any) => !call.e).length);
    const entryByComment = async (comment: string) => {
      const draft = await readDraft();
      return (draft?.entries ?? []).find((entry: any) => entry.pin.comment === comment);
    };
    await context.route("https://review.pinar.test/race*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Race</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="race-a" style="width:250px;height:150px">Race A</button><button id="race-b" style="width:250px;height:150px">Race B</button><button id="race-c" style="width:250px;height:100px;margin-top:80px">Race C</button><script>window.leakedKeys = []; document.addEventListener("keydown", (event) => { const path = event.composedPath ? event.composedPath() : [event.target]; if (!path.some((node) => node instanceof HTMLElement && node.getAttribute("data-pinar") === "host")) window.leakedKeys.push(event.key); }, true);</script></body></html>' }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const input = () => page.locator('[data-ref="input"]');
    await page.goto("https://review.pinar.test/race");
    await injectAll();
    await expect(host()).toBeVisible();

    // Warm-up pin: gives the capture rate limiter a recent shutter timestamp.
    await page.mouse.click(180, 160);
    await expect(input()).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Warm up");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.[0]?.status, { timeout: 30_000 }).toBe("saved");

    // Second pin: its capture starts right after Enter.
    await page.mouse.click(480, 160);
    await expect(input()).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Mid comment");
    await page.keyboard.press("Enter");

    // The next pin may only be clicked while the previous shutter is actually
    // in flight: a click before that window never races the shutter, so the
    // transient abort is never exercised.
    await expect.poll(inFlightShutters, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.mouse.click(180, 400);

    // The interrupted capture is the transient, retryable state: the pin stays
    // pending for the next sync instead of being reported as a failure.
    await expect.poll(async () => (await entryByComment("Mid comment"))?.error, { timeout: 30_000 }).toBe("screenshot_composer_open");
    const pendingSecond = await entryByComment("Mid comment");
    expect(pendingSecond?.status).toBe("pending");

    // The fresh composer must stay visible and focused: a pending confirm bar
    // must not hide it, lose the typed comment or steal the focus of pin 3.
    await expect(input()).toBeFocused({ timeout: 20_000 });
    const typed = "Fast follow-up j k l a b 1 2 3 stays";
    await page.keyboard.type(typed, { delay: 25 });
    await expect(input()).toHaveValue(typed);
    await page.keyboard.press("Enter");

    // The pending pin is recaptured on the next sync: same pin, same number.
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 60_000 }).toBe(3);
    await expect.poll(async () => (await readDraft())?.entries?.every((entry: any) => entry.status === "saved"), { timeout: 60_000 }).toBe(true);
    const draft = await readDraft();
    expect(draft.entries.map((entry: any) => entry.pin.comment)).toEqual(["Warm up", "Mid comment", typed]);
    expect(draft.entries.map((entry: any) => entry.pin.number)).toEqual([1, 2, 3]);
    expect(draft.entries[1].pin.pinId).toBe(pendingSecond.pin.pinId);
    expect(draft.entries[1].pin.number).toBe(pendingSecond.pin.number);
    expect(draft.entries.every((entry: any) => typeof entry.shot === "string" && entry.shot.startsWith("data:image/png;base64,"))).toBe(true);
    // No transient confirm bar hid the composer, and nothing is stuck at the
    // end (the toolbar is back, no confirm overlay on the host).
    await expect(host()).toBeVisible();
    await expect(host()).not.toHaveAttribute("data-confirm", "");
    // No key reached the fixture page's controls.
    await expect.poll(async () => page.evaluate(() => (window as any).leakedKeys), { timeout: 3_000 }).toEqual([]);
  } finally {
    await context.close();
  }
});

test("a real pending failure still shows its confirm bar", async () => {
  test.setTimeout(180_000);
  const { context, worker, readDraft, injectAll } = await setupRaceContext();
  try {
    // After the first save, the transport refuses the session save: a real,
    // actionable failure that must still reach the user (no blanket hiding).
    await worker.evaluate(() => {
      const g: any = globalThis;
      if (g.__saveFailWrapper) return;
      g.__saveFailWrapper = true;
      g.__saveFails = false;
      const originalFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input: any, init: any) => {
        const path = new URL(String(input)).pathname;
        if ((path === "/api/shots" || path === "/api/history") && g.__saveFails) {
          return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
        }
        return originalFetch(input, init);
      };
    });
    await context.route("https://review.pinar.test/race*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Race</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="race-a" style="width:250px;height:150px">Race A</button><button id="race-b" style="width:250px;height:150px">Race B</button></body></html>' }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const input = () => page.locator('[data-ref="input"]');
    await page.goto("https://review.pinar.test/race");
    await injectAll();
    await expect(host()).toBeVisible();

    await page.mouse.click(180, 160);
    await expect(input()).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Warm up");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.[0]?.status, { timeout: 30_000 }).toBe("saved");

    await worker.evaluate(() => { (globalThis as any).__saveFails = true; });
    await page.mouse.click(480, 160);
    await expect(input()).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Failing save");
    await page.keyboard.press("Enter");

    const failing = async () => {
      const draft = await readDraft();
      return (draft?.entries ?? []).find((entry: any) => entry.pin.comment === "Failing save");
    };
    await expect.poll(async () => (await failing())?.status, { timeout: 30_000 }).toBe("pending");
    await expect.poll(async () => (await failing())?.error, { timeout: 30_000 }).toBe("save_failed_503");
    // A real failure still shows the actionable confirm bar.
    await expect(host()).toHaveAttribute("data-confirm", "", { timeout: 10_000 });
  } finally {
    await context.close();
  }
});

test("a delayed restore reply never resurrects a removed pin", async () => {
  test.setTimeout(180_000);
  const { context, worker, readDraft, injectAll, toggleToolbar } = await setupRaceContext();
  try {
    const betaUrl = "https://review.pinar.test/beta";
    await context.route("https://review.pinar.test/stale*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Stale</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="stale-one" style="width:250px;height:150px">Stale one</button></body></html>' }));
    await context.route("https://review.pinar.test/beta*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Beta</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="beta-btn" style="width:250px;height:150px">Beta button</button></body></html>' }));
    // Delay the worker's settings read: the restore handler reads the draft
    // first, the settings second, so the reply is computed from the
    // pre-removal draft and lands after the removal.
    const delayRestore = (ms: number) => worker.evaluate((delayMs) => {
      const g: any = globalThis;
      if (!g.__origSyncGet) {
        g.__origSyncGet = chrome.storage.sync.get.bind(chrome.storage.sync);
        (chrome.storage.sync as any).get = async (...a: any[]) => {
          if (g.__delayMs) await new Promise((r) => setTimeout(r, g.__delayMs));
          return g.__origSyncGet(...a);
        };
      }
      g.__delayMs = delayMs;
    }, ms);

    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    await page.goto("https://review.pinar.test/stale");
    await injectAll();
    await expect(host()).toBeVisible();
    await page.mouse.click(180, 160);
    await expect(page.locator('[data-ref="input"]')).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Durable pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await readDraft())?.entries[0]?.status, { timeout: 15_000 }).toBe("saved");
    const pinId = (await readDraft()).entries[0].pin.pinId as string;

    // Negative-control observation in the isolated world: record the restore
    // reply so the test can prove the delayed stale payload actually arrives
    // (without this the deletion guard is unexercised whenever the worker
    // happens not to reply).
    await worker.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { frameIds: [0], tabId: t.id! },
        func: () => {
          if ((globalThis as any).__pinarSendPatched) return;
          (globalThis as any).__pinarSendPatched = true;
          (globalThis as any).__restoreReplies = [];
          const original = chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage = (message: any, ...rest: any[]) => {
            const result = original(message, ...rest);
            if (message?.type === "review:restore") {
              Promise.resolve(result).then((response) => {
                ((globalThis as any).__restoreReplies as any[]).push({
                  requestId: message.requestId,
                  at: Date.now(),
                  response,
                });
              }).catch(() => null);
            }
            return result;
          };
        },
      });
    });
    const readRestoreReplies = () => worker.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      const [r] = await chrome.scripting.executeScript({
        target: { frameIds: [0], tabId: t.id! },
        func: () => (globalThis as any).__restoreReplies ?? [],
      });
      return r?.result ?? [];
    });

    await delayRestore(1500);
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await toggleToolbar();
    await expect(host()).toBeVisible();

    // Remove the pin while the delayed reply is still in flight.
    await page.locator(`[data-pinar="host"] .marker[data-pin="${pinId}"]`).click();
    await expect(page.locator('[data-ref="composer"]')).toBeVisible();
    await page.locator('[data-ref="deleteDraft"]').click();
    await expect.poll(async () => (await readDraft())?.entries[0]?.deleted, { timeout: 15_000 }).toBe(true);

    // Let the delayed reply arrive: the removed pin must not re-render and
    // must not be re-synced into a new entry.
    await worker.evaluate(() => { (globalThis as any).__delayMs = 0; });
    await expect.poll(readRestoreReplies, { timeout: 15_000 }).toHaveLength(1);
    // The stale payload really arrived with the removed pin, matched to this
    // page, and addressed to this frame (top-frame path prefix): without the
    // generation/tombstone guards it would have resurrected the marker.
    const stale = (await readRestoreReplies())[0] as any;
    expect(stale.response?.ok).toBe(true);
    expect(stale.response?.requestId).toBe(stale.requestId);
    const staleItem = stale.response.pins[0];
    expect(staleItem.pin.pinId).toBe(pinId);
    expect(staleItem.captureId).toBe((await readDraft()).entries[0].captureId);
    expect(String(staleItem.pin.path)).not.toContain(" ::frame:: ");
    await page.waitForTimeout(500);
    await expect(page.locator('[data-pinar="host"] .marker')).toHaveCount(0);
    const draft = await readDraft();
    expect(draft.entries).toHaveLength(1);
    expect(draft.entries[0].deleted).toBe(true);
    expect(draft.entries[0].pin.pinId).toBe(pinId);
    expect(draft.entries.filter((entry: any) => !entry.deleted)).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("the same url restores only the pins of its current workspace view and privacy keys", async () => {
  test.setTimeout(180_000);
  const { context, worker, readDraft, injectAll, toggleToolbar } = await setupRaceContext();
  try {
    const betaUrl = "https://review.pinar.test/beta";
    await context.route("https://review.pinar.test/views*", (route) => route.fulfill({ contentType: "text/html", body: '<html data-pinar-workspace-view="view-one"><title>Views</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="views-one" style="width:250px;height:150px">Views one</button></body></html>' }));
    await context.route("https://review.pinar.test/secure*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Secure</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="secure-one" style="width:250px;height:150px">Secure one</button></body></html>' }));
    await context.route("https://review.pinar.test/beta*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Beta</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="beta-btn" style="width:250px;height:150px">Beta button</button></body></html>' }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const markerCount = () => page.locator('[data-pinar="host"] .marker').count();

    await page.goto("https://review.pinar.test/views");
    await injectAll();
    await expect(host()).toBeVisible();
    await page.mouse.click(180, 160);
    await expect(page.locator('[data-ref="input"]')).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("View one pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await readDraft())?.entries[0]?.status, { timeout: 15_000 }).toBe("saved");
    expect((await readDraft()).entries[0].workspaceView).toBe("view-one");

    // Same url, same view: the pin comes back.
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await page.goto(betaUrl);
    await page.goto("https://review.pinar.test/views");
    // Mounted-and-hidden, not just hidden: with the host missing this would
    // pass vacuously and the next explicit toggle would be a no-op.
    await expect(host()).toBeAttached();
    await expect(host()).toBeHidden();
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await expect.poll(markerCount, { timeout: 15_000 }).toBe(1);

    // Same url, different workspace view: nothing restores.
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await page.goto(betaUrl);
    await page.goto("https://review.pinar.test/views");
    await expect(host()).toBeAttached();
    await expect(host()).toBeHidden();
    await page.evaluate(() => document.documentElement.setAttribute("data-pinar-workspace-view", "view-two"));
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await page.waitForTimeout(750);
    expect(await markerCount()).toBe(0);
    expect((await readDraft()).entries).toHaveLength(1);

    // Privacy keys: batch_ref is NOT a default-sensitive query key, so while
    // the setting is empty the entry keeps the raw url. Adding it after the
    // pin changes the sanitized identity; restore must not guess a match
    // under the new settings - it safely restores nothing and the entry
    // stays intact.
    const secureUrl = "https://review.pinar.test/secure?batch_ref=blue-42";
    await page.goto(secureUrl);
    await expect(host()).toBeVisible();
    await page.mouse.click(180, 160);
    await expect(page.locator('[data-ref="input"]')).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Secure pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 15_000 }).toBe(2);
    await expect.poll(async () => (await readDraft())?.entries[1]?.status, { timeout: 15_000 }).toBe("saved");
    // api_key is not sensitive yet: the entry keeps the raw url.
    expect((await readDraft()).entries[1].page.url).toBe(secureUrl);
    await worker.evaluate(() => chrome.storage.sync.set({ sensitiveQueryKeys: "batch_ref" }));
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await page.goto(betaUrl);
    await page.goto(secureUrl);
    await expect(host()).toBeAttached();
    await expect(host()).toBeHidden();
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await page.waitForTimeout(750);
    expect(await markerCount()).toBe(0);
    const draft = await readDraft();
    expect(draft.entries).toHaveLength(2);
    expect(draft.entries.filter((entry: any) => !entry.deleted)).toHaveLength(2);
  } finally {
    await context.close();
  }
});

// The resume's content.js injection is requested by tab only: if the tab
// navigates while it is in flight, it lands in the newer document, where the
// __pinarInitialVisible flag never ran - so a persisted-hidden toolbar would
// come back visible there, and the next resume chain finds the instance and
// exits without applying the persisted state. Deterministic race: the real
// resumeReviewTab runs; only the first chain's files injection is paused
// (after its prepare(false)) across a second navigation, then released. The
// persisted hidden state must stay hidden - never auto-unhide on resume -
// stable for >=5s, with the original page's pins still available when the
// explicit action shows the toolbar.
test("a late resume injection on the next document keeps a persisted-hidden toolbar hidden", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const { context, worker, readDraft, injectAll, toggleToolbar } = await setupRaceContext();
  try {
    // Instrument the service worker: hold the first chain's content.js files
    // injection, record every product injection for the review tab with its
    // real documentIds and probe results, and trail toasts/warns (qualifies
    // the 183136 transient "Pending" toast if it occurs). The review tab is
    // resolved per event from the product's own reviewTabs registry - never
    // from a window-focus query, which drifts in headless.
    await worker.evaluate(async () => {
      const g: any = globalThis;
      g.__tl = []; g.__t0 = Date.now(); g.__injections = [];
      g.__hold = { armed: false, fired: false, resolve: null as any };
      const log = (m: string) => g.__tl.push(`${String(Date.now() - g.__t0).padStart(5)}ms ${m}`);
      const reviewTabId = async () => {
        const stored = await chrome.storage.session.get({ reviewTabs: [] });
        const tabs = await chrome.tabs.query({});
        return tabs.find((t: any) => stored.reviewTabs.includes(t.id))?.id;
      };
      const docIds = (res: any) => (res || []).map((r: any) => r.documentId);
      const oe = chrome.scripting.executeScript.bind(chrome.scripting);
      g.__oe = oe;
      (chrome.scripting as any).executeScript = async (inj: any) => {
        const tabId = Number(inj?.target?.tabId);
        const isFiles = Array.isArray(inj?.files) && inj.files.includes("content.js");
        const isPrepare = !!inj?.func && String(inj.func).includes("__pinarInitialVisible");
        const isProbe = !!inj?.func && String(inj.func).includes("Boolean(globalThis.__pinarToggle)");
        const isReconcile = !!inj?.func && String(inj.func).includes("__pinarReconcileHidden");
        const kind = isFiles ? "FILES(content.js)" : isPrepare ? `PREPARE(visible=${JSON.stringify(inj.args?.[0])})` : isProbe ? "PROBE(__pinarToggle)" : isReconcile ? "RECONCILE(hidden)" : null;
        const isReview = kind ? (await reviewTabId()) === tabId : false;
        if (isFiles && isReview && g.__hold.armed && !g.__hold.fired) {
          g.__hold.fired = true;
          const atHold = await oe({ func: () => location.href, target: { frameIds: [0], tabId } }).catch(() => []);
          log(`${kind} requested tabId=${tabId} target=${JSON.stringify(inj.target)} -> HELD; top document at hold: ${JSON.stringify(docIds(atHold))} url=${atHold?.[0]?.result}`);
          await new Promise<void>((r) => { g.__hold.resolve = r; });
          const atRelease = await oe({ func: () => location.href, target: { frameIds: [0], tabId } }).catch(() => []);
          log(`${kind} RELEASED; top document at release: ${JSON.stringify(docIds(atRelease))} url=${atRelease?.[0]?.result}`);
        }
        const res = await oe(inj).catch((e: any) => { if (kind) log(`${kind} REJECTED: ${e?.message}`); throw e; });
        if (kind && isReview) {
          log(`${kind} done target=${JSON.stringify(inj.target)} docIds=${JSON.stringify(docIds(res))}${isProbe || isReconcile ? ` result=${JSON.stringify((res || []).map((r: any) => r.result))}` : ""}`);
          g.__injections.push({ kind, target: { ...inj.target }, docIds: docIds(res), results: (res || []).map((r: any) => r.result) });
        }
        return res;
      };
      chrome.tabs.onUpdated.addListener((id: number, info: any) => {
        if (info.status !== "complete" && info.status !== "loading") return;
        void chrome.storage.session.get({ reviewTabs: [] }).then((stored: any) => {
          if (stored.reviewTabs.includes(id)) log(`tabs.onUpdated status=${info.status}${info.url ? " url=" + info.url.replace("https://review.pinar.test", "") : ""}`);
        }).catch(() => null);
      });
      const ots = chrome.tabs.sendMessage.bind(chrome.tabs);
      (chrome.tabs as any).sendMessage = async (id: number, msg: any, ...rest: any[]) => {
        if (String(id) === g.__tab && msg?.type === "batch:changed" && msg.toast) log(`tabs.sendMessage batch:changed toast=${JSON.stringify(msg.toast)} kind=${msg.toastKind ?? "-"}`);
        return ots(id, msg, ...rest);
      };
      const ow = console.warn.bind(console);
      console.warn = (...a: any[]) => { log(`console.warn ${a.map((x) => (x && x.stack) ? `${x.message} | ${String(x.stack).split("\n").slice(0, 3).join(" <- ")}` : String(x)).join(" ")}`); ow(...a); };
      self.addEventListener("unhandledrejection", (e: any) => log(`unhandledrejection ${e?.reason?.message ?? e?.reason}`));
    });
    const tl = () => worker.evaluate(() => (globalThis as any).__tl as string[]);
    const injections = () => worker.evaluate(() => (globalThis as any).__injections as any[]);
    const topDocState = () => worker.evaluate(async () => {
      const g: any = globalThis;
      const stored = await chrome.storage.session.get({ reviewTabs: [] });
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t: any) => stored.reviewTabs.includes(t.id));
      const r = await g.__oe({
        func: () => {
          const h = document.querySelector('[data-pinar="host"]') as HTMLElement | null;
          return { url: location.href, initialVisible: (globalThis as any).__pinarInitialVisible, toggle: typeof (globalThis as any).__pinarToggle, hostDisplay: h?.style.display ?? null };
        },
        target: { frameIds: [0], tabId: tab!.id },
      });
      return { documentId: r?.[0]?.documentId, ...r?.[0]?.result };
    });
    const storedMap = () => worker.evaluate(async () => (await chrome.storage.session.get({ toolbarVisible: {} })).toolbarVisible);

    await context.route("https://review.pinar.test/views*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Views</title><body style="margin:0;padding:100px;font:20px sans-serif"><button style="width:250px;height:150px">One</button></body></html>' }));
    await context.route("https://review.pinar.test/beta*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Beta</title><body style="margin:0;padding:100px"><p>beta</p></body></html>' }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const input = () => page.locator('[data-ref="input"]');
    await page.goto("https://review.pinar.test/views");
    await injectAll();
    await expect(host()).toBeVisible();
    // The pin on the original page.
    await page.mouse.click(180, 160);
    await expect(input()).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Cross-document pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.[0]?.status, { timeout: 30_000 }).toBe("saved");
    const pinId = (await readDraft()).entries[0].pin.pinId as string;
    // Hide through the content toggle (the action/shortcut path) and wait for
    // the persisted map to acknowledge hidden before any navigation.
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await expect.poll(storedMap, { timeout: 10_000 }).toEqual({});
    // The race: nav1 to /beta (the real resume chain runs and its content.js
    // files injection is held after its prepare(false)); nav2 to /views while
    // that injection is still pending.
    await worker.evaluate(() => { (globalThis as any).__hold.armed = true; });
    const nav1 = page.goto("https://review.pinar.test/beta");
    await expect.poll(async () => (await tl()).some((line) => line.includes("HELD")), { timeout: 15_000 }).toBe(true);
    await nav1;
    const betaState = await topDocState();
    await page.goto("https://review.pinar.test/views");
    const viewsBefore = await topDocState();
    await worker.evaluate(() => { (globalThis as any).__hold.resolve(); });
    await page.waitForTimeout(2_500);
    const viewsAfter = await topDocState();
    const visibleAt25 = await host().isVisible();
    await page.waitForTimeout(3_000);
    const visibleAt55 = await host().isVisible();
    const persisted = await storedMap();
    // The race is real, with the actual document ids: the held injection was
    // requested by tab only (no documentIds), prepared the /beta document and
    // its InjectionResult landed on the /views document - a different one -
    // where the second resume chain found the instance via the idempotency
    // probe instead of preparing it.
    const prepare = (await injections()).find((item: any) => item.kind.startsWith("PREPARE"));
    const files = (await injections()).find((item: any) => item.kind === "FILES(content.js)");
    const secondProbe = (await injections()).filter((item: any) => item.kind === "PROBE(__pinarToggle)").at(-1);
    const timeline = await tl();
    // Evidence trail in the test output (the archived probe logged the same):
    // document ids, the by-tab-only injection target, probe results and any
    // toast/warn trail (the 183136 "Pending" qualification).
    console.log("CROSSDOC-RESUME " + JSON.stringify({
      persisted, visibleAt25, visibleAt55,
      states: { betaState, viewsBefore, viewsAfter },
      prepareDoc: prepare?.docIds?.[0], filesDoc: files?.docIds?.[0], filesTarget: files?.target,
      secondProbeDoc: secondProbe?.docIds?.[0], secondProbeResults: secondProbe?.results,
      trail: timeline.filter((line) => line.includes("HELD") || line.includes("RELEASED") || line.includes("RECONCILE") || line.includes("batch:changed toast") || line.includes("console.warn") || line.includes("unhandledrejection")),
    }));
    await testInfo.attach("crossdoc-resume", {
      body: JSON.stringify({ persisted, visibleAt25, visibleAt55, states: { betaState, viewsBefore, viewsAfter }, injections: await injections(), timeline }, null, 2),
      contentType: "application/json",
    });
    expect(prepare, "the first resume chain prepared the initial visibility").toBeTruthy();
    expect(prepare.docIds[0], "the prepare ran on the /beta document").toBe(betaState.documentId);
    expect(files, "the held content.js files injection completed").toBeTruthy();
    expect(files.target, "the files injection is requested by tab only").toEqual(expect.objectContaining({ tabId: expect.any(Number), allFrames: true }));
    expect(files.target.documentIds, "the files injection carries no documentIds").toBeUndefined();
    expect(files.docIds[0], "the files injection landed on the /views document").toBe(viewsBefore.documentId);
    expect(files.docIds[0], "the injection landed on a different document than the prepare").not.toBe(prepare.docIds[0]);
    expect(secondProbe, "the second resume chain probed for an existing instance").toBeTruthy();
    expect(secondProbe.docIds[0], "the second chain probed the /views document").toBe(viewsAfter.documentId);
    expect(secondProbe.results, "the second chain found the instance the late injection left").toEqual([true]);
    // The persisted state stayed hidden and the toolbar never auto-unhid on
    // resume: hidden at +2.5s and still hidden at +5.5s (stable for >=5s).
    expect(persisted, "the persisted map still says hidden").toEqual({});
    expect(visibleAt25, "the toolbar is not auto-unhidden at +2.5s").toBe(false);
    expect(visibleAt55, "the toolbar stays hidden for >=5s").toBe(false);
    // Mounted-and-hidden: the explicit show below must find the instance.
    await expect(host()).toBeAttached();
    await expect(host()).toBeHidden();
    // The explicit action/shortcut shows the toolbar and the original page's
    // pin is still available: restored from the durable draft with the same id.
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await expect.poll(async () => (await readDraft())?.entries?.[0]?.pin?.pinId, { timeout: 15_000 }).toBe(pinId);
    await expect(page.locator(`[data-pinar="host"] .marker[data-pin="${pinId}"]`)).toBeVisible();
  } finally {
    await context.close();
  }
});

// The worker sends review:navigated on every URL change (background.js
// onUpdated). The delivery races the resume chains and can be queued in the
// worker while the tab navigates, then land in the newer document after the
// late resume injection has mounted it. That delivery wipes the page-local
// pins (clearNavigationPins -> resetLocalPins -> restoreGeneration += 1) and
// leaves a visible toolbar without the page's pins: the explicit show's
// restore reply either lands before the wipe (the wipe clears the rendered
// pin) or after it (dropped by the generation guard, content.js: the reply's
// captured generation no longer matches) - either ordering ends at zero
// markers, and nothing re-fires until a manual re-toggle.
// Deterministic controls (the real resumeReviewTab and real restore
// round trips run; nothing is stubbed):
//  - the first chain's content.js files injection is held across the second
//    navigation (it lands in the newer document and mounts default-visible);
//  - the second resume chain can only run after that release, because the
//    per-tab resume chains are serialized (background.js resumeChains), so
//    its probe structurally finds the late instance and takes the RECONCILE
//    branch for the persisted hidden state;
//  - the explicit show (the action/shortcut path) is issued the moment the
//    RECONCILE injection resolves - no wait;
//  - the worker's review:navigated send for the second navigation is queued
//    until after that show has issued and is released only after the test
//    has confirmed it.
// NOT controlled: the review:restore SW->content reply timing (it is not
// interceptable from the worker without instrumenting the product). Both
// reply orderings relative to the wipe deterministically end at zero markers
// on the unfixed code, so the scenario is deterministic either way; the
// worker-side restore request log (requestId + time) records which ordering
// actually happened in each run.
// The queued delivery must not leave the visible toolbar without the
// original page's pin: it comes back with the same id.
test("a queued review:navigated delivery after the explicit show still restores the page's pin", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const { context, worker, readDraft, injectAll, toggleToolbar } = await setupRaceContext();
  try {
    await worker.evaluate(async () => {
      const g: any = globalThis;
      g.__tl = []; g.__t0 = Date.now(); g.__injections = []; g.__restoreLog = [];
      g.__hold = { armed: false, fired: false, resolve: null as any };
      g.__navHold = { armed: false, resolve: null as any };
      const log = (m: string) => g.__tl.push(`${String(Date.now() - g.__t0).padStart(5)}ms ${m}`);
      const reviewTabId = async () => {
        const stored = await chrome.storage.session.get({ reviewTabs: [] });
        const tabs = await chrome.tabs.query({});
        return tabs.find((t: any) => stored.reviewTabs.includes(t.id))?.id;
      };
      const docIds = (res: any) => (res || []).map((r: any) => r.documentId);
      const oe = chrome.scripting.executeScript.bind(chrome.scripting);
      g.__oe = oe;
      (chrome.scripting as any).executeScript = async (inj: any) => {
        const tabId = Number(inj?.target?.tabId);
        const isFiles = Array.isArray(inj?.files) && inj.files.includes("content.js");
        const isPrepare = !!inj?.func && String(inj.func).includes("__pinarInitialVisible");
        const isProbe = !!inj?.func && String(inj.func).includes("Boolean(globalThis.__pinarToggle)");
        const isReconcile = !!inj?.func && String(inj.func).includes("__pinarReconcileHidden");
        const kind = isFiles ? "FILES(content.js)" : isPrepare ? `PREPARE(visible=${JSON.stringify(inj.args?.[0])})` : isProbe ? "PROBE(__pinarToggle)" : isReconcile ? "RECONCILE(hidden)" : null;
        const isReview = kind ? (await reviewTabId()) === tabId : false;
        if (isFiles && isReview && g.__hold.armed && !g.__hold.fired) {
          g.__hold.fired = true;
          const atHold = await oe({ func: () => location.href, target: { frameIds: [0], tabId } }).catch(() => []);
          log(`${kind} requested tabId=${tabId} target=${JSON.stringify(inj.target)} -> HELD; top document at hold: ${JSON.stringify(docIds(atHold))} url=${atHold?.[0]?.result}`);
          await new Promise<void>((r) => { g.__hold.resolve = r; });
          const atRelease = await oe({ func: () => location.href, target: { frameIds: [0], tabId } }).catch(() => []);
          log(`${kind} RELEASED; top document at release: ${JSON.stringify(docIds(atRelease))} url=${atRelease?.[0]?.result}`);
        }
        const res = await oe(inj).catch((e: any) => { if (kind) log(`${kind} REJECTED: ${e?.message}`); throw e; });
        if (kind && isReview) {
          log(`${kind} done target=${JSON.stringify(inj.target)} docIds=${JSON.stringify(docIds(res))}${isProbe || isReconcile ? ` result=${JSON.stringify((res || []).map((r: any) => r.result))}` : ""}`);
          g.__injections.push({ kind, target: { ...inj.target }, docIds: docIds(res), results: (res || []).map((r: any) => r.result) });
          if (isReconcile) {
            // The explicit action/shortcut path fires the moment the reconcile
            // resolves: no wait between RECONCILE and the show.
            void oe({
              func: () => globalThis.__pinarToggle?.(),
              target: { frameIds: [0], tabId },
            }).then(() => log("EXPLICIT-SHOW issued right after RECONCILE")).catch((e: any) => log(`EXPLICIT-SHOW rejected: ${e?.message}`));
          }
        }
        return res;
      };
      const ots = chrome.tabs.sendMessage.bind(chrome.tabs) as any;
      (chrome.tabs as any).sendMessage = async (id: number, msg: any, ...rest: any[]) => {
        if (msg?.type === "review:navigated" && g.__navHold.armed) {
          log("review:navigated QUEUED (held until the test releases the delivery)");
          await new Promise<void>((r) => { g.__navHold.resolve = r; });
          log("review:navigated DELIVERY released");
        }
        const p = ots(id, msg, ...rest);
        if (msg?.type === "review:navigated") Promise.resolve(p).then(() => log("review:navigated delivered OK"), (e: any) => log(`review:navigated delivered ERR ${String(e?.message || e).slice(0, 40)}`));
        return p;
      };
      // Order the real review:restore round trips by requestId: the worker
      // sees every restore request the content instances fire (the mount, the
      // show, the wipe-triggered one) with its rid, without touching the
      // product handler or its response.
      chrome.runtime.onMessage.addListener((message: any) => {
        if (message?.type === "review:restore" && typeof message.requestId === "string") {
          g.__restoreLog.push({ t: Date.now() - g.__t0, rid: message.requestId, workspaceView: message.workspaceView ?? null, framePath: message.framePath ?? "" });
        }
      });
    });
    const tl = () => worker.evaluate(() => (globalThis as any).__tl as string[]);
    const injections = () => worker.evaluate(() => (globalThis as any).__injections as any[]);
    const restoreLog = () => worker.evaluate(() => (globalThis as any).__restoreLog as any[]);
    const topDocState = () => worker.evaluate(async () => {
      const g: any = globalThis;
      const stored = await chrome.storage.session.get({ reviewTabs: [] });
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t: any) => stored.reviewTabs.includes(t.id));
      const r = await g.__oe({
        func: () => {
          const h = document.querySelector('[data-pinar="host"]') as HTMLElement | null;
          return { url: location.href, initialVisible: (globalThis as any).__pinarInitialVisible, toggle: typeof (globalThis as any).__pinarToggle, hostDisplay: h?.style.display ?? null };
        },
        target: { frameIds: [0], tabId: tab!.id },
      });
      return { documentId: r?.[0]?.documentId, ...r?.[0]?.result };
    });
    const storedMap = () => worker.evaluate(async () => (await chrome.storage.session.get({ toolbarVisible: {} })).toolbarVisible);

    await context.route("https://review.pinar.test/views*", (route) => route.fulfill({ contentType: "text/html", body: '<html data-pinar-workspace-view="view-one"><title>Views</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="views-one" style="width:250px;height:150px">Views one</button></body></html>' }));
    await context.route("https://review.pinar.test/beta*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Beta</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="beta-btn" style="width:250px;height:150px">Beta button</button></body></html>' }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const markerCount = () => page.locator('[data-pinar="host"] .marker').count();
    await page.goto("https://review.pinar.test/views");
    await injectAll();
    await expect(host()).toBeVisible();
    // The pin on the original page.
    await page.mouse.click(180, 160);
    await expect(page.locator('[data-ref="input"]')).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Cross-document pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.[0]?.status, { timeout: 30_000 }).toBe("saved");
    const pinId = (await readDraft()).entries[0].pin.pinId as string;
    // Hide through the content toggle and wait for the persisted map to
    // acknowledge hidden before any navigation.
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await expect.poll(storedMap, { timeout: 10_000 }).toEqual({});
    // The race: nav1 to /beta (the real resume chain runs and its content.js
    // files injection is held after its prepare(false)); nav2 to /views while
    // that injection is still pending, with the worker's review:navigated send
    // for nav2 queued.
    await worker.evaluate(() => { (globalThis as any).__hold.armed = true; });
    const nav1 = page.goto("https://review.pinar.test/beta");
    await expect.poll(async () => (await tl()).some((line) => line.includes("HELD")), { timeout: 15_000 }).toBe(true);
    await nav1;
    await worker.evaluate(() => { (globalThis as any).__navHold.armed = true; });
    await page.goto("https://review.pinar.test/views");
    const viewsBefore = await topDocState();
    await worker.evaluate(() => { (globalThis as any).__hold.resolve(); });
    // The late instance mounted and the serialized second chain took the
    // reconcile branch for the persisted hidden state; the explicit show was
    // issued the moment the reconcile resolved. Gate on the trail, not on a
    // promise that would resolve anyway.
    await expect.poll(async () => (await tl()).some((line) => line.includes("RECONCILE(hidden) done")), { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await tl()).some((line) => line.includes("EXPLICIT-SHOW issued right after RECONCILE")), { timeout: 10_000 }).toBe(true);
    await expect(host()).toBeVisible();
    // Only now release the queued review:navigated delivery, and wait for the
    // delivery to actually land in the late document (not just be released).
    await worker.evaluate(() => { (globalThis as any).__navHold.resolve(); });
    await expect.poll(async () => (await tl()).some((line) => line.includes("review:navigated delivered OK")), { timeout: 10_000 }).toBe(true);
    // The explicit show stands: a queued delivery must not undo it.
    await expect(host()).toBeVisible();
    // The wipe left zero markers on the unfixed code (its restore reply was
    // either cleared by the wipe or dropped by the generation guard); the
    // visible toolbar must regain the page's pin with the same id.
    const wipeSample = await markerCount();
    await expect.poll(markerCount, { timeout: 15_000 }).toBe(1);
    await expect(page.locator(`[data-pinar="host"] .marker[data-pin="${pinId}"]`)).toBeVisible();
    const persisted = await storedMap();
    // Evidence trail: document ids, the by-tab-only injection, the probe
    // finding the late instance, the reconcile, the immediate show, the
    // queued delivery that landed, and the restore request order by rid.
    const timeline = await tl();
    const restores = await restoreLog();
    const injectionsAll = await injections();
    const prepare = injectionsAll.find((item: any) => item.kind.startsWith("PREPARE"));
    const files = injectionsAll.find((item: any) => item.kind === "FILES(content.js)");
    const secondProbe = injectionsAll.filter((item: any) => item.kind === "PROBE(__pinarToggle)").at(-1);
    const deliveredAt = timeline.findIndex((line) => line.includes("review:navigated delivered OK"));
    const wipeMs = Number((timeline[deliveredAt] ?? "").slice(0, (timeline[deliveredAt] ?? "").indexOf("ms"))) || null;
    // Which real restore round trips (by rid) landed before/after the wipe -
    // evidence, not a gate: the unfixed code has none after the wipe.
    const restoresVsWipe = restores.map((r: any) => ({ ...r, afterWipe: wipeMs != null && r.t > wipeMs }));
    console.log("NAVIGATED-WIPE " + JSON.stringify({
      persisted,
      markersRightAfterWipe: wipeSample,
      prepareDoc: prepare?.docIds?.[0], filesDoc: files?.docIds?.[0], filesTarget: files?.target,
      secondProbeDoc: secondProbe?.docIds?.[0], secondProbeResults: secondProbe?.results,
      restoresVsWipe,
      trail: timeline.filter((line) => line.includes("HELD") || line.includes("RELEASED") || line.includes("RECONCILE") || line.includes("EXPLICIT-SHOW") || line.includes("review:navigated")),
    }));
    await testInfo.attach("navigated-wipe", {
      body: JSON.stringify({ persisted, wipeSample, wipeMs, prepare, files, secondProbe, restoresVsWipe, deliveredAt, injections: injectionsAll, timeline }, null, 2),
      contentType: "application/json",
    });
    expect(prepare, "the first resume chain prepared the initial visibility").toBeTruthy();
    expect(prepare.docIds[0], "the prepare ran on the /beta document").not.toBe(viewsBefore.documentId);
    expect(files, "the held content.js files injection completed").toBeTruthy();
    expect(files.target, "the files injection is requested by tab only").toEqual(expect.objectContaining({ tabId: expect.any(Number), allFrames: true }));
    expect(files.target.documentIds, "the files injection carries no documentIds").toBeUndefined();
    expect(files.docIds[0], "the files injection landed on the /views document").toBe(viewsBefore.documentId);
    expect(secondProbe, "the second resume chain probed for an existing instance").toBeTruthy();
    expect(secondProbe.docIds[0], "the second chain probed the /views document").toBe(viewsBefore.documentId);
    expect(secondProbe.results, "the second chain found the instance the late injection left").toEqual([true]);
    expect(timeline.some((line) => line.includes("RECONCILE(hidden) done")), "the reconcile hid the late instance").toBe(true);
    expect(timeline.some((line) => line.includes("EXPLICIT-SHOW issued right after RECONCILE")), "the explicit show fired right after the reconcile").toBe(true);
    expect(timeline[deliveredAt], "the queued delivery landed in the late document").toContain("review:navigated delivered OK");
    expect(restores.length, "the show fired a real review:restore round trip (rid logged)").toBeGreaterThanOrEqual(1);
    expect(restores[0].framePath, "the restore is scoped to the top frame").toBe("");
  } finally {
    await context.close();
  }
});


test("an SPA navigation never renders another page's pin and restores the original page's pin", async () => {
  test.setTimeout(180_000);
  const { context, worker, readDraft, injectAll, toggleToolbar } = await setupRaceContext();
  try {
    const viewsUrl = "https://review.pinar.test/views";
    const betaUrl = "https://review.pinar.test/beta";
    await context.route(viewsUrl + "*", (route) => route.fulfill({ contentType: "text/html", body: '<html data-pinar-workspace-view="view-one"><title>Views</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="views-one" style="width:250px;height:150px">Views one</button></body></html>' }));
    await context.route(betaUrl + "*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Beta</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="beta-btn" style="width:250px;height:150px">Beta button</button></body></html>' }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const markerCount = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-pinar="host"]')).flatMap((h: any) =>
        Array.from(h.shadowRoot?.querySelectorAll(".marker") ?? [])).length);

    await page.goto(viewsUrl);
    await injectAll();
    await expect(host()).toBeVisible();

    const btn = (await page.locator("#views-one").boundingBox())!;
    await page.mouse.click(btn.x + 40, btn.y + 30);
    await expect(page.locator('[data-ref="input"]')).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("SPA pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await readDraft())?.entries[0]?.status, { timeout: 15_000 }).toBe("saved");
    await expect.poll(markerCount, { timeout: 15_000 }).toBe(1);

    // Persist the visible state across the navigation: hide, then show again.
    await toggleToolbar();
    await expect(host()).toBeHidden();
    await toggleToolbar();
    await expect(host()).toBeVisible();

    // Same-document (SPA) navigation: the natural review:navigated delivery
    // arrives in the same document, which then re-pulls its pins. The worker's
    // sender.url is still /views; only the frame's live url keeps the /views
    // pin out of /beta.
    await page.evaluate(() => history.pushState({}, "", "/beta"));
    await expect(page).toHaveURL(betaUrl);
    await expect(host()).toBeVisible();
    await expect.poll(markerCount, { timeout: 15_000 }).toBe(0);

    // Back to the original page: its pin comes back, scoped to its url.
    await page.evaluate(() => history.pushState({}, "", "/views"));
    await expect(page).toHaveURL(viewsUrl);
    await expect.poll(markerCount, { timeout: 15_000 }).toBe(1);
  } finally {
    await context.close();
  }
});

test("a same-page navigated wipe restores each frame's own pin", async () => {
  test.setTimeout(180_000);
  const { context, worker, readDraft, injectAll } = await setupRaceContext();
  try {
    await context.route("https://review.pinar.test/frame*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Frame</title><body style="margin:0;padding:20px;font:16px sans-serif"><button id="in-frame" style="width:200px;height:80px">In frame</button></body></html>' }));
    await context.route("https://review.pinar.test/host*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Host</title><body style="margin:0;padding:40px;font:20px sans-serif"><button id="top-btn" style="width:250px;height:100px">Top button</button><iframe id="fr" src="/frame" style="display:block;margin-top:40px;width:420px;height:260px;border:1px solid #888"></iframe></body></html>' }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const perFrame = async () => Promise.all(page.frames().map(async (f) => ({
      url: f.url().replace("https://review.pinar.test", ""),
      markers: await f.evaluate(() => Array.from(document.querySelectorAll('[data-pinar="host"]')).flatMap((h: any) =>
        Array.from(h.shadowRoot?.querySelectorAll(".marker") ?? [])
          .map((m: any) => m.querySelector(".marker-n")?.textContent)),
      ).catch(() => ["?"]),
    })));
    const anyFrameComposerFocused = async () => (await Promise.all(page.frames().map((f) => f
      .evaluate(() => {
        const h = document.querySelector('[data-pinar="host"]') as any;
        const input = h?.shadowRoot?.querySelector('[data-ref="input"]');
        return Boolean(input && h.shadowRoot.activeElement === input);
      }).catch(() => false)))).some(Boolean);

    await page.goto("https://review.pinar.test/host");
    await injectAll();
    await expect(host()).toBeVisible();

    const topBtn = (await page.locator("#top-btn").boundingBox())!;
    await page.mouse.click(topBtn.x + 40, topBtn.y + 30);
    await expect(page.locator('[data-ref="input"]')).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Top pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await readDraft())?.entries[0]?.status, { timeout: 15_000 }).toBe("saved");

    const iframeEl = (await page.locator("#fr").boundingBox())!;
    await page.mouse.click(iframeEl.x + 80, iframeEl.y + 60);
    await expect.poll(anyFrameComposerFocused, { timeout: 15_000 }).toBe(true);
    await page.keyboard.type("Frame pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 15_000 }).toBe(2);
    await expect.poll(async () => (await readDraft())?.entries[1]?.status, { timeout: 15_000 }).toBe("saved");
    await expect.poll(async () => (await perFrame()).find((f) => f.url === "/frame")!.markers, { timeout: 15_000 }).toEqual(["2"]);

    // The same message the worker sends on a real navigation (with the wipe
    // id), delivered to every frame of the tab without a document change.
    // Each frame wipes and re-pulls its own pins; the top frame's FRAME_CLEAR
    // re-broadcast of that same wipe must not drop the iframe's in-flight
    // re-pull reply.
    await worker.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(t.id!, { type: "review:navigated", wipeId: crypto.randomUUID() }).catch(() => null);
    });
    await expect.poll(async () => {
      const frames = await perFrame();
      const top = frames.find((f) => f.url === "/host")!;
      const frame = frames.find((f) => f.url === "/frame")!;
      return top.markers.length === 1 && top.markers[0] === "1"
        && frame.markers.length === 1 && frame.markers[0] === "2";
    }, { timeout: 15_000 }).toBe(true);

    // Nothing was lost or duplicated in the draft.
    const after = await readDraft();
    expect(after.entries).toHaveLength(2);
    expect(after.entries.every((entry: any) => entry.status === "saved")).toBe(true);
  } finally {
    await context.close();
  }
});

test("a delayed resume reconcile keeps a toolbar the user just explicitly shown", async () => {
  test.setTimeout(180_000);
  const { context, worker, readDraft, injectAll, toggleToolbar } = await setupRaceContext();
  try {
    const viewsUrl = "https://review.pinar.test/views";
    const betaUrl = "https://review.pinar.test/beta";
    await context.route(viewsUrl + "*", (route) => route.fulfill({ contentType: "text/html", body: '<html data-pinar-workspace-view="view-one"><title>Views</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="views-one" style="width:250px;height:150px">Views one</button></body></html>' }));
    await context.route(betaUrl + "*", (route) => route.fulfill({ contentType: "text/html", body: '<html><title>Beta</title><body style="margin:0;padding:100px;font:20px sans-serif"><button id="beta-btn" style="width:250px;height:150px">Beta button</button></body></html>' }));
    const page = await context.newPage();
    const host = () => page.locator('[data-pinar="host"]');
    const markerCount = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-pinar="host"]')).flatMap((h: any) =>
        Array.from(h.shadowRoot?.querySelectorAll(".marker") ?? [])).length);

    await page.goto(viewsUrl);
    await injectAll();
    await expect(host()).toBeVisible();

    const btn = (await page.locator("#views-one").boundingBox())!;
    await page.mouse.click(btn.x + 40, btn.y + 30);
    await expect(page.locator('[data-ref="input"]')).toBeFocused({ timeout: 15_000 });
    await page.keyboard.type("Reconcile pin");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readDraft())?.entries?.length, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await readDraft())?.entries[0]?.status, { timeout: 15_000 }).toBe("saved");

    // Hold the resume chain's instance probe, initial-visibility flag, content
    // files and reconcile executeScripts after this point. A held injection
    // stays pending until released, so the chain blocks exactly where the
    // product sequence needs it: the first chain's probe is released before
    // the instance exists (injection path), its flag and files land here as
    // a late hidden instance, and the second chain's probe is released only
    // after - so it reads the stale persisted-hidden state and issues its
    // reconcile, which can only run after the user's explicit show below.
    await worker.evaluate(() => {
      const g: any = globalThis;
      g.__chainHold = [];
      g.__chainOe = chrome.scripting.executeScript.bind(chrome.scripting);
      chrome.scripting.executeScript = (injection: any) => {
        const f = String(injection?.func ?? "");
        const files = injection?.files;
        const isChainFiles = Array.isArray(files) && files.includes("content.js");
        const kind = f.includes("Boolean(globalThis.__pinarToggle)") ? "probe"
          : f.includes("__pinarInitialVisible") ? "flag"
            : f.includes("__pinarReconcileHidden") ? "reconcile"
              : isChainFiles ? "files" : null;
        if (kind) {
          return new Promise((resolve) => {
            g.__chainHold.push({ injection, kind, resolve });
          });
        }
        return g.__chainOe(injection);
      };
    });
    const release = (kind: string) => worker.evaluate(async (k: string) => {
      const g: any = globalThis;
      const idx = g.__chainHold.findIndex((i: any) => i.kind === k);
      if (idx === -1) return 0;
      const [item] = g.__chainHold.splice(idx, 1);
      const result = await g.__chainOe(item.injection);
      item.resolve(result);
      return 1;
    }, kind);

    // Two resume chains queue for this tab: the first one is held at its
    // probe and late-injects the newest document; the second one is held at
    // its probe and issues the reconcile we delay.
    await page.goto(betaUrl);
    await page.goto(viewsUrl);
    await expect(page).toHaveURL(viewsUrl);

    // Release the first chain's probe: the newest document has no instance
    // yet, so the real probe sees none and the chain takes its injection
    // path; its flag and files stay held, then land here (flag first) as a
    // late default-hidden instance.
    await expect.poll(async () => release("probe"), { timeout: 15_000 }, { message: "the first resume chain was held at its probe" }).toBe(1);
    await expect.poll(async () => release("flag"), { timeout: 15_000 }, { message: "the chain queued its initial-visibility flag" }).toBe(1);
    await expect.poll(async () => release("files"), { timeout: 15_000 }, { message: "the chain queued its content files" }).toBe(1);
    // Mounted-and-hidden: the late instance the files release just mounted.
    await expect(host()).toBeAttached();
    await expect(host()).toBeHidden();

    // Release the second chain's probe: the late instance now exists, so the
    // real probe sees it; the persisted state is still hidden, so the chain
    // issues its reconcile - held until after the user's explicit show.
    await expect.poll(async () => release("probe"), { timeout: 15_000 }, { message: "the second resume chain was held at its probe" }).toBe(1);
    await expect.poll(async () => await worker.evaluate(() => (globalThis as any).__chainHold.filter((i: any) => i.kind === "reconcile").length), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

    // The user explicitly shows the toolbar: it persists as visible and the
    // pin comes back.
    await toggleToolbar();
    await expect(host()).toBeVisible();
    await expect.poll(markerCount, { timeout: 15_000 }).toBe(1);

    // Now let the delayed reconcile run. It read the persisted state as
    // hidden before the show: it must not undo the show.
    await expect.poll(async () => release("reconcile"), { timeout: 15_000 }, { message: "the chain queued its reconcile" }).toBeGreaterThanOrEqual(1);
    await expect(host()).toBeVisible();
    expect(await markerCount()).toBe(1);
  } finally {
    await context.close();
  }
});
