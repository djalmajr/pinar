import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const routeTree = readFileSync(new URL("../routeTree.gen.ts", import.meta.url), "utf8");
const appRoute = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");

describe("public and private route matrix", () => {
  test("keeps public pages and moves the private workspace to /app", () => {
    for (const path of ["/", "/pricing", "/sign-in", "/success", "/app"]) {
      assert.match(routeTree, new RegExp(`['\"]${path.replace("/", "\\/")}['\"]`));
    }
    assert.doesNotMatch(routeTree, /['"]\/history['"]/);
  });

  test("protects the remote app on the server with an internal sign-in redirect", () => {
    assert.match(appRoute, /authorizeAppRequest\(request\)/);
    assert.match(appRoute, /Location: "\/sign-in\?returnTo=%2Fapp"/);
    assert.match(appRoute, /status: 302/);
  });
});
