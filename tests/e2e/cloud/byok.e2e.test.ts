import { expect, type Locator, type Page, test } from "@playwright/test";
import { signInCloudPro } from "../helpers/cloud-signin";

// F5/S4: the BYOK endpoint subpanel of the Cloud AI settings section. Every
// /api/byok* answer is mocked with page.route, so no real key ever reaches
// the server or a failure artifact, and the real local database is never
// written.
//
// The Cloud Pro fixture is signed in through the shared helper (which
// re-arms its one-shot email challenge), so the file is order-independent:
// test and save (a failed test first, then a passing one), the connection
// test of the saved endpoint, then remove, then the 503 unavailable state.

const UNTESTED = { error: null, ok: null, testedAt: null };

const UNCONFIGURED = {
  baseUrl: null,
  capabilities: {
    chat: UNTESTED,
    embeddings: { ...UNTESTED, dims: null },
    tools: UNTESTED,
    transcription: UNTESTED,
    vision: UNTESTED,
  },
  configured: false,
  keyLast4: null,
  models: { chat: null, embedding: null, transcription: null },
  updatedAt: null,
};

// The PUT tests before it saves: no capability passed, nothing was saved.
const TEST_FAILED = {
  capabilities: {
    chat: { error: "key_rejected", ok: false, testedAt: "2026-10-18T00:00:01.000Z" },
    embeddings: { dims: null, error: "model_not_configured", ok: false, testedAt: "2026-10-18T00:00:01.000Z" },
    tools: { error: "key_rejected", ok: false, testedAt: "2026-10-18T00:00:01.000Z" },
    transcription: { error: "model_not_configured", ok: false, testedAt: "2026-10-18T00:00:01.000Z" },
    vision: { error: "key_rejected", ok: false, testedAt: "2026-10-18T00:00:01.000Z" },
  },
  code: "byok_test_failed",
  error: "No capability passed the connection test; nothing was saved",
};

// Mixed: chat with tools and vision ride the endpoint; embeddings fail with
// a cause and ride the credits; transcription is still untested.
const MIXED = {
  baseUrl: "https://provider.example.test/v1",
  capabilities: {
    chat: { error: null, ok: true, testedAt: "2026-10-18T00:00:05.000Z" },
    embeddings: { dims: null, error: "model_not_found", ok: false, testedAt: "2026-10-18T00:00:06.000Z" },
    tools: { error: null, ok: true, testedAt: "2026-10-18T00:00:05.000Z" },
    transcription: UNTESTED,
    vision: { error: null, ok: true, testedAt: "2026-10-18T00:00:07.000Z" },
  },
  configured: true,
  keyLast4: "abcd",
  models: { chat: "gpt-e2e", embedding: null, transcription: null },
  updatedAt: "2026-10-18T00:00:07.000Z",
};

// Signs in the Cloud Pro fixture. The email code is one-shot per verify,
// so the helper re-arms the seeded challenge right before each sign-in.
async function signInPro(page: Page) {
  await signInCloudPro(page);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app$/);
}

