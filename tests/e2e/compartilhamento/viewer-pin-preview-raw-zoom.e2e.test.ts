import { expect, test } from "@playwright/test";
import {
  installClipboardHarness,
  primaryNavigationItem,
  readClipboardHarness,
} from "../helpers/ui";

const elementComment = "Align this action with the right edge.";
const elementSelector = "button[data-save]";
const elementDomPath = "main > form > button";
const sessionMarkdown = `# Viewer fixture

- URL: https://example.test/settings
- Viewer: /v/viewer-e2e

## Pin 1

Align this action with the right edge.

## Pin 2

Reduce the empty space in this region.
`;

function occurrences(text: string, value: string) {
  return text.split(value).length - 1;
}

const session = {
  createdAt: "2026-08-18T01:30:00.000Z",
  id: "viewer-e2e",
  page: {
    title: "Viewer fixture",
    url: "https://example.test/settings",
  },
  pins: [
    {
      comment: elementComment,
      coords: { x: 24, y: 48 },
      domPath: elementDomPath,
      innerText: "Save changes",
      location: {
        confidence: "ambiguous",
        evidence: ["competing candidates"],
        score: 0.52,
        strategy: "semantic",
      },
      number: 1,
      selector: elementSelector,
      tag: "button",
      type: "point",
    },
    {
      areaBox: { height: 180, width: 320, x: 80, y: 120 },
      comment: "Reduce the empty space in this region.",
      coords: { x: 80, y: 120 },
      number: 2,
      type: "area",
    },
  ],
  shotId: "viewer-e2e",
  shotUrl: "/shots/viewer-e2e.svg",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/sessions/viewer-e2e", (route) => route.fulfill({
    json: { session },
  }));
  await page.route("**/shots/viewer-e2e.svg", (route) => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#e0f2fe"/><rect x="240" y="180" width="720" height="440" rx="24" fill="#fff"/><text x="600" y="400" text-anchor="middle" font-family="sans-serif" font-size="48">Viewer fixture</text></svg>',
    contentType: "image/svg+xml",
  }));
});

test("unlisted visitor sees only authentic public session data and explicit navigation", async ({ page }) => {
  await page.context().route("https://example.test/settings", (route) => route.fulfill({
    body: "<title>Original settings page</title>",
    contentType: "text/html",
  }));
  await page.goto("/v/viewer-e2e");

  await expect(page.getByRole("heading", { name: "Viewer fixture" })).toBeVisible();
  const originalPage = page.getByRole("link", { name: "https://example.test/settings" });
  await expect(originalPage).toHaveAttribute("target", "_blank");
  await expect(originalPage).toHaveAttribute("rel", "noopener noreferrer");

  const screenshot = page.getByRole("img", { name: "Annotated page screenshot" });
  await expect(screenshot).toBeVisible();
  await expect.poll(() => screenshot.evaluate((image: HTMLImageElement) => ({
    height: image.naturalHeight,
    width: image.naturalWidth,
  }))).toEqual({ height: 800, width: 1200 });
  const svg = await screenshot.evaluate(async (image: HTMLImageElement) => fetch(image.src).then((response) => response.text()));
  expect(svg).toContain("Viewer fixture");

  await expect(page.getByText("2 pins", { exact: true })).toBeVisible();
  const cards = page.locator("aside").getByTitle(/Open pin/);
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Align this action with the right edge.");
  await expect(cards.nth(0)).toContainText("Needs review");
  await expect(cards.nth(1)).toContainText("Reduce the empty space in this region.");

  const popupPromise = page.waitForEvent("popup");
  await originalPage.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://example.test/settings");
  await popup.close();

  await expect(page.getByRole("button", { exact: true, name: "Personal" })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Inbox" })).toHaveCount(0);
  await expect(await primaryNavigationItem(page, "Open app")).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { exact: true, name: "Sign in" })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { exact: true, name: "Plans" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "AI summary" })).toHaveCount(0);
});

test("review on page dispatches only the chosen session id", async ({ page }) => {
  await page.goto("/v/viewer-e2e");
  await page.evaluate(() => {
    window.addEventListener("pinar:reopen-session", (event) => {
      (window as any).__pinarReopenDetail = (event as CustomEvent).detail;
    });
  });
  await page.getByRole("button", { name: "Review on page" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__pinarReopenDetail)).toEqual({
    sessionId: "viewer-e2e",
  });
  await expect(page.getByText("Install the Pinar extension to reopen this session on the original page.")).toBeVisible();
});

