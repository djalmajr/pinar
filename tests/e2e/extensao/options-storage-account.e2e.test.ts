import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { expectScrollableComboboxList } from "../helpers/ui";

const extensionDist = resolve(process.cwd(), "extension", "dist");

const contentTypes: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".woff2": "font/woff2",
};

async function installOptionsHarness(page: Page) {
  let legalVersion = "2026-08-18";
  await page.addInitScript(() => {
    const SETTINGS_KEY = "pinar-e2e-extension-settings";
    const IDENTITY_KEY = "pinar-e2e-extension-identity";
    const MESSAGES_KEY = "pinar-e2e-extension-messages";
    const LOCAL_STORAGE_KEY = "pinar-e2e-extension-local";
    let extensionCodeIndex = 0;
    const settings = () => JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const identity = () => localStorage.getItem(IDENTITY_KEY) || "account";
    const localValues = () => JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "{}");
    const remember = (message: unknown) => {
      const messages = JSON.parse(localStorage.getItem(MESSAGES_KEY) || "[]");
      messages.push(message);
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
    };
    const authSession = () => identity() === "account"
      ? { email: "contato@pinar.dev", kind: "account", plan: "pro", userId: "user-pro" }
      : { installationId: "installation-free", kind: "installation", plan: "free" };
    const destination = () => {
      const mode = settings().storageMode === "cloud" ? "cloud" : "local";
      const owner = identity();
      const projectId = `${owner}-${mode}-project`;
      const collectionId = `${owner}-${mode}-inbox`;
      const now = "2026-08-18T00:00:00.000Z";
      const scaleCollections = Array.from({ length: 48 }, (_, index) => ({
        createdAt: now,
        id: `${owner}-${mode}-scale-collection-${index}`,
        isProtected: false,
        name: `Scale collection ${String(index).padStart(2, "0")} — ${index % 2 ? "International customer experience" : "UX"}`,
        ownerId: owner,
        parentId: index % 6 === 0 ? null : `${owner}-${mode}-scale-collection-${index - 1}`,
        position: index + 1,
        projectId,
        sessions: [],
        updatedAt: now,
      }));
      const scaleProjects = Array.from({ length: 36 }, (_, index) => {
        const scaleProjectId = `${owner}-${mode}-scale-project-${index}`;
        return {
          collections: [{
            createdAt: now,
            id: `${scaleProjectId}-inbox`,
            isProtected: true,
            name: "Inbox",
            ownerId: owner,
            parentId: null,
            position: 0,
            projectId: scaleProjectId,
            sessions: [],
            updatedAt: now,
          }],
          createdAt: now,
          icon: "folder",
          id: scaleProjectId,
          isProtected: false,
          name: `Scale workspace ${String(index).padStart(2, "0")} — ${index % 2 ? "International operations" : "UX"}`,
          ownerId: owner,
          position: index + 1,
          updatedAt: now,
        };
      });
      return {
        destination: { collectionId, projectId },
        tree: {
          projects: [{
            collections: [{
              createdAt: now,
              id: collectionId,
              isProtected: true,
              name: "Inbox",
              ownerId: owner,
              parentId: null,
              position: 0,
              projectId,
              sessions: [],
              updatedAt: now,
            }, ...scaleCollections],
            createdAt: now,
            icon: "folder",
            id: projectId,
            isProtected: true,
            name: `${owner === "account" ? "Account" : "Installation"} ${mode === "cloud" ? "Cloud" : "Local"}`,
            ownerId: owner,
            position: 0,
            updatedAt: now,
          }, ...scaleProjects],
        },
      };
    };

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => localStorage.setItem("pinar-e2e-clipboard", value) },
    });
    (globalThis as any).chrome = {
      runtime: {
        getManifest: () => ({ version: "0.2.0-e2e" }),
        getPlatformInfo: async () => ({ os: "mac" }),
        id: "pinar-e2e",
        sendMessage: async (message: any) => {
          remember(message);
          if (message.type === "destination:get" || message.type === "destination:set") {
            return { ok: true, ...destination() };
          }
          if (message.type === "preferences:get") {
            return {
              handoffMode: settings().handoffMode === "full" ? "full" : "compact",
              includeScreenshot: settings().includeScreenshot !== false,
              ok: true,
            };
          }
          if (message.type === "preferences:set") {
            return {
              handoffMode: message.handoffMode === "full" ? "full" : "compact",
              includeScreenshot: message.includeScreenshot !== false,
              ok: true,
            };
          }
          if (message.type === "auth:get") {
            if (localStorage.getItem("pinar-e2e-auth-fail") === "1") {
              return { error: "Account service is unavailable.", ok: false };
            }
            return { ok: true, session: authSession() };
          }
          if (message.type === "auth:logout") {
            localStorage.setItem(IDENTITY_KEY, "installation");
            return { ok: true, session: authSession() };
          }
          if (message.type === "auth:email-code:request") {
            localStorage.setItem("pinar-e2e-email", String(message.email));
            return { ok: true };
          }
          if (message.type === "auth:email-code:verify") {
            if (message.code !== "123456") return { error: "Invalid code", ok: false };
            localStorage.setItem(IDENTITY_KEY, "account");
            return { ok: true, session: authSession() };
          }
          if (message.type === "auth:extension-code") {
            extensionCodeIndex += 1;
            return {
              code: extensionCodeIndex === 1 ? "ABCDE234" : "FGHJK567",
              expiresAt: "2026-08-18T00:05:00.000Z",
              ok: true,
            };
          }
          if (message.type === "app:open") {
            const mode = settings().storageMode === "cloud" ? "cloud" : "local";
            window.open(`/extension-open/${mode}/${identity()}`, "_blank");
            return { ok: true };
          }
          if (message.type === "auth:billing") {
            window.open("/extension-billing/customer-pro", "_blank");
            return { ok: true };
          }
          return { ok: true };
        },
      },
      storage: {
        local: {
          get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...localValues() }),
          remove: async (key: string) => {
            const current = localValues();
            delete current[key];
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(current));
          },
          set: async (values: Record<string, unknown>) => {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ ...localValues(), ...values }));
          },
        },
        sync: {
          get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...settings() }),
          set: async (values: Record<string, unknown>) => {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings(), ...values }));
          },
        },
      },
    };
  });

  await page.route("**/api/legal/current", (route) => route.fulfill({
    json: {
      acceptableUseUrl: "/legal/acceptable-use",
      privacyUrl: "/legal/privacy",
      termsUrl: "/legal/terms",
      version: legalVersion,
    },
  }));

  await page.route("**/extension-options/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const relative = decodeURIComponent(pathname.slice("/extension-options/".length)) || "options.html";
    const file = resolve(extensionDist, relative);
    if (file !== extensionDist && !file.startsWith(`${extensionDist}${sep}`)) {
      await route.abort("blockedbyclient");
      return;
    }
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: contentTypes[extname(file)] || "application/octet-stream",
      });
    } catch {
      await route.fulfill({ body: "Not found", status: 404 });
    }
  });
  await page.route(/\/extension-(?:open|billing)\//, (route) => route.fulfill({
    body: `<title>Extension action</title><main>${new URL(route.request().url()).pathname}</main>`,
    contentType: "text/html",
  }));
  await page.goto("/extension-options/options.html");
  await expect(page.getByText("Pinar Settings")).toBeVisible();
  return { setLegalVersion: (value: string) => { legalVersion = value; } };
}

