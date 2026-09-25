import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { DEVELOPMENT_EXTENSION_KEY, STAGING_CLOUD_URL } from "../../../extension/environment.js";

const extensionDist = resolve(process.cwd(), "extension", "dist");

const contentTypes: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".woff2": "font/woff2",
};

async function installOptionsHarness(page: Page, { development = false, platform = "mac" } = {}) {
  let legalVersion = "2026-08-18";
  await page.addInitScript(({ development, developmentKey, platform }) => {
    const SETTINGS_KEY = "pinar-e2e-extension-settings";
    const IDENTITY_KEY = "pinar-e2e-extension-identity";
    const MESSAGES_KEY = "pinar-e2e-extension-messages";
    const LOCAL_STORAGE_KEY = "pinar-e2e-extension-local";
    const settings = () => JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const identity = () => localStorage.getItem(IDENTITY_KEY) || "account";
    const localValues = () => JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "{}");
    const remember = (message: unknown) => {
      const messages = JSON.parse(localStorage.getItem(MESSAGES_KEY) || "[]");
      messages.push(message);
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
    };
    const authSession = () => identity() === "account" || identity() === "free-account"
      ? { email: "contato@pinar.dev", kind: "account", plan: identity() === "account" ? "pro" : "free", userId: "user-pro" }
      : null;
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
        getManifest: () => ({ key: development ? developmentKey : undefined, version: "0.2.0-e2e" }),
        getPlatformInfo: async () => ({ os: platform }),
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
            const delay = Number(localStorage.getItem("pinar-e2e-preferences-save-delay") || 0);
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
            return {
              handoffMode: message.handoffMode === "full" ? "full" : "compact",
              includeScreenshot: message.includeScreenshot !== false,
              ok: true,
            };
          }
          if (message.type === "auth:get") {
            const delay = Number(localStorage.getItem("pinar-e2e-auth-delay") || 0);
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
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
            const delay = Number(localStorage.getItem("pinar-e2e-email-request-delay") || 0);
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
            localStorage.setItem("pinar-e2e-email", String(message.email));
            return { ok: true };
          }
          if (message.type === "auth:email-code:verify") {
            const delay = Number(localStorage.getItem("pinar-e2e-email-verify-delay") || 0);
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
            if (message.code !== "123456") return { error: "Invalid code", ok: false };
            localStorage.setItem(IDENTITY_KEY, "account");
            return { ok: true, session: authSession() };
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
          get: async (keys: Record<string, unknown> | string[]) => {
            const current = localValues();
            if (Array.isArray(keys)) {
              return Object.fromEntries(keys.filter((key) => key in current).map((key) => [key, current[key]]));
            }
            return { ...keys, ...current };
          },
          remove: async (keys: string | string[]) => {
            const current = localValues();
            for (const key of Array.isArray(keys) ? keys : [keys]) delete current[key];
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
  }, { development, developmentKey: DEVELOPMENT_EXTENSION_KEY, platform });

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

test("selecting remote saves the destination and shows signed-in controls inline", async ({ page }) => {
  await installOptionsHarness(page);
  await page.getByRole("radio", { name: /Remote Server/ }).check();

  const remoteCard = page.getByRole("radio", { name: /Remote Server/ }).locator("../../..");
  await expect(remoteCard.getByText("contato@pinar.dev (PRO)")).toBeVisible();
  await expect(remoteCard.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(remoteCard.getByRole("switch", { name: "Save Annotation History" })).toBeVisible();
  await expect(remoteCard.getByRole("link", { name: "Create account" })).toHaveCount(0);
  await expect(remoteCard.getByText("Account and plan", { exact: true })).toHaveCount(0);
  await expect(remoteCard.getByText("Voice comments", { exact: true })).toHaveCount(0);
  await expect(remoteCard.getByText("Clean up transcription with AI", { exact: true })).toBeVisible();
  await expect(remoteCard.locator("[data-slot=separator]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pinar-e2e-extension-settings") || "{}").storageMode)).toBe("cloud");
  await expectActionPopup(page, "Open app", "/extension-open/cloud/account");
});

test("remote account loading explains what is happening before the session arrives", async ({ page }) => {
  await installOptionsHarness(page);
  await page.evaluate(() => localStorage.setItem("pinar-e2e-auth-delay", "1000"));
  await page.getByRole("radio", { name: /Remote Server/ }).check();

  await expect(page.getByRole("status").getByText("Loading your account…")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByText("contato@pinar.dev (PRO)")).toBeVisible();
});

