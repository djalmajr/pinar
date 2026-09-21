import { expect, test } from "@playwright/test";

test.use({ locale: "pt-BR" });

test("help search results overlay the article list without shifting it", async ({ page }) => {
  await page.goto("/help/captures");

  const heading = page.getByRole("heading", { name: "Capturas e pins" });
  const search = page.getByRole("combobox", {
    name: "Pesquisar na Central de Ajuda",
  });
  const initialBox = await heading.boundingBox();
  expect(initialBox).not.toBeNull();

  await search.fill("e");
  await expect(
    page.getByRole("listbox", { name: "Resultados da pesquisa" }),
  ).toBeVisible();

  const clearSearch = page.getByRole("button", { name: "Limpar busca" });
  const shortcut = page.locator("kbd");
  await expect(clearSearch).toBeVisible();
  await expect(clearSearch.locator("svg")).toHaveCount(1);
  await expect(shortcut.locator("svg")).toHaveCount(1);
  await expect(shortcut).toHaveCSS("font-family", /mono/i);

  const clearBox = await clearSearch.boundingBox();
  const shortcutBox = await shortcut.boundingBox();
  expect(clearBox).not.toBeNull();
  expect(shortcutBox).not.toBeNull();
  expect(
    (shortcutBox?.x ?? 0) -
      ((clearBox?.x ?? 0) + (clearBox?.width ?? 0)),
  ).toBeCloseTo(12, 0);

  await clearSearch.click();
  await expect(search).toHaveValue("");
  await expect(clearSearch).toBeHidden();

  const openBox = await heading.boundingBox();
  expect(openBox).not.toBeNull();
  expect(openBox?.y).toBeCloseTo(initialBox?.y ?? 0, 0);
});
