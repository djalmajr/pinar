import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const routeTree = readFileSync(new URL("../routeTree.gen.ts", import.meta.url), "utf8");
const appRoute = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
const viewerRoute = readFileSync(new URL("./v/$id.tsx", import.meta.url), "utf8");

describe("public and private route matrix", () => {
  test("keeps public pages and moves the private workspace to /app", () => {
    for (const path of ["/", "/pricing", "/sign-in", "/success", "/app", "/help", "/help/$category", "/help/$category/$article", "/releases", "/releases/$version", "/legal/$document"]) {
      const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(routeTree, new RegExp(`['\"]${escapedPath}['\"]`));
    }
    assert.doesNotMatch(routeTree, /['"]\/docs['"]/);
    assert.doesNotMatch(routeTree, /['"]\/history['"]/);
  });

  test("protects the remote app on the server with an internal sign-in redirect", () => {
    assert.match(appRoute, /authorizeAppRequest\(request\)/);
    assert.match(appRoute, /Location: "\/sign-in\?returnTo=%2Fapp"/);
    assert.match(appRoute, /status: 302/);
  });

  test("opens the local capture viewer as a workspace modal instead of a page", () => {
    assert.match(appRoute, /validateSearch/);
    assert.match(appRoute, /viewerSessionId=\{session\}/);
    assert.match(viewerRoute, /shouldUseWorkspaceChrome\(pinarRuntime\(\)\)/);
    assert.match(viewerRoute, /<Navigate replace search=\{\{ session: id \}\} to="\/app" \/>/);
  });
});
