import { expect, test } from "@playwright/test";

const createdAt = "2026-08-18T00:00:00.000Z";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: "ins_auth_codes", kind: "installation", plan: "free" } },
  }));
  await page.route("**/api/project-tree", (route) => route.fulfill({
    json: {
      tree: {
        projects: [{
          collections: [{
            createdAt,
            id: "col_auth_inbox",
            isProtected: true,
            name: "Inbox",
            ownerId: "ins_auth_codes",
            parentId: null,
            position: 0,
            projectId: "prj_auth_personal",
            sessions: [],
            updatedAt: createdAt,
          }],
          createdAt,
          icon: "user-round",
          id: "prj_auth_personal",
          isProtected: true,
          name: "Personal",
          ownerId: "ins_auth_codes",
          position: 0,
          updatedAt: createdAt,
        }],
      },
    },
  }));
});

// Mutation captured: separating the icon from the title or restoring the
// previous 24px primary icon changes both the measured row and color contract.
test("Extension and Account headings keep their compact icons aligned with the title", async ({ page }) => {
  await page.goto("/sign-in");

  for (const heading of [
    { tab: "Extension", testId: "extension-sign-in-heading", title: "Continue with the extension" },
    { tab: "Account", testId: "account-sign-in-heading", title: "Sign in to your account" },
  ]) {
    await page.getByRole("tab", { name: heading.tab }).click();
    const row = page.getByTestId(heading.testId);
    const icon = row.locator("svg");
    const title = row.getByRole("heading", { name: heading.title });
    await expect(row).toBeVisible();
    await expect(icon).toBeVisible();

    const metrics = await row.evaluate((element) => {
      const iconElement = element.querySelector("svg");
      const titleElement = element.querySelector("h3");
      if (!iconElement || !titleElement) throw new Error("Heading icon or title is missing");
      const iconBox = iconElement.getBoundingClientRect();
      const titleBox = titleElement.getBoundingClientRect();
      return {
        colorMatches: getComputedStyle(iconElement).color === getComputedStyle(titleElement).color,
        iconHeight: iconBox.height,
        sameLine: Math.abs((iconBox.top + iconBox.bottom) / 2 - (titleBox.top + titleBox.bottom) / 2) < 1,
        titleFontSize: Number.parseFloat(getComputedStyle(titleElement).fontSize),
      };
    });

    expect(metrics.colorMatches).toBe(true);
    expect(metrics.sameLine).toBe(true);
    expect(metrics.iconHeight).toBeGreaterThan(metrics.titleFontSize);
    expect(metrics.iconHeight).toBeLessThanOrEqual(metrics.titleFontSize + 2);
  }
});

test("extension code rejects malformed, unknown, expired and reused values while allowing recovery", async ({ page }) => {
  const uses = new Map<string, number>();
  await page.route("**/api/auth/extension-codes/exchange", async (route) => {
    const { code } = route.request().postDataJSON() as { code: string };
    uses.set(code, (uses.get(code) || 0) + 1);
    if (code === "ABCD1234" && uses.get(code) === 1) {
      await route.fulfill({ json: { redirectTo: "/app" } });
      return;
    }
    if (code === "NEXT1234") {
      await route.fulfill({ json: { redirectTo: "/app" } });
      return;
    }
    await route.fulfill({ json: { error: "Invalid or expired code" }, status: 400 });
  });

  await page.goto("/sign-in");
  await expect(page.getByRole("tab", { name: "Extension", selected: true })).toBeVisible();
  const extensionCode = page.getByPlaceholder("8-character code");
  const openApp = page.getByRole("button", { name: "Open app" });

  await extensionCode.fill("ABC");
  await expect(openApp).toBeDisabled();
  await extensionCode.fill("NONE1234");
  await openApp.click();
  await expect(page.getByRole("alert")).toHaveText("Invalid or expired code");

  await page.getByRole("tab", { name: "Account" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("tab", { name: "Extension" }).click();

  await extensionCode.fill("EXPR1234");
  await openApp.click();
  await expect(page.getByRole("alert")).toHaveText("Invalid or expired code");

  await extensionCode.fill("ABCD1234");
  await openApp.click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/sign-in");
  await page.getByPlaceholder("8-character code").fill("ABCD1234");
  await page.getByRole("button", { name: "Open app" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid or expired code");

  await page.getByPlaceholder("8-character code").fill("NEXT1234");
  await page.getByRole("button", { name: "Open app" }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test("email OTP keeps responses non-enumerating, limits retries and resets recovery state", async ({ page }) => {
  let challenge = 0;
  let verifyAttempts = 0;
  await page.route("**/api/auth/email-codes", async (route) => {
    const { email } = route.request().postDataJSON() as { email: string };
    if (email === "rate-limited@example.com") {
      await route.fulfill({ json: { error: "Too many requests" }, status: 429 });
      return;
    }
    challenge += 1;
    verifyAttempts = 0;
    await route.fulfill({ json: { ok: true }, status: 202 });
  });
  await page.route("**/api/auth/email-codes/verify", async (route) => {
    const { code } = route.request().postDataJSON() as { code: string };
    verifyAttempts += 1;
    if (challenge >= 4 && code === "654321") {
      await route.fulfill({ json: { redirectTo: "/app" } });
      return;
    }
    await route.fulfill({ json: { error: "The code is invalid or expired." }, status: 400 });
  });

  await page.goto("/sign-in");
  await page.getByRole("tab", { name: "Account" }).click();

  const email = page.getByPlaceholder("you@example.com");
  await email.fill("unknown@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("If this email belongs to an eligible account, a code is on its way.")).toBeVisible();
  await page.getByRole("button", { name: "Use another email" }).click();

  await email.fill("paid@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  const otp = page.getByPlaceholder("000000");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await otp.fill(String(100000 + attempt));
    await page.getByRole("button", { name: "Verify and enter" }).click();
    await expect(page.getByRole("alert")).toHaveText("The code is invalid or expired.");
  }
  await otp.fill("999999");
  await page.getByRole("button", { name: "Verify and enter" }).click();
  await expect(page.getByRole("alert")).toHaveText("The code is invalid or expired.");

  await page.getByRole("button", { name: "Use another email" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await email.fill("rate-limited@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("alert")).toHaveText("Too many requests");

  await email.fill("expired@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByPlaceholder("000000").fill("111111");
  await page.getByRole("button", { name: "Verify and enter" }).click();
  await expect(page.getByRole("alert")).toHaveText("The code is invalid or expired.");

  await page.getByRole("button", { name: "Use another email" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await email.fill("paid@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByPlaceholder("000000").fill("654321");
  await page.getByRole("button", { name: "Verify and enter" }).click();
  await expect(page).toHaveURL(/\/app$/);
});
