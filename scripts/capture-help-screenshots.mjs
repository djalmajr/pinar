import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { translations } from "../packages/shared/src/i18n/index.ts";
import { SUPPORTED_LANGUAGES } from "../packages/shared/src/types/index.ts";
import { helpScreenshotDefinitions } from "../apps/server/src/lib/help-content.ts";
import { overlayFixtureHtml } from "./help-screenshot-fixtures/capture-overlay.mjs";

const OUTPUT_ROOT = new URL(
  "../apps/server/public/help/screenshots/",
  import.meta.url,
);
const STAGING_ROOT = new URL(`.generated-${process.pid}/`, OUTPUT_ROOT);

const EXTENSION_DIST = resolve(
  fileURLToPath(new URL("../extension/dist", import.meta.url)),
);
const CONTENT_TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".woff2": "font/woff2",
};
const ONLY_KEY = process.env.PINAR_HELP_SCREENSHOT_ONLY || "";
const UI_MESSAGE_LOADERS = {
  de: () => import("../apps/server/src/lib/ui-locales/de.ts"),
  en: () => import("../apps/server/src/lib/ui-locales/en.ts"),
  es: () => import("../apps/server/src/lib/ui-locales/es.ts"),
  fr: () => import("../apps/server/src/lib/ui-locales/fr.ts"),
  ja: () => import("../apps/server/src/lib/ui-locales/ja.ts"),
  pt: () => import("../apps/server/src/lib/ui-locales/pt.ts"),
  zh: () => import("../apps/server/src/lib/ui-locales/zh.ts"),
};

const SCREENSHOT_TARGETS = {
  "capture-copied": { path: "/screenshot-fixtures/capture-overlay?mode=copied" },
  "capture-copy-failed": {
    path: "/screenshot-fixtures/capture-overlay?mode=copy-failed",
  },
  "capture-full-page": {
    path: "/screenshot-fixtures/capture-overlay?mode=full-page",
  },
  "capture-masks": { path: "/screenshot-fixtures/capture-overlay?mode=masks" },
  "capture-pins": { path: "/screenshot-fixtures/capture-overlay?mode=pins" },
  "capture-review": { path: "/screenshot-fixtures/capture-overlay?mode=review" },
  "capture-selection": {
    path: "/screenshot-fixtures/capture-overlay?mode=selection",
  },
  "capture-shortcuts": { path: "/extension-options/options.html" },
  "capture-toolbar": { path: "/screenshot-fixtures/capture-overlay" },
  "capture-types": { path: "/screenshot-fixtures/capture-overlay?mode=types" },
  "capture-viewer": { path: "/app", view: "grid", openSession: true },
  "capture-workspace": { path: "/app", view: "grid" },
  "extension-options": { path: "/extension-options/options.html" },
  "extension-preferences": { path: "/extension-options/options.html" },
  "help-navigation": { path: "/help/getting-started" },
  "install-pinar": { path: "/extension-options/options.html" },
  "legal-retention": { path: "/legal/retention" },
  "options-local": {
    path: "/extension-options/options.html",
    storageMode: "local",
  },
  "preferences-privacy": { path: "/extension-options/options.html" },
  pricing: { path: "/pricing" },
  "pricing-credits": { path: "/pricing" },
  privacy: { path: "/legal/privacy" },
  "sharing-markdown": { path: "/app", view: "grid", openMarkdown: true },
  "sign-in-email": { path: "/sign-in", tab: 1 },
  "sign-in-extension": { path: "/sign-in" },
  updates: { path: "/releases/0.1.5" },
  "workspace-nested": { path: "/app", view: "grid", clickCollection: true },
  "workspace-review": { path: "/app", view: "table", openReviewFilter: true },
  "workspace-security": { path: "/app", view: "grid", clickPersonal: true },
  "workspace-table": { path: "/app", view: "table" },
};

if (
  Object.keys(SCREENSHOT_TARGETS).length !== helpScreenshotDefinitions.length
) {
  throw new Error("Help screenshot definitions and capture targets differ");
}

const SCREENSHOTS = helpScreenshotDefinitions
  .map((definition) => {
    const target = SCREENSHOT_TARGETS[definition.key];
    if (!target) {
      throw new Error(`Missing capture target for ${definition.key}`);
    }
    return { ...definition, ...target };
  })
  .filter((screenshot) => !ONLY_KEY || screenshot.key === ONLY_KEY);

if (ONLY_KEY && SCREENSHOTS.length === 0) {
  throw new Error(`Unknown PINAR_HELP_SCREENSHOT_ONLY=${ONLY_KEY}`);
}