async function save(page: Page) {
  const button = page.getByRole("button", { name: "Save", exact: true });
  await expect(button).toBeEnabled();
  await button.click();
}

async function expectActionPopup(page: Page, buttonName: string, pathname: string) {
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: buttonName, exact: true }).last().click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(new RegExp(`${pathname.replaceAll("/", "\\/")}$`));
  await popup.close();
}

test("storage mode and destination identity persist without mixing local and cloud", async ({ page }) => {
  await installOptionsHarness(page);

  await expect(page.getByRole("radio", { name: /Local Server/ })).toBeChecked();
  const downloadLink = page.getByRole("link", { name: "Download Pinar" });
  await expect(downloadLink).toHaveAttribute(
    "href",
    "https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg",
  );
  await expect(downloadLink).toHaveClass(/external-link/);
  const projectCombobox = page.getByRole("combobox", { name: "Project" });
  await expect(projectCombobox).toHaveValue("Account Local");
  await projectCombobox.click();
  await expectScrollableComboboxList(page);
  await projectCombobox.fill("missing workspace");
  await expect(page.getByText("No projects found.", { exact: true })).toBeVisible();
  await projectCombobox.fill("Account Local");
  await page.getByRole("option", { name: "Account Local" }).click();

  const collectionCombobox = page.getByRole("combobox", { name: "Collection" });
  await expect(collectionCombobox).toHaveValue("Inbox");
  await collectionCombobox.click();
  await expectScrollableComboboxList(page);
  await collectionCombobox.fill("Scale collection 47");
  const deepCollection = page.getByRole("option", { name: "Scale collection 47 — International customer experience" });
  await expect(deepCollection).toBeVisible();
  await expect(deepCollection.locator(":scope > span").first()).toHaveCSS("padding-inline-start", "80px");
  await collectionCombobox.fill("missing collection");
  await expect(page.getByText("No collections found.", { exact: true })).toBeVisible();
  await collectionCombobox.fill("Inbox");
  await page.getByRole("option", { name: "Inbox" }).click();

  await page.getByRole("radio", { name: /Remote Server/ }).check();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", {
    name: "I accept the current documents for Pinar's hosted service.",
  }).check();
  await save(page);
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("Account Cloud");
  await expectActionPopup(page, "Open app", "/extension-open/cloud/account");

  await page.reload();
  await expect(page.getByRole("radio", { name: /Remote Server/ })).toBeChecked();
  await expect(page.getByRole("checkbox", {
    name: "I accept the current documents for Pinar's hosted service.",
  })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("Account Cloud");

  await page.getByRole("radio", { name: /Local Server/ }).check();
  await save(page);
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("Account Local");
  await expectActionPopup(page, "Open app", "/extension-open/local/account");

  await page.reload();
  await expect(page.getByRole("radio", { name: /Local Server/ })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("Account Local");
});

