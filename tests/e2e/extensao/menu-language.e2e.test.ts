import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("application language changes refresh the extension action menu", async () => {
  const extension = resolve("extension");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      const titles: Record<string, string> = {};
      (globalThis as any).__menuTitles = titles;
      const update = chrome.contextMenus.update.bind(chrome.contextMenus);
      chrome.contextMenus.update = ((id: string, props: { title?: string }, callback: () => void) => {
        if (props.title) titles[id] = props.title;
        return update(id, props, callback);
      }) as typeof chrome.contextMenus.update;
      await chrome.storage.sync.set({ language: "en" });
    });
    await context.route("https://pinar.dev/app*", (route) => route.fulfill({ contentType: "text/html", body: '<html lang="en"><title>Language fixture</title><body>Application</body></html>' }));
    const page = await context.newPage();
    await page.goto("https://pinar.dev/app");
    for (const [language, title] of [["pt", "Concluir sessão"], ["en", "Finish session"]]) {
      await page.evaluate((language) => {
        localStorage.setItem("pinar-language", language);
        document.documentElement.lang = language;
      }, language);
      await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get("language")).language)).toBe(language);
      await expect.poll(() => worker.evaluate(() => (globalThis as any).__menuTitles["pinar-batch-toggle"])).toBe(title);
    }
    // A normal annotated site must not be able to change extension language.
    await context.route("https://unrelated.test/**", (route) => route.fulfill({ contentType: "text/html", body: '<html lang="pt"><body>Other site</body></html>' }));
    await page.goto("https://unrelated.test/");
    const denied = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => chrome.runtime.sendMessage({ type: "app:language", language: "pt" }) });
      return result.result;
    });
    expect(denied).toEqual({ ok: false });
    expect(await worker.evaluate(async () => (await chrome.storage.sync.get("language")).language)).toBe("en");
  } finally { await context.close(); }
});
