import { expect, test } from "@playwright/test";
import { openWorkspaceAccountMenu } from "../helpers/ui";

test("local Settings lives in the sidebar account menu instead of the workspace header", async ({ page }) => {
  await page.goto("/app");

  await expect(page.locator("header").getByRole("button", { exact: true, name: "Settings" })).toHaveCount(0);
  await openWorkspaceAccountMenu(page);

  await expect(page.locator('[data-sidebar="footer"]').getByRole("button", { exact: true, name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { exact: true, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { exact: true, name: "Homepage" })).toBeVisible();
  await expect(page.getByRole("menuitem", { exact: true, name: "Sign out" })).toHaveCount(0);
  await page.getByRole("menuitem", { exact: true, name: "Settings" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("General", { exact: true }).first()).toBeVisible();
  // Mutation captured: leaving the settings nav aside on p-3 keeps the extra inset the pin asked to drop.
  await expect(page.getByRole("dialog").locator("aside")).toHaveClass(/p-2/);
});

test("AI settings tests the connection and saves with the transcription model", async ({ page }) => {
  // The stub serves and receives transcriptionModel across GET, PATCH and the
  // connection test; a mutation that drops the field from the payload or the
  // stubbed GET removes the field from the form or from the request body.
  let hasApiKey = true;
  let patchShouldFail = false;
  let testShouldFail = false;
  let patchBody: Record<string, unknown> | null = null;
  let testBody: Record<string, unknown> | null = null;
  await page.route("**/api/ai/settings/key", async (route) => {
    hasApiKey = false;
    await route.fulfill({
      contentType: "application/json",
      json: {
        apiKeyPreview: "",
        endpoint: "https://provider.example/v1",
        hasApiKey: false,
        mode: "byok",
        model: "qwen3.8-27b",
        ok: true,
        transcriptionModel: "whisper-1",
      },
    });
  });
  await page.route("**/api/ai/settings/test", async (route) => {
    testBody = JSON.parse(route.request().postData() ?? "null") as Record<string, unknown> | null;
    if (testShouldFail) {
      await route.fulfill({
        contentType: "application/json",
        json: { code: "ai_auth_failed", error: "Endpoint refused the test request" },
        status: 401,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { model: "qwen3.8-27b", ok: true, provider: "byok" },
    });
  });
  await page.route("**/api/ai/settings", async (route) => {
    if (route.request().method() === "PATCH") {
      patchBody = JSON.parse(route.request().postData() ?? "null") as Record<string, unknown> | null;
      if (patchShouldFail) {
        await route.fulfill({
          contentType: "application/json",
          json: { error: "Provider rejected the API key" },
          status: 401,
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: {
          apiKeyPreview: "sk-p••••cdef",
          endpoint: "https://provider.example/v1",
          hasApiKey: true,
          mode: "byok",
          model: "qwen3.8-27b",
          ok: true,
          tested: { model: "qwen3.8-27b", ok: true, provider: "byok" },
          transcriptionModel: "whisper-large-v3",
        },
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        apiKeyPreview: hasApiKey ? "sk-p••••cdef" : "",
        endpoint: "https://provider.example/v1",
        hasApiKey,
        mode: "byok",
        model: "qwen3.8-27b",
        ok: true,
        transcriptionModel: "whisper-1",
      },
    });
  });
  await page.goto("/app");
  await openWorkspaceAccountMenu(page);
  await page.getByRole("menuitem", { exact: true, name: "Settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { exact: true, name: "AI Assistant" }).click();
  await expect(dialog.getByRole("heading", { exact: true, name: "AI Assistant" })).toBeVisible();

  const apiKey = dialog.getByLabel("API key", { exact: true });
  await expect(apiKey).toHaveAttribute("placeholder", "sk-p••••cdef");
  const provider = dialog.getByLabel("Provider", { exact: true });
  const endpoint = dialog.getByLabel("Endpoint", { exact: true });
  const model = dialog.getByLabel("Model", { exact: true });
  const transcription = dialog.getByLabel("Transcription model", { exact: true });
  await expect(transcription).toHaveValue("whisper-1");
  const removeButton = dialog.getByRole("button", { exact: true, name: "Remove API key" });
  const testButton = dialog.getByRole("button", { exact: true, name: "Test connection" });
  const saveButton = dialog.getByRole("button", { exact: true, name: "Test and save" });
  const providerBox = await provider.boundingBox();
  const endpointBox = await endpoint.boundingBox();
  const modelBox = await model.boundingBox();
  const transcriptionBox = await transcription.boundingBox();
  const removeBox = await removeButton.boundingBox();
  const keyBox = await apiKey.boundingBox();
  const saveBox = await saveButton.boundingBox();
  expect(providerBox).not.toBeNull();
  expect(endpointBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(transcriptionBox).not.toBeNull();
  expect(removeBox).not.toBeNull();
  expect(keyBox).not.toBeNull();
  expect(saveBox).not.toBeNull();
  if (!providerBox || !endpointBox || !modelBox || !transcriptionBox || !removeBox || !keyBox || !saveBox) {
    throw new Error("AI settings controls must be visible");
  }
  expect(Math.abs(providerBox.x - endpointBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(modelBox.x - endpointBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(transcriptionBox.x - endpointBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(keyBox.x - endpointBox.x)).toBeLessThanOrEqual(1);
  expect(removeBox.width).toBeLessThanOrEqual(36);
  expect(removeBox.x).toBeGreaterThanOrEqual(keyBox.x);
  expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(keyBox.x + keyBox.width);
  expect(saveBox.y - (keyBox.y + keyBox.height)).toBeLessThanOrEqual(48);

  // Test the connection: POST /api/ai/settings/test without sending a stored key.
  await testButton.click();
  await expect.poll(() => testBody).toMatchObject({
    endpoint: "https://provider.example/v1",
    mode: "byok",
    model: "qwen3.8-27b",
    transcriptionModel: "whisper-1",
  });
  expect(testBody).not.toHaveProperty("apiKey");
  await expect(page.getByText("Connection works with qwen3.8-27b.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Connection works with qwen3.8-27b.", { exact: true })).toHaveCount(0);
  await expect(testButton).toBeEnabled();

  testShouldFail = true;
  await testButton.click();
  await expect(page.getByText("Endpoint refused the test request", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Endpoint refused the test request", { exact: true })).toHaveCount(0);

  await removeButton.click();
  await expect(apiKey).toHaveAttribute("placeholder", "sk-…");
  await expect(dialog.getByRole("button", { exact: true, name: "Remove API key" })).toHaveCount(0);
  await expect(page.getByText("API key removed.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("API key removed.", { exact: true })).toHaveCount(0);

  await apiKey.fill("sk-replacement");
  await transcription.fill("whisper-large-v3");
  await saveButton.click();

  await expect(page.getByText("Connection tested and settings saved for qwen3.8-27b.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Connection tested and settings saved for qwen3.8-27b.", { exact: true })).toHaveCount(0);
  await expect.poll(() => patchBody).toMatchObject({
    apiKey: "sk-replacement",
    endpoint: "https://provider.example/v1",
    mode: "byok",
    model: "qwen3.8-27b",
    transcriptionModel: "whisper-large-v3",
  });

  patchShouldFail = true;
  await saveButton.click();
  await expect(page.getByText("Provider rejected the API key", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Provider rejected the API key", { exact: true })).toHaveCount(0);
});

test("local Settings shows the data section with the export link", async ({ page }) => {
  // Mutation captured: a Data section that renders the import row on the self-hosted
  // server loses the export link (and its href/download attributes) on local.
  await page.goto("/app");
  await openWorkspaceAccountMenu(page);
  await page.getByRole("menuitem", { exact: true, name: "Settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { exact: true, name: "Data" }).click();

  await expect(dialog.getByRole("heading", { exact: true, name: "Data" })).toBeVisible();
  await expect(dialog.getByText("Downloads a .zip with your projects, collections, captures and screenshots, ready to import into Pinar Cloud.", { exact: true })).toBeVisible();
  const exportLink = dialog.getByRole("link", { exact: true, name: "Export data" });
  await expect(exportLink).toBeVisible();
  await expect(exportLink).toHaveAttribute("href", "/api/export");
  await expect(exportLink).toHaveAttribute("download", "");
  // The cloud-only import row must not exist on the self-hosted server.
  await expect(dialog.getByRole("button", { exact: true, name: "Choose file" })).toHaveCount(0);
});

test("the close button stays aligned to the top when the settings description wraps", async ({ page }) => {
  // Mutation captured: vertically centering the header moves close below the title when the description wraps.
  await page.setViewportSize({ height: 900, width: 1_797 });
  await page.goto("/app?lang=pt");
  await openWorkspaceAccountMenu(page, "Menu da conta");
  await page.getByRole("menuitem", { exact: true, name: "Configurações" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { exact: true, name: "Sobre" }).click();

  const header = dialog.locator("header");
  const close = dialog.getByRole("button", { exact: true, name: "Fechar configurações" });
  const headerBox = await header.boundingBox();
  const closeBox = await close.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  if (!headerBox || !closeBox) throw new Error("Settings header and close button must be visible");
  expect(closeBox.y - headerBox.y).toBeLessThanOrEqual(24);
});

test("Portuguese settings names the navigation and title Assistente de IA", async ({ page }) => {
  // Mutation captured: shortening settings.ai back to IA changes both the navigation and section title.
  await page.goto("/app?lang=pt");
  await openWorkspaceAccountMenu(page, "Menu da conta");
  await page.getByRole("menuitem", { exact: true, name: "Configurações" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { exact: true, name: "Assistente de IA" }).click();

  await expect(dialog.getByRole("heading", { exact: true, name: "Assistente de IA" })).toBeVisible();
});
