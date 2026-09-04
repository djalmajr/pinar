import { expect, test } from "@playwright/test";

const session = {
  createdAt: "2026-08-18T01:30:00.000Z",
  id: "ai-viewer-e2e",
  page: { title: "AI review fixture", url: "https://example.test/checkout" },
  pins: [
    { comment: "Clarify the annual price.", coords: { x: 24, y: 48 }, number: 1, type: "point" },
    { comment: "Move the primary action above the fold.", coords: { x: 80, y: 120 }, number: 2, type: "point" },
  ],
  shotId: "ai-viewer-e2e",
  shotUrl: "/shots/ai-viewer-e2e.svg",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      session: {
        email: "pro@example.test",
        kind: "account",
        plan: "pro",
        userId: "usr_ai_e2e",
      },
    },
  }));
  await page.route("**/api/sessions/ai-viewer-e2e", (route) => route.fulfill({ json: { session } }));
  await page.route("**/shots/ai-viewer-e2e.svg", (route) => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><text x="20" y="40">AI fixture</text></svg>',
    contentType: "image/svg+xml",
  }));
});

test("a successful summary reflects comments, charges once and reopens from memory", async ({ page }) => {
  const bodies: Array<{ requestId: string; sessionId: string }> = [];
  await page.route("**/api/ai/session-summary", async (route) => {
    bodies.push(route.request().postDataJSON() as { requestId: string; sessionId: string });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      json: {
        aiCredits: { balance: 199 },
        result: {
          highlights: ["Clarify annual pricing", "Prioritize the main action"],
          summary: "The review asks for clearer pricing and a more prominent primary action.",
        },
      },
    });
  });

  await page.goto("/v/ai-viewer-e2e");
  await page.getByRole("button", { name: "AI summary" }).click();
  const dialog = page.getByRole("dialog", { name: "Annotation summary" });
  await expect(dialog.getByText("Summarizing…", { exact: true })).toBeVisible();
  await expect(dialog.getByText("The review asks for clearer pricing and a more prominent primary action.")).toBeVisible();
  await expect(dialog.getByText("Clarify annual pricing", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Prioritize the main action", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1 AI credit used · 199 remaining", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].sessionId).toBe("ai-viewer-e2e");
  expect(bodies[0].requestId).toMatch(/^ai_[a-z0-9]+$/);

  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "AI summary" }).click();
  await expect(dialog.getByText("The review asks for clearer pricing and a more prominent primary action.")).toBeVisible();
  expect(bodies).toHaveLength(1);
});

test("anonymous and Free visitors do not see AI summary", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { session: null } }));
  await page.goto("/v/ai-viewer-e2e");
  await expect(page.getByRole("button", { name: "AI summary" })).toHaveCount(0);

  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: {
      session: {
        installationId: "ins_ai_free",
        kind: "installation",
        plan: "free",
      },
    },
  }));
  await page.goto("/v/ai-viewer-e2e");
  await expect(page.getByRole("button", { name: "AI summary" })).toHaveCount(0);
});

test("creditless paid accounts get a plans recovery path", async ({ page }) => {
  await page.route("**/api/ai/session-summary", async (route) => {
    await route.fulfill({ json: { code: "insufficient_ai_credits", error: "Insufficient credits" }, status: 402 });
  });

  await page.goto("/v/ai-viewer-e2e");
  await page.getByRole("button", { name: "AI summary" }).click();
  const dialog = page.getByRole("dialog", { name: "Annotation summary" });
  await expect(dialog.getByText("You do not have enough AI credits.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "View plans" })).toHaveAttribute("href", "/pricing");
  await expect(dialog.getByRole("heading", { name: "Highlights" })).toHaveCount(0);
});

test("provider failure and pending refund retry safely without duplicate request ids", async ({ page }) => {
  const requestIds: string[] = [];
  let attempt = 0;
  await page.route("**/api/ai/session-summary", async (route) => {
    requestIds.push((route.request().postDataJSON() as { requestId: string }).requestId);
    attempt += 1;
    if (attempt === 1) {
      await route.fulfill({ json: { code: "ai_provider_error" }, status: 502 });
      return;
    }
    if (attempt === 2) {
      await route.fulfill({ json: { code: "ai_refund_pending" }, status: 503 });
      return;
    }
    await route.fulfill({
      json: {
        aiCredits: { balance: 4 },
        result: { highlights: [], summary: "Recovered summary" },
      },
    });
  });

  await page.goto("/v/ai-viewer-e2e");
  await page.getByRole("button", { name: "AI summary" }).click();
  const dialog = page.getByRole("dialog", { name: "Annotation summary" });
  await expect(dialog.getByText("The AI summary is unavailable. No credit was charged.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByText("The AI request failed and the credit refund is still processing. Retry safely in a few minutes.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByText("Recovered summary", { exact: true })).toBeVisible();

  expect(requestIds).toHaveLength(3);
  expect(requestIds[0]).not.toBe(requestIds[1]);
  expect(requestIds[1]).toBe(requestIds[2]);
});

test("in-flight and rate-limited requests stay single-flight and recover with a new id", async ({ page }) => {
  const requestIds: string[] = [];
  let attempt = 0;
  await page.route("**/api/ai/session-summary", async (route) => {
    requestIds.push((route.request().postDataJSON() as { requestId: string }).requestId);
    attempt += 1;
    if (attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ json: { code: "ai_rate_limited" }, status: 429 });
      return;
    }
    await route.fulfill({
      json: {
        aiCredits: { balance: 8 },
        result: { highlights: ["Recovered"], summary: "Accepted after the rate-limit window" },
      },
    });
  });

  await page.goto("/v/ai-viewer-e2e");
  const trigger = page.getByRole("button", { name: "AI summary" });
  const click = trigger.click();
  const dialog = page.getByRole("dialog", { name: "Annotation summary" });
  await expect(dialog.getByText("Summarizing…", { exact: true })).toBeVisible();
  await page.waitForTimeout(80);
  expect(requestIds).toHaveLength(1);
  await click;

  await expect(dialog.getByText("Too many requests. Wait a minute and try again.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByText("Accepted after the rate-limit window", { exact: true })).toBeVisible();
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).not.toBe(requestIds[1]);
});
