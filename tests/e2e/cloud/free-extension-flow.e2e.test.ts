import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, expect, test, type Worker } from "@playwright/test";

const EXTENSION_DIR = resolve(process.cwd(), "extension");
const BASE_URL = "http://127.0.0.1:17384";
// Fixed CRX key so the unpacked extension always gets the id the local cloud
// runtime trusts as EXTENSION_ORIGIN (chrome-extension://bobfbkbogoiemdcjchoakflgepmekdeh).
const DEV_EXTENSION_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmkNabf6ZtL0IPuCEEFlnf8YxL9j92z9eIbPksunV62jHw001fI3JLiou3NVyfV8qyT5Qp7suOkKwImuqvzWwRlHQCObEhtCMhnq7TAYvPT5k9WiB6pUs8t1RJzuwS3vLicklGxGPHPyWnNHbPmh/Ovn2iZWIhp55eQxujsGUzZ9P66WIDYR8459GBa0o3x4AQ2l2hlP0ANsyeJjg/f+3T038ulOfQr0TMvgsmLN/Ca+OByAKKR9f5wWIl2y7EdJMCBfZ8hWLlmy/vaM4tF6n9U+E/W4h9nwzQfgd/VuAZnSBS01KORSrv6JEbdKoo9LRR0mdvramaVNDhUzQDLOLpwIDAQAB";

function stageExtension(): string {
  const staged = join(mkdtempSync(join(tmpdir(), "pinar-free-ext-")), "extension");
  cpSync(EXTENSION_DIR, staged, { recursive: true });
  const manifestPath = join(staged, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.key = DEV_EXTENSION_KEY;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return staged;
}

interface HistorySession {
  id: string;
  page: { title: string; url: string };
  pinCount: number;
}

async function backgroundWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers().find((worker) => worker.url().endsWith("background.js"));
  if (existing) return existing;
  return context.waitForEvent("serviceworker", {
    predicate: (worker) => worker.url().endsWith("background.js"),
  });
}

async function installationHistory(identity: { id: string; token: string }): Promise<HistorySession[]> {
  const response = await fetch(`${BASE_URL}/api/history`, {
    headers: {
      authorization: `Bearer ${identity.token}`,
      "x-pinar-installation-id": identity.id,
    },
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { sessions?: HistorySession[] };
  return body.sessions ?? [];
}

// Mutation captured: breaking any leg of the remote Free journey (legal consent,
// installation registration, capture upload, temporary code, web exchange, free
// entitlements) leaves this closed loop unfinished.
test("the real extension registers a free installation, captures, and signs the web app in", async () => {
  test.setTimeout(180_000);
  const stagedExtension = stageExtension();
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pinar-free-e2e-")), {
    args: [
      `--disable-extensions-except=${stagedExtension}`,
      `--load-extension=${stagedExtension}`,
    ],
    channel: "chromium",
  });
  try {
    const worker = await backgroundWorker(context);
    // Endpoint plumbing only: point the extension at the isolated cloud runtime.
    // Mode selection and legal consent go through the real options UI below.
    await worker.evaluate(async (cloudUrl) => {
      await chrome.storage.sync.set({ cloudUrl });
    }, BASE_URL);

    const options = await context.newPage();
    await options.goto(worker.url().replace(/background\.js$/, "dist/options.html"));
    await options.getByText("Remote Server", { exact: true }).click();
    await options.getByLabel("I accept the current documents for Pinar's hosted service.").check();
    await options.getByRole("button", { exact: true, name: "Save" }).click();
    // Saved state re-disables the button (the toast may expire before a check).
    await expect(options.getByRole("button", { exact: true, name: "Save" })).toBeDisabled();

    // Temporary code through the real options UI (Account tab), which also
    // advertises the Free installation on the extension side. Generating the
    // code is what registers the installation remotely.
    await options.getByRole("tab", { name: "Account" }).click();
    await expect(options.getByText("Continue with a Free installation", { exact: true })).toBeVisible();
    await options.getByRole("button", { exact: true, name: "Generate code" }).click();
    const code = (await options.locator("code").first().innerText()).trim();
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);

    const stored = await worker.evaluate(() => chrome.storage.local.get(["installationId", "installationToken"]));
    const identity = {
      id: String(stored.installationId ?? ""),
      token: String(stored.installationToken ?? ""),
    };
    expect(identity.id).toMatch(/^ins_/);
    expect(identity.token).toMatch(/^pit_/);

    // Exchange the single-use code in the web app and land on the free workspace.
    const app = await context.newPage();
    await app.goto(`${BASE_URL}/sign-in?extensionCode=${code}&returnTo=%2Fapp`);
    await expect(app).toHaveURL(/\/app$/);

    // Free entitlements: 250 MB cloud storage and no AI credits.
    const openAccountMenu = async () => {
      await app.locator('[data-sidebar="footer"]')
        .getByRole("button", { exact: true, name: "Account menu" })
        .click();
    };
    await openAccountMenu();
    await expect(app.getByTestId("account-plan")).toHaveText("Free plan");
    await expect(app.getByTestId("account-credits")).toHaveCount(0);
    await expect(app.getByTestId("account-storage").getByText(/of 250 MB/)).toBeVisible();
    await app.keyboard.press("Escape");

    // Real capture: the same files the toolbar action injects, on a real page.
    const target = await context.newPage();
    await target.goto(`${BASE_URL}/`);
    await worker.evaluate(async (baseUrl) => {
      const tabs = await chrome.tabs.query({ url: `${baseUrl}/*` });
      const tab = tabs.find((candidate) => new URL(candidate.url ?? "").pathname === "/");
      if (!tab?.id) throw new Error("capture tab not found");
      await chrome.scripting.executeScript({
        files: ["coordinates.js", "frame-path.js", "locators.js", "privacy.js", "keyboard.js", "content.js"],
        target: { allFrames: true, tabId: tab.id },
      });
    }, BASE_URL);
    await expect(target.locator('[data-pinar="host"]')).toBeVisible();
    await target.mouse.click(400, 300);
    await target.keyboard.type("Free flow capture");
    await target.keyboard.press("Control+Enter");
    // sendPins hides the overlay only after the cloud upload + handoff succeed.
    await expect(target.locator('[data-pinar="host"]')).toBeHidden({ timeout: 30_000 });

    await expect.poll(() => installationHistory(identity).then((sessions) => sessions.length), {
      timeout: 20_000,
    }).toBeGreaterThan(0);
    const [session] = await installationHistory(identity);
    expect(session.pinCount).toBeGreaterThan(0);
    expect(session.page.url).toContain("127.0.0.1:17384");

    // The signed-in workspace lists the capture. Free has no AI summary.
    await app.goto(`${BASE_URL}/app`);
    await expect(app.getByText(session.page.title).first()).toBeVisible();
    await app.goto(`${BASE_URL}/v/${session.id}`);
    await expect(app.getByRole("button", { name: "AI summary" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
