import { expect, test } from "@playwright/test";

test("visitor understands local privacy and reaches both verified sponsorship destinations", async ({ context, page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { session: { installationId: "ins_public_support", kind: "installation", plan: "free" } },
  }));
  await context.route("https://buymeacoffee.com/djalmajr", (route) => route.fulfill({
    body: "<h1>Buy Me a Coffee</h1>",
    contentType: "text/html",
  }));
  await context.route("https://github.com/sponsors/djalmajr", (route) => route.fulfill({
    body: "<h1>GitHub Sponsors</h1>",
    contentType: "text/html",
  }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Private by default" })).toBeVisible();
  await expect(page.getByText("Your screenshots and annotations remain on your device.", { exact: false })).toBeVisible();

  const support = page.getByRole("region", { name: "Support Fair Source development" });
  const coffee = support.getByRole("link", { name: "Buy Me a Coffee" });
  const sponsor = support.getByRole("link", { name: "Sponsor on GitHub" });
  await expect(coffee).toHaveAttribute("target", "_blank");
  await expect(coffee).toHaveAttribute("rel", "noopener noreferrer");
  await expect(sponsor).toHaveAttribute("target", "_blank");
  await expect(sponsor).toHaveAttribute("rel", "noopener noreferrer");

  const coffeePopupPromise = page.waitForEvent("popup");
  await coffee.click();
  const coffeePopup = await coffeePopupPromise;
  await expect(coffeePopup).toHaveURL("https://buymeacoffee.com/djalmajr");
  await coffeePopup.close();

  const sponsorPopupPromise = page.waitForEvent("popup");
  await sponsor.click();
  const sponsorPopup = await sponsorPopupPromise;
  await expect(sponsorPopup).toHaveURL("https://github.com/sponsors/djalmajr");
  await sponsorPopup.close();
});

test("Unix and PowerShell installer routes return executable text instead of HTML", async ({ request }) => {
  const unix = await request.get("/install.sh");
  expect(unix.status()).toBe(200);
  expect(unix.headers()["content-type"]).toContain("text/plain");
  const unixBody = await unix.text();
  expect(unixBody).toMatch(/^#!\/bin\/sh/);
  expect(unixBody).toContain("macos-arm64-Pinar.dmg");
  expect(unixBody).toContain("pinar");
  expect(unixBody).not.toMatch(/<html/i);

  const powershell = await request.get("/install.ps1");
  expect(powershell.status()).toBe(200);
  expect(powershell.headers()["content-type"]).toContain("text/plain");
  const powershellBody = await powershell.text();
  expect(powershellBody).toMatch(/ErrorActionPreference|Invoke-WebRequest/i);
  expect(powershellBody).toContain("pinar");
  expect(powershellBody).not.toMatch(/<html/i);
});
