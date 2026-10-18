import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, expect, test, type Worker } from "@playwright/test";
import { resetCloudLocalAuthRateLimits, resetCloudLocalProEmailChallenge, signInCloudPro } from "../helpers/cloud-signin";
import { pressCopyShortcut } from "../helpers/extension-shortcut";

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

// The toolbar action injects CONTENT_INJECTION_FILES (extension/session.js);
// read the list from the source so the capture here never drifts from it.
function contentInjectionFiles(): string[] {
  const source = readFileSync(join(EXTENSION_DIR, "session.js"), "utf8");
  const list = /CONTENT_INJECTION_FILES = \[([^\]]+)\]/.exec(source)?.[1] ?? "";
  const files = [...list.matchAll(/"([^"]+\.js)"/g)].map((match) => match[1]);
  if (files.length === 0 || !files.includes("content.js")) throw new Error("CONTENT_INJECTION_FILES not found");
  return files;
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

// The capture lands in the signed-in account through the extension's device
// token: the history is the cloud project tree, not the retired local
// /api/history installation endpoint.
async function cloudHistory(deviceToken: string): Promise<HistorySession[]> {
  const response = await fetch(`${BASE_URL}/api/project-tree`, {
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  if (!response.ok) return [];
  const body = (await response.json()) as {
    tree?: { projects?: { collections?: { sessions?: HistorySession[] }[] }[] }[];
  };
  const sessions: HistorySession[] = [];
  for (const project of body.tree?.projects ?? []) {
    for (const collection of project.collections ?? []) {
      sessions.push(...(collection.sessions ?? []));
    }
  }
  return sessions;
}

// Mutation captured: breaking any leg of the signed-in journey (storage
// destination, email sign-in, capture upload, web listing) leaves this closed
// loop unfinished.
test("the real extension signs in with the email account, captures to the cloud, and the web app lists the capture", async ({ browser }) => {
  test.setTimeout(180_000);
  const stagedExtension = stageExtension();
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pinar-free-e2e-")), {
    args: [
      `--disable-extensions-except=${stagedExtension}`,
      `--load-extension=${stagedExtension}`,
    ],
    channel: "chromium",
    locale: "en-US",
  });
  // The Pro fixture account is shared with the other cloud tests and its
  // storage use is asserted elsewhere, so the capture made here is removed
  // again (also when an assertion fails).
  let cleanupToken = "";
  let preexisting = new Set<string>();
  try {
    const worker = await backgroundWorker(context);
    // Endpoint plumbing: point the extension at the isolated cloud runtime in
    // cloud storage mode and pin the options UI language so the assertions
    // stay deterministic. Cloud mode matters twice: the options page would
    // otherwise adopt the delivery preferences (language included) of any
    // local Pinar helper running on the machine, and a capture could land in
    // that helper instead of the cloud.
    // The background's own startup pass writes the development default
    // (staging) when the key is still absent, so the endpoint is set until it
    // sticks instead of racing that write.
    await expect.poll(async () => {
      await worker.evaluate(async (cloudUrl) => {
        await chrome.storage.sync.set({ cloudUrl, language: "en", storageMode: "cloud" });
      }, BASE_URL);
      await new Promise((settle) => setTimeout(settle, 400));
      const { cloudUrl } = await worker.evaluate(() => chrome.storage.sync.get("cloudUrl"));
      return cloudUrl;
    }, { timeout: 15_000 }).toBe(BASE_URL);

    const options = await context.newPage();
    await options.goto(worker.url().replace(/background\.js$/, "dist/options.html"));

    // Real email sign-in through the real options UI; the seeded Pro fixture
    // answers with the one-shot code (re-armed right before verify).
    await resetCloudLocalAuthRateLimits();
    await options.getByPlaceholder("you@example.com").fill("pro.cloud-local@pinar.test");
    await options.getByRole("button", { exact: true, name: "Send code" }).click();
    await expect(options.getByText("If this email belongs to an eligible account, a six-digit code is on its way.")).toBeVisible();
    await resetCloudLocalProEmailChallenge();
    await options.getByPlaceholder("000000").fill("826826");
    await options.getByRole("button", { exact: true, name: "Verify" }).click();
    await expect(options.getByText("pro.cloud-local@pinar.test (PRO)")).toBeVisible();

    // The extension keeps its installation identity and cloud credential
    // scoped to the endpoint in local storage.
    const stored = await worker.evaluate((base) => chrome.storage.local.get([
      `remote:${base}:installationId`,
      `remote:${base}:installationToken`,
      `remote:${base}:deviceToken`,
    ]), BASE_URL);
    const identity = {
      deviceToken: String(stored[`remote:${BASE_URL}:deviceToken`] ?? ""),
      id: String(stored[`remote:${BASE_URL}:installationId`] ?? ""),
      token: String(stored[`remote:${BASE_URL}:installationToken`] ?? ""),
    };
    expect(identity.id).toMatch(/^ins_/);
    expect(identity.token).toMatch(/^pit_/);
    expect(identity.deviceToken).toMatch(/^pdt_/);
    cleanupToken = identity.deviceToken;
    preexisting = new Set((await cloudHistory(cleanupToken)).map((candidate) => candidate.id));

    // Real capture: the same files the toolbar action injects, on a real page.
    const target = await context.newPage();
    await target.goto(`${BASE_URL}/`);
    // The pin targets the element under the click: let the landing page finish
    // laying out (hydration, fonts) so it is the hero copy and not a taller
    // ancestor that reaches below the fold.
    await expect(target.getByRole("heading", { level: 1 })).toBeVisible();
    await target.waitForLoadState("networkidle");
    await worker.evaluate(async ({ baseUrl, files }) => {
      const tabs = await chrome.tabs.query({ url: `${baseUrl}/*` });
      const tab = tabs.find((candidate) => new URL(candidate.url ?? "").pathname === "/");
      if (!tab?.id) throw new Error("capture tab not found");
      await chrome.scripting.executeScript({
        files,
        target: { allFrames: true, tabId: tab.id },
      });
    }, { baseUrl: BASE_URL, files: contentInjectionFiles() });
    await expect(target.locator('[data-pinar="host"]')).toBeVisible();
    await target.mouse.click(400, 300);
    await target.keyboard.type("Cloud flow capture");
    await pressCopyShortcut(target);
    // sendPins hides the overlay only after the cloud upload + handoff succeed.
    await expect(target.locator('[data-pinar="host"]')).toBeHidden({ timeout: 30_000 });

    // The capture is listed for the signed-in account (via the extension's
    // device token), and the viewer opens from the web app.
    // The session row can exist a moment before its pin is stored, so wait for
    // a session that already carries the pin.
    const pinned = async () => (await cloudHistory(identity.deviceToken)).filter((candidate) => candidate.pinCount > 0);
    await expect.poll(() => pinned().then((sessions) => sessions.length), {
      timeout: 20_000,
    }).toBeGreaterThan(0);
    const [session] = await pinned();
    expect(session.page.url).toContain("127.0.0.1:17384");

    // The signed-in workspace lists the capture (its own web session cookie).
    const app = await browser.newPage();
    await signInCloudPro(app);
    await app.goto(`${BASE_URL}/app`);
    await expect(app.getByText(session.page.title).first()).toBeVisible();
    await app.goto(`${BASE_URL}/v/${session.id}`);
    // The viewer opens the captured page with its pin and comment.
    await expect(app.getByText("Cloud flow capture").first()).toBeVisible();
  } finally {
    await context.close();
    if (cleanupToken) {
      for (const created of (await cloudHistory(cleanupToken)).filter((candidate) => !preexisting.has(candidate.id))) {
        await fetch(`${BASE_URL}/api/history/${encodeURIComponent(created.id)}`, {
          headers: { authorization: `Bearer ${cleanupToken}` },
          method: "DELETE",
        });
      }
    }
  }
});
