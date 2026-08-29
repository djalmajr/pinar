import { expect, test } from "@playwright/test";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const CAPTURE_TITLE = "Authorized local persist";

test("same-origin workspace can persist a capture and see it in the workspace", async ({ page }) => {
  await page.goto("/app");
  const uploaded = await page.evaluate(async ({ image, title }) => {
    const response = await fetch("/api/shots", {
      body: JSON.stringify({
        id: "e2e_authorized_persist",
        image,
        page: { title, url: "https://example.test/authorized-persist" },
        pins: [{ comment: "Workspace authorized pin", kind: "element" }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return { status: response.status };
  }, { image: VALID_PNG, title: CAPTURE_TITLE });
  expect(uploaded.status).toBe(201);

  await page.reload();
  await expect(page.getByRole("heading", { name: CAPTURE_TITLE })).toBeVisible();
  const tree = await page.evaluate(async () => {
    const response = await fetch("/api/project-tree", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    return { hasTree: Boolean(body.tree), status: response.status };
  });
  expect(tree.status).toBe(200);
  expect(tree.hasTree).toBe(true);
});

test("a hostile page cannot read or mutate the local API", async ({ baseURL, page }) => {
  await page.route("https://evil.example/**", (route) => route.fulfill({
    body: "<!doctype html><title>evil</title>",
    contentType: "text/html",
  }));
  await page.goto("https://evil.example/");
  const result = await page.evaluate(async (api) => {
    const read = async (path: string, init?: RequestInit) => {
      try {
        const response = await fetch(`${api}${path}`, init);
        return { ok: true, status: response.status };
      } catch {
        return { ok: false, status: 0 };
      }
    };
    return {
      health: await read("/api/health"),
      history: await read("/api/history"),
      preflight: await read("/api/shots", {
        headers: {
          "access-control-request-headers": "content-type, x-pinar-capability",
          "access-control-request-method": "POST",
        },
        method: "OPTIONS",
      }),
      shots: await read("/api/shots", {
        body: JSON.stringify({
          id: "hostile-e2e",
          image: "data:image/png;base64,aG9zdGlsZQ==",
          pins: [{ comment: "should not persist" }],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    };
  }, baseURL);
  expect(result.health.ok).toBe(false);
  expect(result.history.ok).toBe(false);
  expect(result.preflight.ok).toBe(false);
  expect(result.shots.ok).toBe(false);
});
