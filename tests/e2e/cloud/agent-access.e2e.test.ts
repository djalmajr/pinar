import { expect, type Page, test } from "@playwright/test";

// The once-shown secret lives in this file's DOM: never retain failure
// artifacts (trace/screenshot/video) for it. Global config stays untouched.
test.use({ screenshot: "off", trace: "off", video: "off" });

async function openAgentAccess(page: Page) {
  await page.locator('[data-sidebar="footer"]')
    .getByRole("button", { exact: true, name: "Account menu" })
    .click();
  await page.getByRole("menuitem", { exact: true, name: "Settings" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("aside").getByRole("button", { exact: true, name: "Agent access" }).click();
  // The dialog header carries the active section as a heading; the in-section
  // eyebrow (SectionHeading) is a styled span, not a heading role.
  await expect(dialog.getByRole("heading", { exact: true, name: "Agent access" })).toBeVisible();
  return dialog;
}

// The real create-key request reaches the server, but page.route swaps the
// secret for this synthetic stand-in before the browser sees the response,
// so no failure artifact can retain a real secret. The report must never
// contain a real key.
const SYNTHETIC_SECRET = `pak_${"synthetic-once-only".padEnd(43, "0")}`;

test("Cloud Pro agent key is created read-only, shown once, then revoked", async ({ page }) => {
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

  const label = `E2E reader ${Date.now()}`;
  await page.route("**/api/agent-keys", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body: unknown = await response.json().catch(() => null);
    await route.fulfill({
      json: typeof body === "object" && body !== null ? { ...body, key: SYNTHETIC_SECRET } : { key: SYNTHETIC_SECRET },
      response,
    });
  });
  let dialog = await openAgentAccess(page);
  await dialog.getByLabel("Key name", { exact: true }).fill(label);
  await dialog.getByRole("button", { exact: true, name: "Create key" }).click();

  await expect(dialog.getByText("Copy this key now. It will not be shown again.", { exact: true })).toBeVisible();
  // The browser only ever saw the synthetic stand-in, so asserting it here
  // proves no real secret reached the DOM.
  await expect(dialog.locator("code", { hasText: "pak_synthetic-once-only" })).toHaveText(SYNTHETIC_SECRET);
  const shownOnce = await dialog.evaluate((root) => {
    const codes = Array.from(root.querySelectorAll("code")).map((element) => element.textContent ?? "");
    return codes.some((text) => text.length === 47 && text.startsWith("pak_"));
  });
  expect(shownOnce).toBe(true);

  const listed = await page.evaluate(async (expected) => {
    const response = await fetch("/api/agent-keys", { cache: "no-store" });
    const body: unknown = await response.json();
    const keys = typeof body === "object" && body !== null && Array.isArray((body as { keys?: unknown }).keys)
      ? (body as { keys: Array<{ label?: unknown; permission?: unknown; prefix?: unknown; revokedAt?: unknown }> }).keys
      : [];
    const match = keys.find((key) => key.label === expected);
    if (!match) return null;
    return {
      label: match.label,
      permission: match.permission,
      prefixLength: typeof match.prefix === "string" ? match.prefix.length : -1,
      revokedAt: match.revokedAt ?? null,
    };
  }, label);
  expect(listed).toMatchObject({ label, permission: "read", prefixLength: 12, revokedAt: null });

  await dialog.getByRole("button", { exact: true, name: "Close settings" }).click();
  await expect(dialog).toHaveCount(0);

  dialog = await openAgentAccess(page);
  await expect(dialog.getByText("Copy this key now. It will not be shown again.", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(label, { exact: true })).toBeVisible();

  const row = dialog.locator("div.rounded-lg.border.bg-card.p-3", { hasText: label });
  await row.getByRole("button", { exact: true, name: "Revoke" }).click();
  await expect(row.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { exact: true, name: "Revoke" })).toHaveCount(0);
});
