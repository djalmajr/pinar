import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const CAPTURE_TITLE = "Extension authorized capture";
const extensionDir = resolve(process.cwd(), "extension");

test.describe("loaded Chrome extension local persist", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "MV3 loading is Chromium-only");

  test("pairs, rejects a missing/invalid capability, and persists into the workspace", async ({ baseURL }) => {
    const context = await chromium.launchPersistentContext("", {
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
      channel: "chromium",
      headless: true,
    });
    try {
      let worker = context.serviceWorkers()[0];
      if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
      const result = await worker.evaluate(async ({ api, id, image, title }) => {
        const missing = await fetch(`${api}/api/shots`, {
          body: JSON.stringify({ id: `${id}-missing`, image, page: { title, url: "https://example.test/ext" }, pins: [] }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const pairing = await fetch(`${api}/api/local/capability`);
        const body = await pairing.json().catch(() => ({}));
        const token = typeof body.token === "string" ? body.token : "";
        const invalid = await fetch(`${api}/api/shots`, {
          body: JSON.stringify({ id: `${id}-invalid`, image, pins: [] }),
          headers: { "content-type": "application/json", "x-pinar-capability": "not-the-secret" },
          method: "POST",
        });
        const authorized = await fetch(`${api}/api/shots`, {
          body: JSON.stringify({
            id,
            image,
            page: { title, url: "https://example.test/ext-authorized" },
            pins: [{ comment: "extension pin", kind: "element" }],
          }),
          headers: { "content-type": "application/json", "x-pinar-capability": token },
          method: "POST",
        });
        return {
          authorized: authorized.status,
          invalid: invalid.status,
          leaked: (await invalid.text()).includes(token),
          missing: missing.status,
          pairing: pairing.status,
        };
      }, { api: baseURL, id: "e2e_ext_session", image: VALID_PNG, title: CAPTURE_TITLE });

      expect(result.missing).toBe(401);
      expect(result.pairing).toBe(200);
      expect(result.invalid).toBe(401);
      expect(result.leaked).toBe(false);
      expect(result.authorized).toBe(201);

      const page = await context.newPage();
      await page.goto(`${baseURL}/app`);
      await expect(page.getByRole("heading", { name: CAPTURE_TITLE })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
