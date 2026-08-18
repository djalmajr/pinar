import { expect, test } from "@playwright/test";

test.use({ locale: "pt-BR" });

// Mutation captured: replacing locale detection with `preferred || "en"`
// makes the first Portuguese heading assertion fail for a fresh pt-BR context.
test("fresh pt-BR visitor starts in Portuguese and a manual language wins later", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Aponte o problema. Compartilhe todo o contexto." })).toBeVisible();
  await page.getByRole("button", { name: "Idioma" }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Point to the problem. Share the complete context." })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("heading", { name: "Point to the problem. Share the complete context." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Language" })).toBeVisible();
});
