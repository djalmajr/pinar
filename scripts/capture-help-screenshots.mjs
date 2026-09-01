import { mkdir, rename, rm } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { SUPPORTED_LANGUAGES } from "../packages/shared/src/types/index.ts";
import { helpScreenshotDefinitions } from "../apps/server/src/lib/help-content.ts";

const OUTPUT_ROOT = new URL(
  "../apps/server/public/help/screenshots/",
  import.meta.url,
);
const STAGING_ROOT = new URL(`.generated-${process.pid}/`, OUTPUT_ROOT);

const SCREENSHOT_TARGETS = {
  "capture-workspace": { path: "/app", view: "grid" },
  "getting-started": { path: "/" },
  "help-navigation": { path: "/help/getting-started" },
  pricing: { path: "/pricing" },
  privacy: { path: "/help/privacy" },
  "sign-in-email": { path: "/sign-in", tab: 1 },
  "sign-in-extension": { path: "/sign-in" },
  updates: { path: "/releases/0.1.5" },
  "workspace-table": { path: "/app", view: "table" },
};

if (
  Object.keys(SCREENSHOT_TARGETS).length !== helpScreenshotDefinitions.length
) {
  throw new Error("Help screenshot definitions and capture targets differ");
}

const SCREENSHOTS = helpScreenshotDefinitions.map((definition) => {
  const target = SCREENSHOT_TARGETS[definition.key];
  if (!target) {
    throw new Error(`Missing capture target for ${definition.key}`);
  }
  return { ...definition, ...target };
});

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

const baseUrl = await discoverBaseUrl();
await mkdir(STAGING_ROOT, { recursive: true });

try {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const language of SUPPORTED_LANGUAGES) {
      const context = await browser.newContext({ colorScheme: "light" });
      await context.addInitScript((locale) => {
        localStorage.setItem("pinar-language", locale);
      }, language);
      const page = await context.newPage();

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
        await page.goto(`${baseUrl}${screenshot.path}`, {
          waitUntil: "networkidle",
        });
        await waitForRenderedLocale(page, language);
        if (screenshot.tab !== undefined) {
          await page.getByRole("tab").nth(screenshot.tab).click();
        }
        const languageDirectory = new URL(`${language}/`, STAGING_ROOT);
        await mkdir(languageDirectory, { recursive: true });
        await page.screenshot({
          animations: "disabled",
          caret: "hide",
          path: new URL(`${screenshot.key}.webp`, languageDirectory).pathname,
          quality: 88,
          type: "webp",
        });
        process.stdout.write(`${language}/${screenshot.key}.webp\n`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  for (const language of SUPPORTED_LANGUAGES) {
    const outputDirectory = new URL(`${language}/`, OUTPUT_ROOT);
    await rm(outputDirectory, { force: true, recursive: true });
    await rename(new URL(`${language}/`, STAGING_ROOT), outputDirectory);
  }
} finally {
  await rm(STAGING_ROOT, { force: true, recursive: true });
}
