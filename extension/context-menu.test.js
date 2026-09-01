import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const extensionPackage = JSON.parse(
  readFileSync(new URL("../apps/extension/package.json", import.meta.url), "utf8"),
);

describe("extension action entry points", () => {
  test("keeps no action context menu, which Chrome could never localize", () => {
    // Chrome renders one menu title for every user, so the menu could only ever
    // be English. Keyboard commands carry the same two actions and do respect
    // the catalog in our own Shortcuts tab.
    assert.ok(!manifest.permissions.includes("contextMenus"));
    assert.doesNotMatch(backgroundSrc, /chrome\.contextMenus/);
    assert.doesNotMatch(backgroundSrc, /contexts: \["action"\]/);
    assert.doesNotMatch(backgroundSrc, /context_open_panel/);
  });

  test("reaches both actions through rebindable commands instead", () => {
    assert.ok(manifest.commands["open-panel"], "the panel needs a command now the menu is gone");
    assert.ok(manifest.commands["finish-batch"], "the batch needs a command now the menu is gone");
    assert.match(backgroundSrc, /command === PANEL_COMMAND/);
    assert.match(backgroundSrc, /void openApp\(\)/);
    assert.match(backgroundSrc, /command !== BATCH_COMMAND/);
    assert.match(backgroundSrc, /void toggleBatch\(\)/);
  });

  test("opens the default workspace in the user's language", () => {
    assert.match(backgroundSrc, /withLanguage\(`\$\{base\}\/app`\)/);
    assert.doesNotMatch(backgroundSrc, /browser-ticket|\/history/);
  });

  test("keeps the state surfaces on one snapshot", () => {
    assert.match(backgroundSrc, /async function syncBatchSurfaces\(\)/);
    assert.match(backgroundSrc, /chrome\.action\.setBadgeText/);
    assert.match(backgroundSrc, /type: "batch:changed"/);
  });

  test("ships a coherent identity", () => {
    assert.equal(manifest.name, "Pinar");
    assert.equal(manifest.version, "0.4.0");
    assert.equal(extensionPackage.version, manifest.version);
    assert.equal(manifest.homepage_url, "https://pinar.dev");
    assert.equal(manifest.default_locale, "en_US");
  });
});
