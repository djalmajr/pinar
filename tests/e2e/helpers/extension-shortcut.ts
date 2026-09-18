import type { Page } from "@playwright/test";

export async function pressCopyShortcut(page: Page): Promise<void> {
  const apple = await page.evaluate(() => {
    const label = document.querySelector<HTMLElement>('[data-pinar="host"]')
      ?.shadowRoot?.querySelector('[data-hint="copy"] kbd')?.textContent;
    if (label) return label.includes("⌘");
    return /mac|iphone|ipad|ipod/i.test(
      `${(navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`,
    );
  });
  await page.keyboard.press(apple ? "Meta+Enter" : "Alt+Enter");
}
