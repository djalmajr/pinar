import { expect, test, type Page } from "@playwright/test";
import { signInCloudFreeAccount, signInCloudPro } from "../helpers/cloud-signin";

const session = {
  createdAt: "2026-08-18T01:30:00.000Z",
  id: "ai-viewer-e2e",
  page: { title: "AI review fixture", url: "https://example.test/checkout" },
  pins: [
    {
      comment: "Clarify the annual price.",
      coords: { x: 24, y: 48 },
      number: 1,
      pinId: "pin_ai_fixture_1",
      snapshot: {
        fonts: [],
        icons: [],
        nodeCount: 1,
        root: { styles: { display: "inline-flex" }, tag: "button", text: "Buy" },
        truncated: false,
        version: 1,
      },
      type: "point",
    },
    { comment: "Move the primary action above the fold.", coords: { x: 80, y: 120 }, number: 2, type: "point" },
  ],
  shotId: "ai-viewer-e2e",
  shotUrl: "/shots/ai-viewer-e2e.svg",
};

// The viewer's AI summary, pin diagnosis and component export were retired
// (the cloud API answers 404 for them: "does not expose retired AI generation
// endpoints" in cloud-api.test.ts). This file keeps the contract that matters
// to every audience: no plan, signed-in or not, is offered the retired
// affordances, and the endpoints stay gone.
//
// The page's auth state comes from the SSR-resolved session (a real cookie):
// the client never revalidates /api/auth/session once the SSR resolved it,
// so the fixtures sign in through the shared cloud helper instead of
// mocking the endpoint.
async function mockViewerFixtures(page: Page) {
  await page.route("**/api/sessions/ai-viewer-e2e", (route) => route.fulfill({ json: { session } }));
  await page.route("**/shots/ai-viewer-e2e.svg", (route) => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><text x="20" y="40">AI fixture</text></svg>',
    contentType: "image/svg+xml",
  }));
}

// Positive control: the viewer rendered the capture (its first pin opens the
// pin dialog with the comment), so an absent affordance is not a blank page.
async function openFirstPin(page: Page) {
  await page.goto("/v/ai-viewer-e2e");
  await page.getByTitle("Open pin 1").click();
  const dialog = page.getByRole("dialog", { name: "Pin 1" });
  await expect(dialog.getByText("Clarify the annual price.")).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await signInCloudPro(page);
  await mockViewerFixtures(page);
});

test("a Pro pin dialog no longer offers diagnosis or component export", async ({ page }) => {
  const dialog = await openFirstPin(page);
  await expect(dialog.getByRole("button", { name: "Diagnose" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Save as component" })).toHaveCount(0);
});

test("the Pro viewer offers no AI summary", async ({ page }) => {
  await openFirstPin(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "AI summary" })).toHaveCount(0);
});

test("the retired AI generation endpoints answer 404 to a signed-in Pro account", async ({ page }) => {
  for (const path of ["/api/ai/session-summary", "/api/ai/pin-diagnosis", "/api/ai/component-export", "/api/ai/design-system"]) {
    const response = await page.request.post(path, { data: { sessionId: "ai-viewer-e2e" } });
    expect(response.status(), `POST ${path}`).toBe(404);
  }
  const designSystem = await page.request.get("/api/collections/retired_collection/design-system");
  expect(designSystem.status()).toBe(404);
});

test("anonymous and Free visitors do not see AI summary", async ({ browser, page }) => {
  // Anonymous: a fresh context without any session cookie; the SSR resolves
  // the signed-out state.
  const anonymous = await browser.newContext();
  try {
    const anonPage = await anonymous.newPage();
    await mockViewerFixtures(anonPage);
    await anonPage.goto("/v/ai-viewer-e2e");
    await expect(anonPage.getByTitle("Open pin 1")).toBeVisible();
    await expect(anonPage.getByRole("button", { name: "AI summary" })).toHaveCount(0);
  } finally {
    await anonymous.close();
  }

  // Free account: a real cookie from the fresh free-account sign-in (the
  // previous Pro cookie is replaced by the verify response).
  await signInCloudFreeAccount(page);
  await page.goto("/v/ai-viewer-e2e");
  await expect(page.getByTitle("Open pin 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "AI summary" })).toHaveCount(0);
});