async function discoverBaseUrl() {
  if (process.env.PINAR_HELP_SCREENSHOT_BASE_URL) {
    return process.env.PINAR_HELP_SCREENSHOT_BASE_URL.replace(/\/$/, "");
  }
  for (let port = 17373; port <= 17382; port += 1) {
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const health = await response.json();
      if (response.ok && health?.service === "pinar") return baseUrl;
    } catch {
      // Keep scanning the reserved local Pinar port range.
    }
  }
  throw new Error(
    "No local Pinar server answered /api/health on ports 17373-17382",
  );
}

async function waitForRenderedLocale(page, language) {
  await page.waitForFunction(
    (expectedLanguage) => document.documentElement.lang === expectedLanguage,
    language,
  );
  const pathname = new URL(page.url()).pathname;
  if (pathname.startsWith("/help") || pathname.startsWith("/releases")) {
    await page.waitForSelector(`[data-content-language="${language}"]`);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter(
          (image) =>
            image.loading !== "lazy" ||
            image.getBoundingClientRect().top < innerHeight,
        )
        .map((image) =>
          image.complete
            ? undefined
            : new Promise((resolve) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", resolve, { once: true });
              }),
        ),
    );
  });
}

function extensionOptionsChromeMock(language, storageMode = "cloud") {
  const os =
    process.platform === "win32"
      ? "win"
      : process.platform === "darwin"
        ? "mac"
        : "linux";
  const settings = {
    cloudUrl: "https://pinar.dev",
    copyOnFinishBatch: "prompt",
    copyViewerContent: false,
    enableHistory: true,
    handoffMode: "compact",
    includeScreenshot: true,
    includeViewer: true,
    language,
    loopMetricsOptIn: false,
    sensitiveQueryKeys: "token, api_key",
    storageMode,
    theme: "light",
  };
  return {
    os,
    settings,
  };
}

async function fulfillExtensionOptions(route) {
  const pathname = new URL(route.request().url()).pathname;
  const relative =
    decodeURIComponent(pathname.slice("/extension-options/".length)) ||
    "options.html";
  const file = resolve(EXTENSION_DIST, relative);
  if (file !== EXTENSION_DIST && !file.startsWith(`${EXTENSION_DIST}${sep}`)) {
    await route.abort("blockedbyclient");
    return;
  }
  try {
    await route.fulfill({
      body: await readFile(file),
      contentType: CONTENT_TYPES[extname(file)] || "application/octet-stream",
    });
  } catch {
    await route.fulfill({ body: "Not found", status: 404 });
  }
}

async function launchHelpScreenshotBrowser() {
  if (process.env.PINAR_HELP_SCREENSHOT_CHANNEL) {
    return chromium.launch({
      channel: process.env.PINAR_HELP_SCREENSHOT_CHANNEL,
      headless: true,
    });
  }
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("Executable doesn't exist")) throw error;
    return chromium.launch({ channel: "msedge", headless: true });
  }
}

const baseUrl = await discoverBaseUrl();
await mkdir(STAGING_ROOT, { recursive: true });