test("copy, Markdown endpoint and assistant prompts preserve one session payload", async ({ page }) => {
  await installClipboardHarness(page);
  await page.context().route("**/v/viewer-e2e.md", (route) => route.fulfill({
    body: sessionMarkdown,
    contentType: "text/markdown",
  }));
  await page.context().route("https://chatgpt.com/**", (route) => route.fulfill({
    body: "<title>ChatGPT prompt receiver</title>",
    contentType: "text/html",
  }));
  await page.context().route("https://claude.ai/**", (route) => route.fulfill({
    body: "<title>Claude prompt receiver</title>",
    contentType: "text/html",
  }));
  await page.goto("/v/viewer-e2e");

  await page.getByRole("button", { name: "Copy Page" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await readClipboardHarness(page)).toBe(sessionMarkdown);

  await page.getByRole("button", { name: "More page actions" }).click();
  const markdownPopupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "View as Markdown" }).click();
  const markdownPopup = await markdownPopupPromise;
  await expect(markdownPopup.locator("body")).toContainText("Viewer fixture");
  await expect(markdownPopup.locator("body")).toContainText("https://example.test/settings");
  await expect(markdownPopup.locator("body")).toContainText("Align this action with the right edge.");
  await expect(markdownPopup.locator("body")).toContainText("Reduce the empty space in this region.");
  await markdownPopup.close();

  const markdownUrl = `${new URL(page.url()).origin}/v/viewer-e2e.md`;
  await page.getByRole("button", { name: "More page actions" }).click();
  const chatGptPopupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Open in ChatGPT" }).click();
  const chatGptPopup = await chatGptPopupPromise;
  expect(new URL(chatGptPopup.url()).searchParams.get("q")).toBe(`Review this annotated page: ${markdownUrl}`);
  await chatGptPopup.close();

  await page.getByRole("button", { name: "More page actions" }).click();
  const claudePopupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Open in Claude" }).click();
  const claudePopup = await claudePopupPromise;
  expect(new URL(claudePopup.url()).searchParams.get("q")).toBe(`Review this annotated page: ${markdownUrl}`);
  await claudePopup.close();

  await expect(page.getByRole("heading", { name: "Viewer fixture" })).toBeVisible();
  await expect(page.locator("aside").getByTitle(/Open pin/)).toHaveCount(2);
});

test("visitor inspects element and area pins in Preview and Raw", async ({ page }) => {
  await page.goto("/v/viewer-e2e");

  await page.getByTitle("Open pin 1").click();
  let dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog.getByRole("tab", { name: "Preview", selected: true })).toBeVisible();
  await expect(dialog.getByText("Needs review")).toBeVisible();
  await expect(dialog.getByText(elementComment, { exact: true })).toBeVisible();
  await expect(dialog.getByText(elementSelector, { exact: true })).toBeVisible();
  await expect(dialog.getByText(elementDomPath, { exact: true })).toBeVisible();
  await expect(dialog.getByText("x=24, y=48", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Raw" }).click();
  const raw = dialog.locator('[data-slot="tabs-content"]:visible pre')
    .filter({ hasText: "# Pin 1" })
    .locator("code");
  await expect(raw).toBeVisible();
  const rawText = (await raw.textContent()) ?? "";
  expect(occurrences(rawText, elementComment)).toBe(1);
  expect(occurrences(rawText, elementSelector)).toBe(1);
  expect(occurrences(rawText, elementDomPath)).toBe(1);
  expect(rawText).toContain("**Location:** ambiguous (semantic)");

  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByTitle("Open pin 2").click();
  dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog.getByText(/Type:\s*Area selection/)).toBeVisible();
  await expect(dialog.getByText(/Area:\s*320 × 180px at x=80, y=120/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
});

test("screenshot zoom clamps, pans, resets and preserves the pins sidebar state", async ({ page }) => {
  await page.goto("/v/viewer-e2e");
  await page.getByRole("button", { name: "Open screenshot zoom" }).click();

  const zoomDialog = page.locator('[data-slot="dialog-content"]');
  const zoomIn = zoomDialog.getByRole("button", { name: "Zoom in" });
  const zoomOut = zoomDialog.getByRole("button", { name: "Zoom out" });
  const reset = zoomDialog.getByRole("button", { name: "Reset zoom" });
  const image = zoomDialog.getByRole("img", { name: "Viewer fixture" });

  await expect(zoomDialog.getByText("100%", { exact: true })).toBeVisible();
  for (let attempt = 0; attempt < 10; attempt += 1) await zoomIn.click();
  await expect(zoomDialog.getByText("800%", { exact: true })).toBeVisible();
  await expect(zoomIn).toBeDisabled();

  const stage = image.locator("..");
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) {
    const startX = bounds.x + bounds.width / 2;
    const startY = bounds.y + bounds.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 40, startY + 30, { steps: 4 });
    await page.mouse.up();
  }
  await expect(image).toHaveAttribute("style", /translate\((?:39|40)px, (?:29|30)px\) scale\(8\)/);

  await reset.click();
  await expect(zoomDialog.getByText("100%", { exact: true })).toBeVisible();
  await expect(image).toHaveAttribute("style", /transform: translate\(0px(?:, 0px)?\) scale\(1\);/);

  for (let attempt = 0; attempt < 4; attempt += 1) await zoomOut.click();
  await expect(zoomDialog.getByText("50%", { exact: true })).toBeVisible();
  await expect(zoomOut).toBeDisabled();
  await reset.click();
  await zoomDialog.getByRole("button", { name: "Close" }).click();

  await expect(page.getByTitle("Open pin 1")).toBeVisible();
  await page.getByRole("button", { name: "Hide pins sidebar" }).click();
  await expect(page.getByTitle("Open pin 1")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open screenshot zoom" })).toBeVisible();
  await page.getByRole("button", { name: "Show pins sidebar" }).click();
  await expect(page.getByTitle("Open pin 1")).toBeVisible();
});
