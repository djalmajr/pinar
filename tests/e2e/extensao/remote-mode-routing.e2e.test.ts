import { chromium, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cloudEnvironment, resolveCloudUrl } from "../../../extension/environment.js";
import { remoteProfileKey } from "../../../extension/remote-profile.js";

test("remote selection drives app routing and Pro microphone availability", async () => {
  const extension = resolve("extension");
  const manifest = JSON.parse(readFileSync(resolve(extension, "manifest.json"), "utf8"));
  const endpoint = resolveCloudUrl(manifest);
  const environment = cloudEnvironment(manifest);
  const deviceTokenKey = remoteProfileKey(endpoint, "deviceToken");
  const sessionUrl = `${endpoint}/api/auth/session`;
  const remoteRadioName = environment === "staging" ? /Staging/ : /Remote Server|Servidor Remoto/;
  const context = await chromium.launchPersistentContext("", {
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    channel: "chromium",
    headless: true,
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async ({ deviceTokenKey, endpoint, sessionUrl }) => {
      await chrome.storage.sync.set({ language: "en", storageMode: "local" });
      await chrome.storage.local.set({ [deviceTokenKey]: `pdt_${"a".repeat(43)}` });
      const originalFetch = globalThis.fetch;
      const json = (body: unknown) => new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === sessionUrl) {
          return Promise.resolve(json({
            session: { email: "contato@pinar.dev", kind: "account", plan: "pro", userId: "preview" },
          }));
        }
        if (url.startsWith(endpoint)) return Promise.resolve(json({ ok: true }));
        return originalFetch(input, init);
      }) as typeof fetch;
      (globalThis as any).__openedAppUrls = [];
      chrome.tabs.create = (async (properties: chrome.tabs.CreateProperties) => {
        (globalThis as any).__openedAppUrls.push(properties.url);
        return { id: 999, url: properties.url } as chrome.tabs.Tab;
      }) as typeof chrome.tabs.create;
    }, { deviceTokenKey, endpoint, sessionUrl });

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/dist/options.html`);
    const localVoiceAvailability = await options.evaluate(() => chrome.runtime.sendMessage({ type: "voice:availability" }));
    expect(localVoiceAvailability).toMatchObject({ available: false, ok: true, reason: "cloud_required" });
    await expect(options.getByRole("radio", { name: /Local Server|Servidor Local/ })).toBeChecked();
    const remoteRadio = options.getByRole("radio", { name: remoteRadioName });
    await remoteRadio.check();
    await expect(remoteRadio).toBeChecked();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get("storageMode")).storageMode)).toBe("cloud");
    await expect(options.getByText("contato@pinar.dev (PRO)")).toBeVisible();
    await expect(options.getByRole("link", { name: /Create account|Criar conta/ })).toHaveCount(0);

    await options.getByRole("button", { name: /Open app|Abrir app/ }).click();
    const openedAppPattern = new RegExp(`^${endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/app\\?lang=`);
    await expect.poll(() => worker.evaluate(() => (globalThis as any).__openedAppUrls)).toEqual([
      expect.stringMatching(openedAppPattern),
    ]);

    const commands = await worker.evaluate(() => chrome.commands.getAll());
    expect(commands.find((command) => command.name === "open-panel")?.shortcut).toMatch(/^(?:Alt\+Shift\+O|⌥⇧O)$/);
    await options.getByRole("tab", { name: /Shortcuts|Atalhos/ }).click();
    await expect(options.getByRole("tabpanel").locator("[data-slot=separator]")).toHaveCount(1);
    await expect(options.getByText(/Open the Pinar panel|Abrir o painel do Pinar/)).toBeVisible();

    const voiceAvailability = await options.evaluate(() => chrome.runtime.sendMessage({ type: "voice:availability" }));
    expect(voiceAvailability).toMatchObject({ available: true, ok: true, reason: null });
  } finally {
    await context.close();
  }
});