try {
  const browser = await launchHelpScreenshotBrowser();
  try {
    for (const language of SUPPORTED_LANGUAGES) {
      const context = await browser.newContext({ colorScheme: "light" });
      const optionsMock = extensionOptionsChromeMock(language);
      await context.addInitScript((locale) => {
        localStorage.setItem("pinar-language", locale);
      }, language);
      await context.addInitScript(({ os, settings }) => {
        globalThis.chrome = {
          runtime: {
            getManifest: () => ({ version: "0.3.0" }),
            getPlatformInfo: async () => ({ os }),
            id: "pinar-help-screenshots",
            sendMessage: async (message) => {
              if (message?.type === "preferences:get") {
                return {
                  handoffMode: settings.handoffMode,
                  includeScreenshot: settings.includeScreenshot,
                  ok: true,
                };
              }
              if (
                message?.type === "destination:get" ||
                message?.type === "destination:set"
              ) {
                const now = "2026-08-18T00:00:00.000Z";
                return {
                  destination: {
                    collectionId: "inbox",
                    projectId: "personal",
                  },
                  ok: true,
                  tree: {
                    projects: [
                      {
                        collections: [
                          {
                            createdAt: now,
                            id: "inbox",
                            isProtected: true,
                            name: "Inbox",
                            ownerId: "local",
                            parentId: null,
                            position: 0,
                            projectId: "personal",
                            sessions: [],
                            updatedAt: now,
                          },
                        ],
                        createdAt: now,
                        icon: "folder",
                        id: "personal",
                        isProtected: true,
                        name: "Personal",
                        ownerId: "local",
                        position: 0,
                        updatedAt: now,
                      },
                    ],
                  },
                };
              }
              if (message?.type === "auth:get") {
                return {
                  ok: true,
                  session: {
                    installationId: "help-screenshots",
                    kind: "installation",
                    plan: "free",
                  },
                };
              }
              return { ok: true };
            },
          },
          commands: {
            getAll: (callback) => {
              callback([
                {
                  description: "Toggle Pinar",
                  name: "_execute_action",
                  shortcut: "Alt+Shift+P",
                },
                {
                  description: "Finish batch",
                  name: "finish-batch",
                  shortcut: "Alt+Shift+B",
                },
                {
                  description: "Cancel batch",
                  name: "cancel-batch",
                  shortcut: "Alt+Shift+N",
                },
                {
                  description: "Open panel",
                  name: "open-panel",
                  shortcut: "Alt+Shift+O",
                },
              ]);
            },
          },
          tabs: {
            create: async () => {},
          },
          storage: {
            local: {
              get: async (defaults = {}) => ({ ...defaults }),
              remove: async () => {},
              set: async () => {},
            },
            sync: {
              get: async (defaults = {}) => ({ ...defaults, ...settings }),
              set: async () => {},
            },
          },
        };
      }, optionsMock);
      await context.route("**/api/legal/current", (route) =>
        route.fulfill({
          json: {
            acceptableUseUrl: "/legal/acceptable-use",
            privacyUrl: "/legal/privacy",
            termsUrl: "/legal/terms",
            version: "2026-08-18",
          },
        }),
      );
      await context.route("**/extension-options/**", fulfillExtensionOptions);
      await context.route("**/screenshot-fixtures/capture-overlay**", (route) => {
        const mode =
          new URL(route.request().url()).searchParams.get("mode") || "capture";
        return route.fulfill({
          body: overlayFixtureHtml(translations[language], {
            batchShortcut: "Alt+Shift+B",
            language,
            mode,
            sendMod: process.platform === "darwin" ? "⌘" : "Ctrl",
          }),
          contentType: "text/html; charset=utf-8",
        });
      });
      const page = await context.newPage();
      const copy = translations[language];
      const ui = (await UI_MESSAGE_LOADERS[language]()).default;

      for (const screenshot of SCREENSHOTS) {
        await page.setViewportSize({
          width: screenshot.width,
          height: screenshot.height,
        });
        if (screenshot.view) {
          await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
          await page.evaluate((view) => {
            localStorage.setItem("pinar-history-view", view);
          }, screenshot.view);
        }
        const isExtensionOptions = [
          "capture-shortcuts",
          "extension-options",
          "extension-preferences",
          "install-pinar",
          "options-local",
          "preferences-privacy",
        ].includes(screenshot.key);
        await page.goto(`${baseUrl}${screenshot.path}`, {
          waitUntil: isExtensionOptions ? "domcontentloaded" : "networkidle",
        });
        if (isExtensionOptions) {
          await page.getByText(copy.header_title).waitFor();
          if (
            screenshot.key === "extension-preferences" ||
            screenshot.key === "preferences-privacy"
          ) {
            await page.getByRole("tab", { name: copy.tab_preferences }).click();
            if (screenshot.key === "preferences-privacy") {
              await page.getByText(copy.privacy_query_keys_label).waitFor();
            } else {
              await page.getByText(copy.section_handoff).waitFor();
              await page.getByText(copy.screenshot_label).waitFor();
            }
          } else if (screenshot.key === "capture-shortcuts") {
            await page.getByRole("tab", { name: copy.tab_shortcuts }).click();
            await page.getByText(copy.shortcuts_overlay_title).waitFor();
          } else if (screenshot.key === "options-local") {
            await page.getByText(copy.local_title, { exact: true }).click();
            await page.getByText(copy.local_desc).waitFor();
          } else if (screenshot.key === "install-pinar") {
            await page.getByRole("link", { name: copy.btn_download_macos }).waitFor();
          } else {
            await page.getByRole("link", { name: copy.legal_terms, exact: true }).waitFor();
          }
        } else if (String(screenshot.path || "").includes("screenshot-fixtures/capture-overlay")) {
          await page.locator("[data-overlay-toolbar]").waitFor();
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
        } else if (screenshot.openSession || screenshot.view) {
          await page.locator("[data-dashboard-scroll-area]").waitFor({
            timeout: 15_000,
          });
        } else {
          await waitForRenderedLocale(page, language);
        }
        if (screenshot.tab !== undefined) {
          await page.getByRole("tab").nth(screenshot.tab).click();
        }
        if (screenshot.openSession) {
          const sessionId = await page
            .locator("[data-session-id]")
            .first()
            .getAttribute("data-session-id", { timeout: 15_000 });
          if (!sessionId) {
            throw new Error("capture-viewer needs at least one saved session");
          }
          await page.goto(`${baseUrl}/v/${encodeURIComponent(sessionId)}`, {
            waitUntil: "networkidle",
          });
          await page.locator("img").first().waitFor();
        }
        if (screenshot.key === "privacy" || screenshot.key === "legal-retention") {
          await page
            .getByRole("tablist", { name: /Legal documents|Documentos legais/i })
            .waitFor();
        }
        if (screenshot.openMarkdown) {
          const projectId = await page.evaluate(async () => {
            const response = await fetch("/api/projects");
            const data = await response.json();
            return data.projects?.[0]?.id ?? null;
          });
          if (!projectId) {
            throw new Error("sharing-markdown needs at least one project");
          }
          await page.goto(`${baseUrl}/p/${encodeURIComponent(projectId)}`, {
            waitUntil: "networkidle",
          });
          await page.getByRole("button").filter({ hasText: /Markdown/ }).waitFor();
        }
        if (screenshot.clickCollection) {
          const sidebar = page.locator("[data-sidebar]");
          const menuButton = sidebar.locator('[data-slot="sidebar-menu-button"]');
          await menuButton.first().waitFor();
          const toggles = sidebar.locator("[data-collection-toggle]");
          const toggleCount = await toggles.count();
          for (let index = 0; index < toggleCount; index += 1) {
            if ((await toggles.nth(index).getAttribute("aria-expanded")) === "false") {
              await toggles.nth(index).click();
            }
          }
          const studio = menuButton.filter({ hasText: "Studio" });
          const nestedRoot = menuButton.filter({ hasText: "Yatta!" });
          if ((await studio.count()) > 0) {
            await studio.click();
          } else if ((await nestedRoot.count()) > 0) {
            await nestedRoot.click();
          } else {
            await menuButton.filter({ hasText: "Inbox" }).first().click();
          }
        }
        if (screenshot.openReviewFilter) {
          await page
            .getByRole("button", {
              name: /Review|Revisão|Revisión|Revue|Prüfung|审阅|レビュー/,
            })
            .click();
          await page.getByRole("menu").waitFor();
        }
        if (screenshot.clickPersonal) {
          await page.locator("button[aria-label='Personal']").click();
          await page.getByRole("menu").waitFor();
        }
        if (screenshot.key === "pricing-credits") {
          await page
            .getByRole("heading", { name: ui["pricing.addOnsTitle"] })
            .scrollIntoViewIfNeeded();
          await page
            .getByRole("heading", { name: ui["pricing.aiCreditsTitle"] })
            .waitFor();
        }
        const languageDirectory = new URL(`${language}/`, STAGING_ROOT);
        await mkdir(languageDirectory, { recursive: true });
        const screenshotPath = fileURLToPath(
          new URL(`${screenshot.key}.webp`, languageDirectory),
        );
        const screenshotOptions = {
          animations: "disabled",
          caret: "hide",
          path: screenshotPath,
          quality: 88,
          type: "webp",
        };
        if (screenshot.key === "install-pinar") {
          await page
            .locator("label")
            .filter({ hasText: copy.local_title })
            .screenshot(screenshotOptions);
        } else if (screenshot.key === "extension-preferences") {
          await page
            .locator("section")
            .filter({ hasText: copy.screenshot_label })
            .screenshot(screenshotOptions);
        } else if (screenshot.key === "preferences-privacy") {
          await page
            .locator("section")
            .filter({ hasText: copy.privacy_query_keys_label })
            .screenshot(screenshotOptions);
        } else if (screenshot.key === "pricing-credits") {
          await page
            .locator("[data-slot='card']")
            .filter({
              has: page.getByRole("heading", {
                name: ui["pricing.aiCreditsTitle"],
              }),
            })
            .screenshot(screenshotOptions);
        } else if (isExtensionOptions) {
          await page.locator("div.max-w-\\[640px\\]").first().screenshot(screenshotOptions);
        } else {
          await page.screenshot(screenshotOptions);
        }
        process.stdout.write(`${language}/${screenshot.key}.webp\n`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  for (const language of SUPPORTED_LANGUAGES) {
    const outputDirectory = new URL(`${language}/`, OUTPUT_ROOT);
    if (ONLY_KEY) {
      await mkdir(outputDirectory, { recursive: true });
      await copyFile(
        new URL(`${language}/${ONLY_KEY}.webp`, STAGING_ROOT),
        new URL(`${ONLY_KEY}.webp`, outputDirectory),
      );
      continue;
    }
    await rm(outputDirectory, { force: true, recursive: true });
    await rename(new URL(`${language}/`, STAGING_ROOT), outputDirectory);
  }
} finally {
  await rm(STAGING_ROOT, { force: true, recursive: true });
}
