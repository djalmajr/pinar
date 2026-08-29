import { expect, test } from "@playwright/test";
import { primaryNavigationItem } from "../helpers/ui";

const PINAR_CLOUD_ORIGIN = "https://pinar.dev";

test("local landing keeps workspace access without store, plans or sign-in", async ({ page }) => {
  await page.goto("/");

  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Open local dashboard", exact: true })).toHaveAttribute("href", "/app");
  await expect(main.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Compare plans", exact: true })).toHaveCount(0);
  await expect(main.getByRole("link", { name: /Chrome Web Store|Install/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Share when you need to" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Private by default" })).toBeVisible();
  await expect(await primaryNavigationItem(page, "Open app")).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { exact: true, name: "Plans" })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { exact: true, name: "Sign in" })).toHaveCount(0);
});

test("local helper sends account and billing routes to pinar.dev", async ({ request }) => {
  const pricing = await request.get("/pricing", { maxRedirects: 0 });
  expect(pricing.status()).toBe(302);
  expect(pricing.headers().location).toBe(`${PINAR_CLOUD_ORIGIN}/pricing`);

  const signIn = await request.get("/sign-in?returnTo=%2Fapp", { maxRedirects: 0 });
  expect(signIn.status()).toBe(302);
  expect(signIn.headers().location).toBe(`${PINAR_CLOUD_ORIGIN}/sign-in?returnTo=%2Fapp`);

  const success = await request.get("/success?session_id=cs_test&claim=abc", { maxRedirects: 0 });
  expect(success.status()).toBe(302);
  expect(success.headers().location).toBe(`${PINAR_CLOUD_ORIGIN}/success?session_id=cs_test&claim=abc`);
});

test("local helper does not expose cloud pricing or checkout APIs", async ({ request }) => {
  const pricing = await request.get("/api/pricing");
  expect(pricing.status()).toBe(404);
  expect(await pricing.json()).toEqual({ error: "not found" });

  const checkout = await request.post("/api/stripe/checkout", {
    data: { interval: "year" },
    headers: { "content-type": "application/json" },
  });
  expect(checkout.status()).toBe(404);
  expect(await checkout.json()).toEqual({ error: "not found" });
});
