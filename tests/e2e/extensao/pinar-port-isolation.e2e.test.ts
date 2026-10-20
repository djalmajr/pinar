import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { CONTENT_INJECTION_FILES } from "../../../extension/session.js";
import { launchExtensionContext, pinarPortLog } from "../helpers/extension-context";
import { pressCopyShortcut } from "../helpers/extension-shortcut";

// Guard for launchExtensionContext: a Pinar-shaped listener owned by this test
// sits on a free port of the extension's probe range (never 17373, the
// machine's Pinar.app). With the default isolation it must receive nothing
// through the service worker's startup, the options page in local mode and a
// capture; the positive control forwards only that port and proves the same
// journey does reach it while 17373 and the rest stay refused.

interface ListenerRequest {
  method: string;
  path: string;
}

const json = (body: unknown) => JSON.stringify(body);

// Every TCP connection counts, so a TLS tunnel that never becomes an HTTP
// request still shows up.
async function listenOnFreePinarPort(received: ListenerRequest[]): Promise<{ connections: () => number; port: number; server: Server }> {
  for (let port = 17374; port <= 17382; port += 1) {
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://listener").pathname;
      received.push({ method: request.method ?? "GET", path });
      response.setHeader("content-type", "application/json");
      if (path === "/api/health") return response.end(json({ ok: true, runtime: "local", service: "pinar" }));
      if (path === "/api/local/capability") return response.end(json({ token: "guard-capability" }));
      if (path === "/api/preferences") return response.end(json({ includeScreenshot: true, includeViewer: true, language: "en" }));
      if (path === "/api/project-tree") return response.end(json({ tree: { projects: [{ collections: [{ id: "collection", isProtected: true }], id: "project" }] } }));
      if (path === "/api/shots" || path === "/api/history") {
        response.statusCode = 201;
        return response.end(json({ ok: true, path: "/shots/guard.png" }));
      }
      response.statusCode = 200;
      response.end(json({ ok: true }));
    });
    let connections = 0;
    server.on("connection", () => { connections += 1; });
    const bound = await new Promise<boolean>((settle) => {
      server.once("error", () => settle(false));
      server.listen(port, "127.0.0.1", () => settle(true));
    });
    if (bound) return { connections: () => connections, port, server };
  }
  throw new Error("no free port between 17374 and 17382 for the guard listener");
}

async function backgroundWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] || context.waitForEvent("serviceworker");
}

async function capture(context: BrowserContext, worker: Worker): Promise<Page> {
  await context.route("https://isolation.pinar.test/**", (route) => route.fulfill({
    body: '<html lang="en"><title>Isolation fixture</title><body style="margin:0;padding:120px"><button style="width:240px;height:120px">Target</button></body></html>',
    contentType: "text/html",
  }));
  const page = await context.newPage();
  await page.goto("https://isolation.pinar.test/");
  await worker.evaluate(async (files) => {
    const [tab] = await chrome.tabs.query({ url: "https://isolation.pinar.test/*" });
    if (!tab?.id) throw new Error("capture tab not found");
    await chrome.scripting.executeScript({ files, target: { tabId: tab.id } });
  }, CONTENT_INJECTION_FILES);
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
  await page.mouse.click(240, 180);
  await page.keyboard.type("Isolation guard pin");
  await pressCopyShortcut(page);
  return page;
}

for (const control of [false, true]) {
  test(control
    ? "positive control: only the allowed listener port is forwarded, 17373 stays refused"
    : "the loaded extension never reaches a Pinar port: startup, local options and a capture", async ({ browserName }) => {
    test.skip(browserName !== "chromium", "MV3 loading is Chromium-only");
    test.setTimeout(60_000);
    const received: ListenerRequest[] = [];
    const listener = await listenOnFreePinarPort(received);
    const extension = resolve("extension");
    let context: BrowserContext | undefined;
    try {
      context = await launchExtensionContext("", {
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
        channel: "chromium",
        headless: true,
      }, control ? { allowPinarPorts: [listener.port] } : {});
      const log = pinarPortLog(context);
      const refusedOn = (port: number) => log.refused.filter((request) => request.port === port);
      // Playwright's view of what the extension asked the listener's port for,
      // whatever the proxy then did with it.
      const askedListener = () => log.observed.filter((request) => request.port === listener.port).length;

      // Service worker startup.
      const worker = await backgroundWorker(context);
      await worker.evaluate(() => chrome.storage.sync.set({ enableHistory: true, language: "en", storageMode: "local" }));
      if (!control) expect(received).toEqual([]);

      // Options page in local mode: it asks the service worker for the local
      // helper's delivery preferences.
      const options = await context.newPage();
      await options.goto(`chrome-extension://${new URL(worker.url()).host}/dist/options.html`);
      await expect(options.getByRole("radio", { name: /Local Server|Servidor Local/ })).toBeChecked();
      if (control) {
        await expect.poll(() => received.some((request) => request.path === "/api/health")).toBe(true);
      } else {
        await expect.poll(askedListener).toBeGreaterThan(0);
        expect(received).toEqual([]);
      }
      await options.close();

      // A capture: the toolbar's content scripts, a pin and the copy shortcut.
      const askedBeforeCapture = askedListener();
      const receivedBeforeCapture = received.length;
      await capture(context, worker);
      if (control) {
        await expect.poll(() => received.slice(receivedBeforeCapture).some((request) => request.method === "POST" && request.path === "/api/shots"), { timeout: 15_000 }).toBe(true);
      } else {
        await expect.poll(askedListener, { timeout: 15_000 }).toBeGreaterThan(askedBeforeCapture);
        expect(received).toEqual([]);
      }

      // The same port over TLS goes through the proxy's CONNECT path.
      if (!control) {
        const tls = await worker.evaluate((port) => fetch(`https://127.0.0.1:${port}/api/health`).then(() => "answered", () => "refused"), listener.port);
        expect(tls).toBe("refused");
        expect(listener.connections()).toBe(0);
        expect(refusedOn(listener.port).some((request) => request.method === "CONNECT")).toBe(true);
      }

      // Every port but the allowed one was refused by the proxy, 17373 included,
      // and Playwright saw the service worker issue those requests.
      expect(refusedOn(17373).length).toBeGreaterThan(0);
      expect(log.observed.some((request) => request.origin === "service-worker")).toBe(true);
      if (control) {
        expect(refusedOn(listener.port)).toEqual([]);
        expect(received.length).toBeGreaterThan(0);
      } else {
        expect(refusedOn(listener.port).length).toBeGreaterThan(0);
        expect(received).toEqual([]);
        expect(listener.connections()).toBe(0);
      }
    } finally {
      await context?.close();
      await new Promise<void>((settle) => {
        listener.server.closeAllConnections();
        listener.server.close(() => settle());
      });
    }
  });
}
