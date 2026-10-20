import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, expect, test, type Worker } from "@playwright/test";
import { resetCloudLocalAuthRateLimits, resetCloudLocalProEmailChallenge, signInCloudPro } from "../helpers/cloud-signin";
import { pressCopyShortcut } from "../helpers/extension-shortcut";
import { launchExtensionContext } from "../helpers/extension-context";

const EXTENSION_DIR = resolve(process.cwd(), "extension");
const BASE_URL = "http://127.0.0.1:17384";
const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
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
  const context = await launchExtensionContext(mkdtempSync(join(tmpdir(), "pinar-free-e2e-")), {
    args: [
      `--disable-extensions-except=${stagedExtension}`,
      `--load-extension=${stagedExtension}`,
    ],
    channel: "chromium",
    locale: "en-US",
  });
  // The Pro fixture account is shared with the other cloud tests and its
  // storage use is asserted elsewhere, so the capture made here is removed
  // again (also when an assertion fails): everything that is not in the
  // baseline taken right after sign-in, the earlier session seeded below included.
  let cleanupToken = "";
  let baseline = new Set<string>();
  let preexisting = new Set<string>();
  try {
    const worker = await backgroundWorker(context);
    // Endpoint plumbing: point the extension at the isolated cloud runtime in
    // cloud storage mode, the destination this journey proves, and pin the
    // options UI language so the assertions stay deterministic. The machine's
    // own Pinar helper is out of reach either way: launchExtensionContext
    // refuses the local helper ports for the whole context.
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
    baseline = new Set((await cloudHistory(cleanupToken)).map((candidate) => candidate.id));

    // Regression for the selection below: an earlier session with a pin is
    // already in the account when the capture under test is made (what an
    // interrupted earlier run leaves behind), so "the first session with a
    // pin" would be the wrong one. It is seeded through the cloud API with the
    // device token (a capture made by the extension would join this run's
    // review batch instead of staying a separate session). Both comments carry
    // a per-run suffix.
    const runId = Date.now().toString(36);
    const earlierId = `earlier_${runId}`;
    const earlierComment = `Earlier capture ${runId}`;
    const comment = `Cloud flow capture ${runId}`;
    const seeded = await fetch(`${BASE_URL}/api/shots`, {
      body: JSON.stringify({
        id: earlierId,
        image: ONE_PIXEL_PNG,
        page: { title: `Earlier run ${runId}`, url: `${BASE_URL}/earlier-run` },
        pins: [{ comment: earlierComment, number: 1 }],
      }),
      headers: { authorization: `Bearer ${identity.deviceToken}`, "content-type": "application/json" },
      method: "POST",
    });
    expect(seeded.status).toBe(201);
    preexisting = new Set((await cloudHistory(identity.deviceToken)).map((candidate) => candidate.id));
    expect(preexisting.has(earlierId)).toBe(true);
    expect((await cloudHistory(identity.deviceToken)).find((candidate) => candidate.id === earlierId)?.pinCount).toBe(1);

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
    await target.keyboard.type(comment);
    await pressCopyShortcut(target);
    // sendPins hides the overlay only after the cloud upload + handoff succeed.
    await expect(target.locator('[data-pinar="host"]')).toBeHidden({ timeout: 30_000 });

    // The capture is listed for the signed-in account (via the extension's
    // device token). The session row can exist a moment before its pin is
    // stored, so wait for a session that is new in this run and already
    // carries the pin; that exact id is the one the viewer opens.
    const created = async () => (await cloudHistory(identity.deviceToken))
      .filter((candidate) => !preexisting.has(candidate.id) && candidate.pinCount > 0);
    await expect.poll(() => created().then((sessions) => sessions.length), {
      timeout: 20_000,
    }).toBeGreaterThan(0);
    const [session] = await created();
    expect(session.id).not.toBe(earlierId);
    expect(session.page.url).toContain("127.0.0.1:17384");

    // The signed-in workspace lists the capture (its own web session cookie).
    const app = await browser.newPage();
    await signInCloudPro(app);
    await app.goto(`${BASE_URL}/app`);
    await expect(app.getByText(session.page.title).first()).toBeVisible();
    await app.goto(`${BASE_URL}/v/${session.id}`);
    // The viewer opens the captured page with this run's pin comment.
    await expect(app.getByText(comment).first()).toBeVisible();
    await expect(app.getByText(earlierComment)).toHaveCount(0);
  } finally {
    await context.close();
    if (cleanupToken) {
      for (const leftover of (await cloudHistory(cleanupToken)).filter((candidate) => !baseline.has(candidate.id))) {
        await fetch(`${BASE_URL}/api/history/${encodeURIComponent(leftover.id)}`, {
          headers: { authorization: `Bearer ${cleanupToken}` },
          method: "DELETE",
        });
      }
    }
  }
});
