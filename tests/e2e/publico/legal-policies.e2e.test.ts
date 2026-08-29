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
  await expect(page.getByText("Version and effective date: 2026-08-25", { exact: true })).toBeVisible();
  await expect(page.getByText("Djalma Júnior", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("contact@pinar.dev", { exact: false }).first()).toBeVisible();

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
  await expect(page.getByText("Versão e vigência: 2026-08-25", { exact: true })).toBeVisible();
  await expect(page.getByText("contato@pinar.dev", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Documentos legais" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Provedores de Serviço e Suboperadores", level: 1 })).toBeVisible();
});

// Mutation captured: removing the brand/legal columns, restoring the full
// document list, or moving operational metadata above the divider breaks this hierarchy.
test("public footer keeps only primary legal links and opens the full policy tabs", async ({ page }) => {
  await page.goto("/");

  const footer = page.getByRole("contentinfo");
  const brandLink = footer.getByRole("link", { name: "Pinar home" });
  const legalNav = footer.getByRole("navigation", { name: "Legal documents" });
  const legalLinks = legalNav.getByRole("link");
  const checkoutNote = footer.getByText("Secure checkout powered by Stripe", { exact: false });
  const copyright = footer.getByText(/^© \d{4}$/);
  const [brandLinkBox, footerBox, legalNavBox, copyrightBox] = await Promise.all([
    brandLink.boundingBox(),
    footer.boundingBox(),
    legalNav.boundingBox(),
    copyright.boundingBox(),
  ]);

  if (!brandLinkBox || !footerBox || !legalNavBox || !copyrightBox) {
    throw new Error("Expected the footer brand, legal navigation, and copyright to have visible layout boxes.");
  }

  await expect(legalLinks).toHaveCount(2);
  await expect(legalLinks.nth(0)).toHaveText("Terms of Service");
  await expect(legalLinks.nth(1)).toHaveText("Privacy Policy");
  await expect(checkoutNote).toHaveCount(0);
  const isDesktop = (page.viewportSize()?.width ?? 0) >= 640;
  if (isDesktop) {
    expect(brandLinkBox.x).toBeLessThan(legalNavBox.x);
    expect(Math.abs(copyrightBox.y - legalNavBox.y)).toBeLessThanOrEqual(8);
  } else {
    expect(legalNavBox.y).toBeGreaterThan(brandLinkBox.y);
  }
  expect(legalNavBox.width).toBeLessThan(footerBox.width * 0.7);

  await legalLinks.nth(0).click();
  await expect(page).toHaveURL(/\/legal\/terms$/);
  await expect(page.getByRole("tablist", { name: "Legal documents" }).getByRole("tab")).toHaveCount(legalDocuments.length);
});
