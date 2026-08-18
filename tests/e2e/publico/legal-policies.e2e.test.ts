import { expect, test } from "@playwright/test";

const legalDocuments = [
  ["Terms of Service", /Who operates Pinar/],
  ["Privacy Policy", /data controller/i],
  ["Acceptable Use Policy", /Prohibited conduct/i],
  ["Data Retention Policy", /90 days/i],
  ["Refund Policy", /14-day policy/i],
  ["Fair Source Notice", /Source-available, not Open Source/i],
  ["Service Providers and Subprocessors", /Cloudflare, Inc/i],
] as const;

test("visitor reads every versioned legal document and switches it to Portuguese", async ({ page }) => {
  await page.goto("/legal/terms");

  await expect(page.getByRole("heading", { name: "Terms of Service", level: 1 })).toBeVisible();
  await expect(page.getByText("Version and effective date: 2026-08-18", { exact: true })).toBeVisible();
  await expect(page.getByText("Djalma Araújo Júnior", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("djalmajr@gmail.com", { exact: false }).first()).toBeVisible();

  const legalNav = page.getByRole("navigation", { name: "Legal documents" }).first();
  for (const [title, content] of legalDocuments) {
    await legalNav.getByRole("link", { name: title, exact: true }).click();
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText(content).first()).toBeVisible();
  }

  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: "Português" }).click();
  await expect(page.getByRole("heading", { name: "Provedores de Serviço e Suboperadores", level: 1 })).toBeVisible();
  await expect(page.getByText("Versão e vigência: 2026-08-18", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Documentos legais" }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Provedores de Serviço e Suboperadores", level: 1 })).toBeVisible();
});
