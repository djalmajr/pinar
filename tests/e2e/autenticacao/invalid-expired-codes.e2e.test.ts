import { expect, type Page, test } from "@playwright/test";

const createdAt = "2026-08-18T00:00:00.000Z";

// The dev server compiles modules on demand, so the SSR HTML can render
// before React attaches its event handlers (a native submit would then reload
// the page). Wait until the email input is hydrated before driving the form.
async function gotoSignInHydrated(page: Page) {
  await page.goto("/sign-in");
  await page.waitForFunction(() => {
    const input = document.querySelector('input[placeholder="you@example.com"]');
    return input !== null && Object.keys(input).some((key) => key.startsWith("__reactProps"));
  }, null, { timeout: 20_000 });
}

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

// Mutation captured: separating the icon from the title, restoring the
// previous accent color or making it larger than the title breaks this contract.
// The web sign-in is email-only since the extension-code tab was retired;
// the account heading is the only one left to keep this alignment contract.
test("the account sign-in heading keeps its compact icon aligned with the title", async ({ page }) => {
  await page.goto("/sign-in");

  const row = page.getByTestId("account-sign-in-heading");
  const icon = row.locator("svg");
  const title = row.getByRole("heading", { name: "Sign in to your account" });
  await expect(row).toBeVisible();
  await expect(icon).toBeVisible();
  await expect(title).toBeVisible();

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
  expect(metrics.iconHeight).toBe(metrics.titleFontSize);
});

// The web extension-code sign-in was retired with the email-first accounts:
// the cloud runtime answers 410 on the old endpoints, and the sign-in page
// no longer offers tabs or the 8-character code field.
test("the retired extension-code endpoints answer 410 and the sign-in page is email-only", async ({ page, request }) => {
  const exchange = await request.post("/api/auth/extension-codes/exchange", { data: { code: "ABCD1234" } });
  expect(exchange.status()).toBe(410);
  expect(await exchange.json()).toEqual({ error: "Sign in with an email code" });

  const create = await request.post("/api/auth/extension-codes", { data: {} });
  expect(create.status()).toBe(410);
  expect(await create.json()).toEqual({ error: "Sign in with an email code" });

  await page.goto("/sign-in");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByPlaceholder("8-character code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open app" })).toHaveCount(0);
  await expect(page.getByTestId("account-sign-in-heading")).toBeVisible();
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

  await gotoSignInHydrated(page);

  const email = page.getByPlaceholder("you@example.com");
  await email.fill("unknown@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("If this email address can receive a code, it is on its way.")).toBeVisible();
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
  // A rate-limited request keeps the generic failure message (never the raw
  // server error) and the form stays on the request step.
  await expect(page.getByRole("alert")).toHaveText("Unable to request a code.");

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
  // The mocked verify sets no session cookie, so the real SSR guard bounces
  // /app back to sign-in; what this proves is that the page follows the
  // `redirectTo` of an accepted code with a navigation to /app.
  const followedRedirect = page.waitForRequest((request) => request.isNavigationRequest()
    && new URL(request.url()).pathname === "/app");
  await page.getByRole("button", { name: "Verify and enter" }).click();
  await followedRedirect;
});

test("first remote account activation accepts the current policies with OTP verification", async ({ page }) => {
  const verifyBodies: Record<string, unknown>[] = [];
  await page.route("**/api/auth/email-codes", (route) => route.fulfill({ json: { ok: true }, status: 202 }));
  await page.route("**/api/auth/email-codes/verify", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    verifyBodies.push(body);
    await route.fulfill({ json: { redirectTo: "/pricing?activated=1" } });
  });

  await gotoSignInHydrated(page);
  await page.getByPlaceholder("you@example.com").fill("founder@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("By continuing, you accept the")).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms of Service", exact: true }))
    .toHaveAttribute("href", "/legal/terms");
  // The sign-in notice no longer prints the version line.
  await expect(page.getByText(/^Version \d{4}-\d{2}-\d{2}\.$/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept and enter" })).toHaveCount(0);
  await page.getByPlaceholder("000000").fill("654321");
  await page.getByRole("button", { name: "Verify and enter" }).click();
  await expect(page).toHaveURL(/\/pricing\?activated=1$/);

  expect(verifyBodies).toHaveLength(1);
  expect(verifyBodies[0].legalAcceptance).toEqual({
    acceptableUseVersion: "2026-10-17",
    accepted: true,
    locale: "en",
    privacyVersion: "2026-10-17",
    termsVersion: "2026-10-17",
  });
});

test("email delivery failures keep the request step and never show the raw server error", async ({ page }) => {
  const requested: string[] = [];
  await page.route("**/api/auth/email-codes", async (route) => {
    const { email } = route.request().postDataJSON() as { email: string };
    requested.push(email);
    if (email === "unconfigured@example.com") {
      await route.fulfill({
        json: {
          code: "email_not_configured",
          error: "Sign-in by email is not available right now.",
        },
        status: 503,
      });
      return;
    }
    await route.fulfill({
      json: {
        code: "email_delivery_failed",
        error: "We could not send the sign-in code. Try again in a few minutes.",
      },
      status: 503,
    });
  });

  await gotoSignInHydrated(page);

  const email = page.getByPlaceholder("you@example.com");
  const sendCode = page.getByRole("button", { name: "Send code" });
  const codeField = page.getByPlaceholder("000000");
  const requestStep = page.getByText(
    "Enter your email to create a Free account or sign in. We will send you a six-digit code.",
  );

  await email.fill("delivery-failed@example.com");
  await sendCode.click();
  await expect(page.getByRole("alert")).toHaveText(
    "We couldn’t send the code right now. Try again in a few minutes.",
  );
  await expect(
    page.getByText("We could not send the sign-in code. Try again in a few minutes."),
  ).toHaveCount(0);
  await expect(codeField).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Verify and enter" })).toHaveCount(0);
  await expect(requestStep).toBeVisible();

  await email.fill("unconfigured@example.com");
  await sendCode.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Sign-in by email isn’t available right now.",
  );
  await expect(
    page.getByText("Sign-in by email is not available right now."),
  ).toHaveCount(0);
  await expect(codeField).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Verify and enter" })).toHaveCount(0);
  await expect(requestStep).toBeVisible();

  expect(requested).toEqual(["delivery-failed@example.com", "unconfigured@example.com"]);
});