test("agent copy detail persists independently from the complete saved capture", async ({ page }) => {
  await installOptionsHarness(page);
  await page.getByRole("tab", { name: "Preferences" }).click();

  const detail = page.getByRole("switch", { name: "Agent copy detail" });
  await expect(page.getByText("Agent copy detail · Compact", { exact: true })).toBeVisible();
  await expect(detail).not.toBeChecked();
  await detail.click();
  await expect(detail).toBeChecked();
  await expect(page.getByText("Agent copy detail · Full", { exact: true })).toBeVisible();
  await save(page);

  const saved = await page.evaluate(() => JSON.parse(
    localStorage.getItem("pinar-e2e-extension-settings") || "{}",
  ));
  expect(saved.handoffMode).toBe("full");
  const preferenceMessages = await page.evaluate(() => JSON.parse(
    localStorage.getItem("pinar-e2e-extension-messages") || "[]",
  ).filter((message: { type?: string }) => message.type === "preferences:set"));
  expect(preferenceMessages.at(-1)).toMatchObject({ handoffMode: "full" });

  await page.reload();
  await page.getByRole("tab", { name: "Preferences" }).click();
  await expect(page.getByRole("switch", { name: "Agent copy detail" })).toBeChecked();
});

test("email sign-in stays on the Account tab when the session service is down", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pinar-e2e-auth-fail", "1");
  });
  await installOptionsHarness(page);
  await page.getByRole("tab", { name: "Account" }).click();

  await expect(page.getByText("Account service is unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText("Free", { exact: true })).toHaveCount(0);
  const emailInput = page.getByPlaceholder("you@example.com");
  const sendCodeButton = page.getByRole("button", { name: "Send code", exact: true });
  await expect(emailInput).toBeVisible();
  await expect(sendCodeButton).toBeEnabled();
  await expect
    .poll(async () => ({
      buttonHeight: (await sendCodeButton.boundingBox())?.height,
      inputHeight: (await emailInput.boundingBox())?.height,
    }))
    .toEqual({ buttonHeight: 32, inputHeight: 32 });
  await expect(page.getByRole("link", { name: "Upgrade to Pro", exact: true })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Upgrade to Pro", exact: true })).toHaveAttribute(
    "href",
    /https:\/\/pinar\.dev\/pricing/,
  );
  await expect(page.getByRole("button", { name: "Generate code", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open app", exact: true })).toHaveCount(1);
});

test("Free installation separates temporary-code guidance from the paid upgrade", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pinar-e2e-extension-identity", "installation");
  });
  await installOptionsHarness(page);
  await page.getByRole("tab", { name: "Account" }).click();

  const freeSection = page.getByRole("region", { name: "Continue with a Free installation" });
  const paidSection = page.getByRole("region", { name: "Paid account" });
  const codeEntryLink = freeSection.getByRole("link", { name: "Open page to enter code" });
  const upgradeLink = paidSection.getByRole("link", { name: "Upgrade to Pro", exact: true });
  const generateCodeButton = freeSection.getByRole("button", { name: "Generate code", exact: true });
  const sendCodeButton = paidSection.getByRole("button", { name: "Send code", exact: true });

  await expect(freeSection).toBeVisible();
  await expect(paidSection).toBeVisible();
  await expect(freeSection.getByRole("link", { name: "Upgrade to Pro", exact: true })).toHaveCount(0);
  await expect(upgradeLink).toHaveCount(1);
  await expect(freeSection.getByText(
    "Only the latest code can be used. Generating another code invalidates the current one.",
    { exact: true },
  )).toBeVisible();
  await expect(codeEntryLink).toHaveClass(/external-link/);
  await expect(generateCodeButton).toHaveClass(/border-border/);
  await expect(generateCodeButton).toHaveClass(/bg-background/);
  await expect(sendCodeButton).toHaveClass(/border-border/);
  await expect(sendCodeButton).toHaveClass(/bg-background/);

  const signInUrl = new URL(await codeEntryLink.getAttribute("href") || "about:blank");
  expect(signInUrl.origin).toBe("https://pinar.dev");
  expect(signInUrl.pathname).toBe("/sign-in");
  expect(signInUrl.searchParams.get("extensionCode")).toBe("");
  expect(signInUrl.searchParams.get("returnTo")).toBe("/app");

  await expect(freeSection.getByText(
    "Open “Sign in”, keep the “Extension” tab selected, and paste the code.",
    { exact: true },
  )).toHaveCount(0);

  await expect
    .poll(async () => ({
      sendHeight: (await sendCodeButton.boundingBox())?.height,
      upgradeHeight: (await upgradeLink.boundingBox())?.height,
    }))
    .toEqual({ sendHeight: 32, upgradeHeight: 32 });

  const freeBackground = await freeSection.evaluate((element) => getComputedStyle(element).backgroundColor);
  const paidBackground = await paidSection.evaluate((element) => getComputedStyle(element).backgroundColor);
  const guidanceBackground = await codeEntryLink.locator("..").evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const upgradeBackground = await paidSection.getByRole("group", { name: "Don't have a subscription yet?" })
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(freeBackground).toBe(paidBackground);
  expect(guidanceBackground).toBe(upgradeBackground);

  await generateCodeButton.click();
  await expect(freeSection.getByText("ABCDE234", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("pinar-e2e-clipboard"))).toBeNull();
  await freeSection.getByRole("button", { name: "Copy code", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("pinar-e2e-clipboard"))).toBe("ABCDE234");
  await expect(freeSection.getByRole("button", { name: "Copied!", exact: true })).toBeVisible();

  await freeSection.getByRole("button", { name: "Generate another", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation.getByRole("heading", { name: "Generate another code?", exact: true })).toBeVisible();
  await expect(confirmation.getByText(
    "The code ABCDE234 will stop working. The new code will be valid for five minutes.",
    { exact: true },
  )).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(freeSection.getByText("ABCDE234", { exact: true })).toBeVisible();

  await freeSection.getByRole("button", { name: "Generate another", exact: true }).click();
  await confirmation.getByRole("button", { name: "Invalidate and generate", exact: true }).click();
  await expect(freeSection.getByText("FGHJK567", { exact: true })).toBeVisible();
  await expect(freeSection.getByText("ABCDE234", { exact: true })).toHaveCount(0);
  await freeSection.getByRole("button", { name: "Copy code", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("pinar-e2e-clipboard"))).toBe("FGHJK567");
  const extensionCodeMessages = await page.evaluate(() => JSON.parse(
    localStorage.getItem("pinar-e2e-extension-messages") || "[]",
  ).filter((message: { type?: string }) => message.type === "auth:extension-code"));
  expect(extensionCodeMessages).toHaveLength(2);
});

test("temporary-code actions are localized in every supported language", async ({ page }) => {
  const cases = [
    { code: "en", confirm: "Generate another code?", generate: "Generate code", generateAnother: "Generate another" },
    { code: "pt", confirm: "Gerar outro código?", generate: "Gerar código", generateAnother: "Gerar outro" },
    { code: "es", confirm: "¿Generar otro código?", generate: "Generar código", generateAnother: "Generar otro" },
    { code: "fr", confirm: "Générer un autre code ?", generate: "Générer un code", generateAnother: "Générer un autre" },
    { code: "de", confirm: "Einen weiteren Code erzeugen?", generate: "Code erzeugen", generateAnother: "Weiteren erzeugen" },
    { code: "zh", confirm: "生成另一个代码？", generate: "生成代码", generateAnother: "生成另一个" },
    { code: "ja", confirm: "別のコードを生成しますか？", generate: "コードを生成", generateAnother: "別のコードを生成" },
  ];
  await page.addInitScript(() => {
    localStorage.setItem("pinar-e2e-extension-identity", "installation");
  });
  await installOptionsHarness(page);

  for (const item of cases) {
    await page.evaluate((language) => {
      const key = "pinar-e2e-extension-settings";
      const current = JSON.parse(localStorage.getItem(key) || "{}");
      localStorage.setItem(key, JSON.stringify({ ...current, language }));
    }, item.code);
    await page.reload();
    await page.getByRole("tab").nth(2).click();
    await page.getByRole("button", { name: item.generate, exact: true }).click();
    await page.getByRole("button", { name: item.generateAnother, exact: true }).click();
    await expect(page.getByRole("alertdialog").getByRole("heading", { name: item.confirm, exact: true })).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button").first().click();
  }
});

test("Pro account opens app and billing, signs out, and returns by email without duplicating its tree", async ({ page }) => {
  await installOptionsHarness(page);
  await page.getByRole("tab", { name: "Account" }).click();

  await expect(page.getByText("contato@pinar.dev", { exact: true })).toBeVisible();
  await expect(page.getByText("pro", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="badge"]').getByText("pro", { exact: true })).toHaveCount(0);
  await expectActionPopup(page, "Open app", "/extension-open/local/account");
  await expectActionPopup(page, "Manage Billing", "/extension-billing/customer-pro");
  await expect(page.getByText("contato@pinar.dev", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator('[data-slot="badge"]').getByText("Free", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Upgrade to Pro", exact: true })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Upgrade to Pro", exact: true })).toHaveAttribute(
    "href",
    /https:\/\/pinar\.dev\/pricing/,
  );
  await expect(page.getByRole("button", { name: "Generate code", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Storage" }).click();
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("Installation Local");
  await expectActionPopup(page, "Open app", "/extension-open/local/installation");

  await page.getByRole("tab", { name: "Account" }).click();
  await page.getByPlaceholder("you@example.com").fill("contato@pinar.dev");
  await page.getByRole("button", { name: "Send code" }).click();
  const emailCodeInput = page.getByPlaceholder("000000");
  const verifyButton = page.getByRole("button", { name: "Verify" });
  await expect
    .poll(async () => ({
      buttonHeight: (await verifyButton.boundingBox())?.height,
      inputHeight: (await emailCodeInput.boundingBox())?.height,
    }))
    .toEqual({ buttonHeight: 32, inputHeight: 32 });
  await emailCodeInput.fill("123456");
  await verifyButton.click();
  await expect(page.getByText("contato@pinar.dev", { exact: true })).toBeVisible();
  await expect(page.getByText("pro", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="badge"]').getByText("pro", { exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Storage" }).click();
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("Account Local");
});

test("remote Free requires current legal consent while local mode remains independent", async ({ page }) => {
  const legal = await installOptionsHarness(page);

  await page.getByRole("radio", { name: /Remote Server/ }).check();
  const acceptance = page.getByRole("checkbox", {
    name: "I accept the current documents for Pinar's hosted service.",
  });
  await expect(acceptance).not.toBeChecked();
  await expect(page.getByText("v2026-08-18", { exact: true })).toBeVisible();
  const termsLink = page.getByRole("link", { name: "Terms", exact: true });
  const privacyLink = page.getByRole("link", { name: "Privacy", exact: true });
  const acceptableUseLink = page.getByRole("link", { name: "Acceptable Use", exact: true });
  await expect(termsLink).toHaveAttribute("href", "https://pinar.dev/legal/terms");
  await expect(privacyLink).toHaveAttribute("href", "https://pinar.dev/legal/privacy");
  await expect(acceptableUseLink).toHaveAttribute("href", "https://pinar.dev/legal/acceptable-use");
  await expect(termsLink).toHaveClass(/external-link/);
  await expect(privacyLink).toHaveClass(/external-link/);
  await expect(acceptableUseLink).toHaveClass(/external-link/);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await acceptance.check();
  await save(page);
  const storedVersion = await page.evaluate(() => {
    const values = JSON.parse(localStorage.getItem("pinar-e2e-extension-local") || "{}");
    return values.remoteLegalAcceptance?.termsVersion;
  });
  expect(storedVersion).toBe("2026-08-18");

  await page.reload();
  await expect(page.getByRole("radio", { name: /Remote Server/ })).toBeChecked();
  await expect(acceptance).toBeChecked();

  legal.setLegalVersion("2026-08-19");
  await page.reload();
  await expect(page.getByText("v2026-08-19", { exact: true })).toBeVisible();
  await expect(acceptance).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await page.getByRole("radio", { name: /Local Server/ }).check();
  await save(page);
  await expect(page.getByRole("radio", { name: /Local Server/ })).toBeChecked();
});