// The first click right after the page load can land before hydration and
// be swallowed, so the trigger is clicked until the menu actually opens.
async function clickAccountMenu(page: Page) {
  const trigger = page.locator('[data-sidebar="footer"]').getByRole("button", { exact: true, name: "Account menu" });
  await trigger.waitFor();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await page.keyboard.press("Escape");
    await trigger.click();
    const opened = await page
      .locator('[role="menuitem"]')
      .first()
      .waitFor({ timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  await trigger.click();
}

async function openAiSettings(page: Page): Promise<Locator> {
  await clickAccountMenu(page);
  await page.getByRole("menuitem", { exact: true, name: "Settings" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("aside").getByRole("button", { exact: true, name: "AI Assistant" }).click();
  return dialog;
}

async function closeSettings(dialog: Locator, page: Page) {
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
}

function capabilityRow(card: Locator, name: string): Locator {
  return card.locator("div.py-2", { hasText: name });
}

test("Cloud Pro BYOK endpoint: test and save, capability origins, masked key, remove, and 503 hides the panel", async ({ page }) => {
  const rawKey = "sk-e2e-byok-raw-key";
  const puts: Array<Record<string, unknown>> = [];
  let testCalls = 0;
  let deletes = 0;
  await page.route("**/api/byok", (route) => {
    if (route.request().method() === "PUT") {
      puts.push(route.request().postDataJSON() as Record<string, unknown>);
      // The first test fails (nothing saved); the second passes and saves.
      return puts.length === 1
        ? route.fulfill({ json: TEST_FAILED, status: 422 })
        : route.fulfill({ json: MIXED });
    }
    if (route.request().method() === "DELETE") {
      deletes += 1;
      return route.fulfill({ json: UNCONFIGURED });
    }
    // The initial read is the unconfigured view; the test-and-save answers
    // above (and the 503 re-registration in the last phase) take over.
    return route.fulfill({ json: UNCONFIGURED });
  });
  await page.route("**/api/byok/test", (route) => {
    testCalls += 1;
    return route.fulfill({ json: MIXED });
  });

  await signInPro(page);

  // --- Phase 1: Test and save; a failed test saves nothing, a passing one saves ---
  const dialog = await openAiSettings(page);
  const byok = dialog.getByText("Your own endpoint", { exact: true });
  await expect(byok).toBeVisible();
  // The two contract sentences and the empty state (S4).
  await expect(dialog.getByText("Capabilities that pass the connection test use your endpoint with no credits; the rest uses Pinar credits.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("The AI provider is chosen and contracted by you; Pinar only relays the requests.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Save the endpoint and test the connection to route AI capabilities to it.", { exact: true })).toBeVisible();

  await dialog.getByLabel("Endpoint", { exact: true }).fill("https://provider.example.test/v1");
  await dialog.getByLabel("API key", { exact: true }).fill(rawKey);
  await dialog.getByLabel("Chat model", { exact: true }).fill("gpt-e2e");
  // Without a saved endpoint the only action is "Test and save".
  await expect(dialog.getByRole("button", { exact: true, name: "Test connection" })).toHaveCount(0);
  await dialog.getByRole("button", { exact: true, name: "Test and save" }).click();

  // The 422: the tested capabilities show as an unsaved result, nothing was
  // saved, and the drafts and the typed key stay for the retry.
  const card = dialog.locator("div.rounded-lg.border.bg-card.p-3", { hasText: "Capabilities" });
  await expect(card.getByText("Test result, not saved", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Nothing was saved: no capability passed the connection test. Check the values and try again.", { exact: true })).toBeVisible();
  await expect(capabilityRow(card, "Chat with tools").getByText("The endpoint rejected the API key.", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("API key", { exact: true })).toHaveValue(rawKey);
  await expect(dialog.getByLabel("Chat model", { exact: true })).toHaveValue("gpt-e2e");
  await expect(dialog.getByRole("button", { exact: true, name: "Remove endpoint" })).toHaveCount(0);
  expect(testCalls).toBe(0);

  await dialog.getByRole("button", { exact: true, name: "Test and save" }).click();

  // The second PUT passed and saved the tested view; no POST follows it.
  await expect(capabilityRow(card, "Chat with tools").getByText("Your endpoint", { exact: true })).toBeVisible();
  await expect(card.getByText("Test result, not saved", { exact: true })).toHaveCount(0);
  expect(puts).toHaveLength(2);
  for (const put of puts) {
    expect(put).toMatchObject({
      apiKey: rawKey,
      baseUrl: "https://provider.example.test/v1",
      chatModel: "gpt-e2e",
      embeddingModel: "",
      transcriptionModel: "",
    });
  }
  expect(testCalls).toBe(0);

  // Saved and unchanged: the only action is "Test connection" (the POST).
  await expect(dialog.getByRole("button", { exact: true, name: "Test and save" })).toHaveCount(0);
  await dialog.getByRole("button", { exact: true, name: "Test connection" }).click();
  await expect.poll(() => testCalls).toBe(1);
  await expect(dialog.getByRole("button", { exact: true, name: "Test connection" })).toBeEnabled();
  // An edit brings "Test and save" back.
  await dialog.getByLabel("Chat model", { exact: true }).fill("gpt-e2e-2");
  await expect(dialog.getByRole("button", { exact: true, name: "Test and save" })).toBeVisible();
  await expect(dialog.getByRole("button", { exact: true, name: "Test connection" })).toHaveCount(0);
  await dialog.getByLabel("Chat model", { exact: true }).fill("gpt-e2e");
  await expect(dialog.getByRole("button", { exact: true, name: "Test connection" })).toBeVisible();

  // Mixed capabilities: the endpoint where the parts passed, the credits
  // with the cause where they failed, untested where nothing ran yet.
  await expect(capabilityRow(card, "Vision").getByText("Your endpoint", { exact: true })).toBeVisible();
  await expect(capabilityRow(card, "Embeddings").getByText("Pinar credits", { exact: true })).toBeVisible();
  await expect(capabilityRow(card, "Embeddings").getByText("The endpoint does not offer this model.", { exact: true })).toBeVisible();
  await expect(capabilityRow(card, "Transcription").getByText("Not tested", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Last tested/)).toBeVisible();

  // The key is masked to its last four characters and the raw value never
  // stays in the DOM (not in the input, not anywhere else in the dialog).
  await expect(dialog.getByLabel("API key", { exact: true })).toHaveValue("••••abcd");
  await expect(dialog.getByRole("button", { exact: true, name: "Change key" })).toBeVisible();
  expect(await dialog.innerHTML()).not.toContain(rawKey);

  // --- Phase 2: removing the endpoint confirms and empties the form ---
  await dialog.getByRole("button", { exact: true, name: "Remove endpoint" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove the endpoint?" });
  await expect(confirm).toContainText("The saved key and the tested capabilities are removed.");
  await confirm.getByRole("button", { exact: true, name: "Remove endpoint" }).click();

  await expect(page.getByText("Endpoint removed.", { exact: true })).toBeVisible();
  expect(deletes).toBe(1);
  await expect(confirm).not.toBeVisible();
  // The form is back to the empty state, without the endpoint.
  await expect(dialog.getByText("Save the endpoint and test the connection to route AI capabilities to it.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { exact: true, name: "Remove endpoint" })).toHaveCount(0);
  await expect(dialog.getByLabel("Endpoint", { exact: true })).toHaveValue("");

  // --- Phase 3: a 503 byok_unavailable hides the subpanel without a
  // placeholder, while the section keeps its usage content ---
  await page.route("**/api/byok", (route) => route.fulfill({
    json: { code: "byok_unavailable", error: "BYOK is not available in this deployment" },
    status: 503,
  }));
  await closeSettings(dialog, page);
  const reopened = await openAiSettings(page);
  await expect(reopened).toBeVisible();
  await expect(reopened.getByText("Your own endpoint", { exact: true })).toHaveCount(0);
  await expect(reopened.getByText("Capabilities that pass the connection test use your endpoint with no credits; the rest uses Pinar credits.", { exact: true })).toHaveCount(0);
  await expect(reopened.getByRole("button", { exact: true, name: "Test connection" })).toHaveCount(0);
  await expect(reopened.getByRole("button", { exact: true, name: "Test and save" })).toHaveCount(0);
  await expect(reopened.getByLabel("Endpoint", { exact: true })).toHaveCount(0);
});
