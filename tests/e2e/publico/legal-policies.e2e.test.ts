import { expect, test } from "@playwright/test";

const legalDocuments = [
  ["terms", "Terms of Service", /Who operates Pinar/],
  ["privacy", "Privacy Policy", /data controller/i],
  ["acceptable-use", "Acceptable Use Policy", /Prohibited conduct/i],
  ["retention", "Data Retention Policy", /90 days/i],
  ["refunds", "Refund Policy", /14-day policy/i],
  ["fair-source", "Fair Source Notice", /Source-available, not Open Source/i],
  ["subprocessors", "Service Providers and Subprocessors", /Cloudflare, Inc/i],
] as const;

test("visitor reads every versioned legal document and switches it to Portuguese", async ({ page }) => {
  await page.goto("/legal/terms");

  await expect(page.getByRole("heading", { name: "Terms of Service", level: 1 })).toBeVisible();
  await expect(page.getByText("Version and effective date: 2026-08-18", { exact: true })).toBeVisible();
  await expect(page.getByText("Djalma Araújo Júnior", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("djalmajr@gmail.com", { exact: false }).first()).toBeVisible();

  const legalTabs = page.getByRole("tablist", { name: "Legal documents" });
  for (const [documentId, title, content] of legalDocuments) {
    await legalTabs.getByRole("tab", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/legal/${documentId}$`));
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText(content).first()).toBeVisible();
  }

  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: "Português" }).click();
  await expect(page.getByRole("heading", { name: "Provedores de Serviço e Suboperadores", level: 1 })).toBeVisible();
  await expect(page.getByText("Versão e vigência: 2026-08-18", { exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Documentos legais" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Provedores de Serviço e Suboperadores", level: 1 })).toBeVisible();
});

// Mutation captured: removing the brand/legal columns, restoring the full
// document list, or moving operational metadata above the divider breaks this hierarchy.
test("public footer keeps only primary legal links and opens the full policy tabs", async ({ page }) => {
  await page.goto("/pricing");

  const footer = page.getByRole("contentinfo");
  const brandLink = footer.getByRole("link", { name: "Pinar home" });
  const legalNav = footer.getByRole("navigation", { name: "Legal documents" });
  const legalLinks = legalNav.getByRole("link");
  const checkoutNote = footer.getByText("Secure checkout powered by Stripe", { exact: false });
  const copyright = footer.getByText(/^© \d{4} Pinar$/);
  const tagline = footer.getByText("Visual annotations for developers and AI agents.", { exact: true });
  const [brandLinkBox, footerBox, legalNavBox, checkoutNoteBox, copyrightBox, taglineBox] = await Promise.all([
    brandLink.boundingBox(),
    footer.boundingBox(),
    legalNav.boundingBox(),
    checkoutNote.boundingBox(),
    copyright.boundingBox(),
    tagline.boundingBox(),
  ]);

  if (!brandLinkBox || !footerBox || !legalNavBox || !checkoutNoteBox || !copyrightBox || !taglineBox) {
    throw new Error("Expected the footer brand, legal navigation, and metadata to have visible layout boxes.");
  }

  await expect(legalLinks).toHaveCount(2);
  await expect(legalLinks.nth(0)).toHaveText("Terms of Service");
  await expect(legalLinks.nth(1)).toHaveText("Privacy Policy");
  const isDesktop = (page.viewportSize()?.width ?? 0) >= 640;
  if (isDesktop) {
    expect(brandLinkBox.x).toBeLessThan(legalNavBox.x);
  } else {
    expect(legalNavBox.y).toBeGreaterThan(brandLinkBox.y);
  }
  expect(legalNavBox.width).toBeLessThan(footerBox.width * 0.7);
  expect(copyrightBox.y - (legalNavBox.y + legalNavBox.height)).toBeGreaterThanOrEqual(16);
  expect(checkoutNoteBox.y - (legalNavBox.y + legalNavBox.height)).toBeGreaterThanOrEqual(16);
  expect(copyrightBox.y).toBeGreaterThan(checkoutNoteBox.y);
  expect(taglineBox.y).toBeGreaterThanOrEqual(copyrightBox.y);

  await legalLinks.nth(0).click();
  await expect(page).toHaveURL(/\/legal\/terms$/);
  await expect(page.getByRole("tablist", { name: "Legal documents" }).getByRole("tab")).toHaveCount(legalDocuments.length);
});
