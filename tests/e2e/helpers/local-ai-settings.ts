import type { Page } from "@playwright/test";

// Settings reads AI configuration even when another section is selected.
// Register before a test's specific routes so those fixtures take precedence.
export async function stubLocalAiSettings(page: Page) {
  await page.route("**/api/ai/settings**", (route) => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    return route.fulfill({ json: { endpoint: "", hasApiKey: false, mode: "disabled", model: "", transcriptionModel: "" } });
  });
}