test("storage mode persists immediately and opens the matching app", async ({ page }) => {
  await installOptionsHarness(page);

  await expect(page.getByRole("radio", { name: /Local Server/ })).toBeChecked();
  await expect(page.getByRole("tabpanel").locator("[data-slot=separator]")).toHaveCount(1);
  await expect(page.getByText("Keep new captures on this device or send them to a remote Pinar server.", { exact: true })).toBeVisible();
  const downloadLink = page.getByRole("link", { name: "Download Pinar" });
  await expect(downloadLink).toHaveAttribute(
    "href",
    "https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg",
  );
  await expect(downloadLink).toHaveAttribute("target", "_blank");
  await page.getByRole("radio", { name: /Remote Server/ }).check();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pinar-e2e-extension-settings") || "{}").storageMode)).toBe("cloud");
  await expectActionPopup(page, "Open app", "/extension-open/cloud/account");

  await page.reload();
  await expect(page.getByRole("radio", { name: /Remote Server/ })).toBeChecked();
  await page.getByRole("radio", { name: /Local Server/ }).check();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pinar-e2e-extension-settings") || "{}").storageMode)).toBe("local");
  await expectActionPopup(page, "Open app", "/extension-open/local/account");

  await page.reload();
  await expect(page.getByRole("radio", { name: /Local Server/ })).toBeChecked();
});

test("the unpacked development profile exposes staging without console configuration", async ({ page }) => {
  await installOptionsHarness(page, { development: true });

  await expect(page.getByRole("radio", { name: /Staging/ })).toBeVisible();
  const settings = await page.evaluate(() => JSON.parse(
    localStorage.getItem("pinar-e2e-extension-settings") || "{}",
  ));
  expect(settings.cloudUrl).toBe(STAGING_CLOUD_URL);

  await page.getByRole("radio", { name: /Staging/ }).check();
  await expect(page.getByText("STAGING", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", {
    name: "I accept the current documents for Pinar's hosted service.",
  })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Terms", exact: true })).toHaveCount(0);
  await expect(page.getByText("contato@pinar.dev (PRO)", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});

test("save button replaces its disk with a loading icon while preferences are persisted", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pinar-e2e-preferences-save-delay", "750");
  });
  await installOptionsHarness(page, { development: true });
  await page.getByRole("radio", { name: /Staging/ }).check();
  await page.getByRole("tab", { name: "Dark", exact: true }).click();

  const saveButton = page.getByRole("button", { name: "Save", exact: true });
  await expect(saveButton).toBeEnabled();
  await expect(saveButton.locator("svg.animate-spin")).toHaveCount(0);
  await saveButton.click();
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveAttribute("aria-busy", "true");
  await expect(saveButton.locator("svg.animate-spin")).toBeVisible();
  await expect(saveButton).not.toHaveAttribute("aria-busy", "true");
  await expect(saveButton.locator("svg.animate-spin")).toHaveCount(0);
});

