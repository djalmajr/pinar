import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

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
    const settings = () => JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const identity = () => localStorage.getItem(IDENTITY_KEY) || "account";
    const localValues = () => JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "{}");
    const remember = (message: unknown) => {
      const messages = JSON.parse(localStorage.getItem(MESSAGES_KEY) || "[]");
      messages.push(message);
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
    };
    const authSession = () => identity() === "account"
      ? { email: "djalmajr@gmail.com", kind: "account", plan: "pro", userId: "user-pro" }
      : { installationId: "installation-free", kind: "installation", plan: "free" };
    const destination = () => {
      const mode = settings().storageMode === "cloud" ? "cloud" : "local";
      const owner = identity();
      const projectId = `${owner}-${mode}-project`;
      const collectionId = `${owner}-${mode}-inbox`;
      const now = "2026-08-18T00:00:00.000Z";
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
            }],
            createdAt: now,
            icon: "folder",
            id: projectId,
            isProtected: true,
            name: `${owner === "account" ? "Account" : "Installation"} ${mode === "cloud" ? "Cloud" : "Local"}`,
            ownerId: owner,
            position: 0,
            updatedAt: now,
          }],
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
          if (message.type === "auth:get") return { ok: true, session: authSession() };
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
  await expect(page.getByRole("link", { name: "Download Pinar" })).toHaveAttribute(
    "href",
    "https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg",
  );
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("Account Local");

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

test("Pro account opens app and billing, signs out, and returns by email without duplicating its tree", async ({ page }) => {
  await installOptionsHarness(page);
  await page.getByRole("tab", { name: "Account" }).click();

  await expect(page.getByText("djalmajr@gmail.com", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="badge"]').getByText("pro", { exact: true })).toBeVisible();
  await expectActionPopup(page, "Open app", "/extension-open/local/account");
  await expectActionPopup(page, "Manage Billing", "/extension-billing/customer-pro");
  await expect(page.getByText("djalmajr@gmail.com", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator('[data-slot="badge"]').getByText("Free", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Upgrade to Pro", exact: true })).toHaveAttribute("href", "https://pinar.dev/pricing");
  await page.getByRole("tab", { name: "Storage" }).click();
  await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue("Installation Local");
  await expectActionPopup(page, "Open app", "/extension-open/local/installation");

  await page.getByRole("tab", { name: "Account" }).click();
  await page.getByPlaceholder("you@example.com").fill("djalmajr@gmail.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByPlaceholder("000000").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("djalmajr@gmail.com", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="badge"]').getByText("pro", { exact: true })).toBeVisible();

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
  await expect(page.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute("href", "https://pinar.dev/legal/terms");
  await expect(page.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute("href", "https://pinar.dev/legal/privacy");
  await expect(page.getByRole("link", { name: "Acceptable Use", exact: true })).toHaveAttribute("href", "https://pinar.dev/legal/acceptable-use");
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
