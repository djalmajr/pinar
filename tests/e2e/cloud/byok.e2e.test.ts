import { expect, type Locator, type Page, test } from "@playwright/test";

// F5/S4: the BYOK endpoint subpanel of the Cloud AI settings section. Every
// /api/byok* answer is mocked with page.route, so no real key ever reaches
// the server or a failure artifact, and the real local database is never
// written.
//
// The Cloud Pro fixture email code is claimed once per local server boot, so
// the whole walkthrough happens in a single signed-in test:
// save + connection test, then remove, then the 503 unavailable state.

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

// Save zeroes the capabilities (the test that follows records the results).
const SAVED_ZEROED = {
  baseUrl: "https://provider.example.test/v1",
  capabilities: {
    chat: UNTESTED,
    embeddings: { ...UNTESTED, dims: null },
    tools: UNTESTED,
    transcription: UNTESTED,
    vision: UNTESTED,
  },
  configured: true,
  keyLast4: "abcd",
  models: { chat: "gpt-e2e", embedding: null, transcription: null },
  updatedAt: "2026-10-18T00:00:00.000Z",
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

// Signs in the Cloud Pro fixture. The email code is one-shot per server
// boot, so this runs exactly once in the file.
async function signInPro(page: Page) {
  const signIn = await page.request.post("/api/auth/email-codes/verify", {
    data: {
      code: "826826",
      email: "pro.cloud-local@pinar.test",
      returnTo: "/app",
    },
  });
  expect(signIn.ok()).toBe(true);
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

test("Cloud Pro BYOK endpoint: save + test, capability origins, masked key, remove, and 503 hides the panel", async ({ page }) => {
  const rawKey = "sk-e2e-byok-raw-key";
  const puts: Array<Record<string, unknown>> = [];
  let testCalls = 0;
  let deletes = 0;
  await page.route("**/api/byok", (route) => {
    if (route.request().method() === "PUT") {
      puts.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: SAVED_ZEROED });
    }
    if (route.request().method() === "DELETE") {
      deletes += 1;
      return route.fulfill({ json: UNCONFIGURED });
    }
    // The initial read is the unconfigured view; the save + test answers
    // below (and the 503 re-registration in the last phase) take over.
    return route.fulfill({ json: UNCONFIGURED });
  });
  await page.route("**/api/byok/test", (route) => {
    testCalls += 1;
    return route.fulfill({ json: MIXED });
  });

  await signInPro(page);

  // --- Phase 1: save the endpoint; the connection test runs right after ---
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
  await dialog.getByRole("button", { exact: true, name: "Save" }).click();

  // The save PUTs (sending the key once) and the test POSTs right after;
  // the mixed view below is the test's answer.
  const card = dialog.locator("div.rounded-lg.border.bg-card.p-3", { hasText: "Capabilities" });
  await expect(capabilityRow(card, "Chat with tools").getByText("Your endpoint", { exact: true })).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({
    apiKey: rawKey,
    baseUrl: "https://provider.example.test/v1",
    chatModel: "gpt-e2e",
    embeddingModel: "",
    transcriptionModel: "",
  });
  expect(testCalls).toBe(1);

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
  await expect(reopened.getByRole("button", { exact: true, name: "Save" })).toHaveCount(0);
  await expect(reopened.getByLabel("Endpoint", { exact: true })).toHaveCount(0);
});