test("language and theme sit on their own preference rows", async ({ page }) => {
  await installOptionsHarness(page);

  const language = page.getByRole("combobox", { name: "Language" });
  await expect(language).toBeVisible();
  await expect(page.getByText("Language", { exact: true })).toHaveCSS("font-size", "12px");
  await expect(page.getByText("Theme", { exact: true })).toHaveCSS("font-size", "12px");
  await expect(page.getByText("Choose the language used across the extension.", { exact: true })).toHaveCSS("font-size", "12px");
  await expect(page.getByText("Follow the system appearance or choose a fixed theme.", { exact: true })).toBeVisible();
  await expect(page.getByText("Language and appearance used across the extension.", { exact: true })).toBeVisible();

  const panel = page.getByRole("tabpanel");
  const separators = panel.locator("[data-slot=separator]");
  await expect(separators).toHaveCount(1);
  const interfaceHeading = page.getByText("Interface", { exact: true });
  const languageTitle = page.getByText("Language", { exact: true });
  const themeTitle = page.getByText("Theme", { exact: true });
  const interfaceBox = await interfaceHeading.boundingBox();
  const languageBox = await languageTitle.boundingBox();
  const themeBox = await themeTitle.boundingBox();
  const firstSep = await separators.nth(0).boundingBox();
  expect(interfaceBox && languageBox && themeBox && firstSep).toBeTruthy();
  expect((languageBox!.y) - (interfaceBox!.y + interfaceBox!.height)).toBeGreaterThanOrEqual(24);
  expect(firstSep!.y).toBeLessThan(interfaceBox!.y);
  expect(themeBox!.y).toBeGreaterThan(languageBox!.y);

  const theme = page.getByRole("tablist", { name: "Theme" });
  await expect(theme).toBeVisible();
  await expect(page.getByRole("tab", { name: "System", exact: true })).toHaveText("");
  await expect(page.getByRole("tab", { name: "Light", exact: true })).toHaveText("");
  await expect(page.getByRole("tab", { name: "Dark", exact: true })).toHaveText("");

  await page.getByRole("tab", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const languageTriggerBox = await language.boundingBox();
  expect(languageTriggerBox?.width ?? 999).toBeLessThan(160);

  await language.click();
  const languageMenu = page.locator("[data-slot=select-content][data-open]");
  await expect(languageMenu).toBeVisible();
  const languageMenuBox = await languageMenu.boundingBox();
  expect(languageMenuBox?.width ?? 999).toBeLessThan(180);
  await page.getByRole("option", { name: "Português" }).click();
  await expect(page.getByRole("combobox", { name: "Idioma" })).toContainText("Português");
});

test("shortcuts without browser commands do not leave an empty section gap", async ({ page }) => {
  await installOptionsHarness(page);
  await expect(page.getByRole("tabpanel").locator("[data-slot=separator]")).toHaveCount(1);

  await page.getByRole("tab", { name: "Capture" }).click();
  await expect(page.getByRole("tabpanel").locator("[data-slot=separator]")).toHaveCount(1);

  await page.getByRole("tab", { name: "Shortcuts" }).click();
  await expect(page.getByText("⌘ + Enter", { exact: true })).toBeVisible();
  await expect(page.getByText(/Ctrl.*Enter/)).toHaveCount(0);
  await expect(page.getByRole("tabpanel").locator("[data-slot=separator]")).toHaveCount(0);
  const shortcutsHeading = page.getByText("Browser shortcuts", { exact: true });
  const shortcutsDesc = page.getByText(
    "Assigned by Chrome and rebindable per browser. They stay inert on chrome:// pages, on the Web Store, and before the overlay is injected.",
    { exact: true },
  );
  const shortcutsHeadingBox = await shortcutsHeading.boundingBox();
  const shortcutsDescBox = await shortcutsDesc.boundingBox();
  const captureHeadingBox = await page.getByText("During capture", { exact: true }).boundingBox();
  expect(shortcutsHeadingBox && shortcutsDescBox).toBeTruthy();
  expect((shortcutsDescBox!.y) - (shortcutsHeadingBox!.y + shortcutsHeadingBox!.height)).toBeLessThan(8);
  expect(captureHeadingBox!.y - (shortcutsDescBox!.y + shortcutsDescBox!.height)).toBeLessThan(16);
});

test("Windows and Linux show only Alt+Enter for concluding a capture", async ({ page }) => {
  await installOptionsHarness(page, { platform: "win" });
  await page.getByRole("tab", { name: "Shortcuts" }).click();
  await expect(page.getByText("Alt + Enter", { exact: true })).toBeVisible();
  await expect(page.getByText(/Ctrl.*Enter/)).toHaveCount(0);
  await expect(page.getByText(/⌘.*Enter/)).toHaveCount(0);
});

test("privacy URL keys input sits under its description", async ({ page }) => {
  await installOptionsHarness(page);
  await page.getByRole("tab", { name: "Capture" }).click();

  const description = page.getByText(
    "Comma-separated query or hash keys stripped from captured URLs, in addition to tokens and secrets.",
    { exact: true },
  );
  const input = page.getByRole("textbox", { name: "Extra URL keys to hide" });
  await expect(input).toBeVisible();
  const geometry = await description.evaluate((element) => {
    const input = element.closest('[data-slot="setting-row"]')?.querySelector("input");
    return { descriptionBottom: element.getBoundingClientRect().bottom, inputBox: input?.getBoundingClientRect() };
  });
  expect(geometry.inputBox, "privacy copy and input should be measurable").toBeTruthy();
  expect(geometry.inputBox!.top).toBeGreaterThan(geometry.descriptionBottom - 1);
  expect(geometry.inputBox!.width).toBeGreaterThan(280);
});

test("preference copy uses tight line-height and reaches the control", async ({ page }) => {
  await installOptionsHarness(page);
  await page.getByRole("tab", { name: "Capture" }).click();

  const handoff = page.getByText(
    "Compact copies only actionable context. Full includes every captured field. Saved captures and the viewer are always complete.",
    { exact: true },
  );
  await expect(handoff).toHaveCSS("font-size", "12px");
  await expect(handoff).toHaveCSS("line-height", "16px");

  const title = page.getByText("Agent copy detail: Compact", { exact: true });
  const titleBox = await title.boundingBox();
  const descBox = await handoff.boundingBox();
  expect(titleBox && descBox, "title and description should be measurable").toBeTruthy();
  expect((descBox?.y ?? 0) - ((titleBox?.y ?? 0) + (titleBox?.height ?? 0))).toBeLessThan(4);

  const row = page.locator("[data-slot=setting-row]").filter({ has: handoff });
  const controlWidth = await row.evaluate((el) => el.children[1]?.getBoundingClientRect().width ?? 0);
  expect(controlWidth).toBeLessThan(80);

  await page.getByRole("tab", { name: "Shortcuts" }).click();
  const intro = page.getByText(
    "Assigned by Chrome and rebindable per browser. They stay inert on chrome:// pages, on the Web Store, and before the overlay is injected.",
    { exact: true },
  );
  await expect(intro).toHaveCSS("line-height", "16px");
});

test("agent copy detail persists independently from the complete saved capture", async ({ page }) => {
  await installOptionsHarness(page);
  await page.getByRole("tab", { name: "Capture" }).click();

  const detail = page.getByRole("switch", { name: "Agent copy detail" });
  await expect(page.getByText("Agent copy detail: Compact", { exact: true })).toBeVisible();
  await expect(detail).not.toBeChecked();
  await detail.click();
  await expect(detail).toBeChecked();
  await expect(page.getByText("Agent copy detail: Full", { exact: true })).toBeVisible();
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
  await page.getByRole("tab", { name: "Capture" }).click();
  await expect(page.getByRole("switch", { name: "Agent copy detail" })).toBeChecked();
});

test("email sign-in remains available in remote settings when the session service is down", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pinar-e2e-auth-fail", "1");
  });
  await installOptionsHarness(page);
  await page.getByRole("radio", { name: /Remote Server/ }).check();

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
  await expect(page.getByRole("button", { name: "Generate code", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open app", exact: true })).toHaveCount(1);
});

test("signed-out Cloud asks for email and never offers an extension pairing code", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pinar-e2e-extension-identity", "installation");
  });
  await installOptionsHarness(page);
  await page.getByRole("radio", { name: /Remote Server/ }).check();

  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send code" })).toBeEnabled();
  await expect(page.getByRole("switch", { name: "Save Annotation History" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Generate code" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create account" })).toHaveCount(1);
  await page.getByPlaceholder("you@example.com").fill("contato@pinar.dev");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByPlaceholder("000000").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("contato@pinar.dev (PRO)", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Save Annotation History" })).toBeVisible();
  const extensionCodeMessages = await page.evaluate(() => JSON.parse(
    localStorage.getItem("pinar-e2e-extension-messages") || "[]",
  ).filter((message: { type?: string }) => message.type === "auth:extension-code"));
  expect(extensionCodeMessages).toHaveLength(0);
});

test("Pro account signs out and returns by email without duplicating its tree", async ({ page }) => {
  await installOptionsHarness(page);
  await page.getByRole("radio", { name: /Remote Server/ }).check();

  await expect(page.getByText("contato@pinar.dev (PRO)", { exact: true })).toBeVisible();
  await expectActionPopup(page, "Open app", "/extension-open/cloud/account");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("switch", { name: "Save Annotation History" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create account" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Generate code", exact: true })).toHaveCount(0);
  await expectActionPopup(page, "Open app", "/extension-open/cloud/installation");

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
  await expect(page.getByText("contato@pinar.dev (PRO)", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Save Annotation History" })).toBeVisible();

});

test("remote Free account shows its plan but does not show Pro voice preferences", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pinar-e2e-extension-identity", "free-account"));
  await installOptionsHarness(page);
  await page.getByRole("radio", { name: /Remote Server/ }).check();

  await expect(page.getByText("contato@pinar.dev (FREE)", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Save Annotation History" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Clean up transcription with AI" })).toHaveCount(0);
});
