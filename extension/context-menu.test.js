import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { translations } from "./i18n.js";

const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const extensionPackage = JSON.parse(
  readFileSync(new URL("../apps/extension/package.json", import.meta.url), "utf8"),
);

describe("extension action context menu", () => {
  test("declares the context menu permission and registers an action item", () => {
    assert.ok(manifest.permissions.includes("contextMenus"));
    assert.equal(manifest.name, "Pinar");
    assert.equal(manifest.version, "0.4.0");
    assert.equal(extensionPackage.version, manifest.version);
    assert.equal(manifest.homepage_url, "https://pinar.dev");
    assert.match(backgroundSrc, /contexts: \["action"\]/);
    assert.match(backgroundSrc, /title: translations\.en\.context_open_panel/);
    assert.match(backgroundSrc, /chrome\.contextMenus\.onClicked\.addListener/);
  });

  test("opens the default workspace", () => {
    assert.match(backgroundSrc, /info\.menuItemId === OPEN_PANEL_MENU_ID/);
    assert.match(backgroundSrc, /void openApp\(\)/);
    assert.match(backgroundSrc, /withLanguage\(`\$\{base\}\/app`\)/);
    assert.doesNotMatch(backgroundSrc, /browser-ticket|\/history/);
  });

  test("offers a batch entry that toggles and stays English", () => {
    assert.match(backgroundSrc, /id: BATCH_MENU_ID/);
    assert.match(backgroundSrc, /info\.menuItemId !== BATCH_MENU_ID/);
    assert.match(backgroundSrc, /void toggleBatch\(\)/);
    assert.match(backgroundSrc, /messages\.batch_start/);
    // The action menu stays English like context_open_panel; see the store-listing test.
    assert.match(backgroundSrc, /async function batchMenuTitle\(\) \{\n  const messages = translations\.en;/);
    assert.doesNotMatch(backgroundSrc, /batchMenuTitle[\s\S]{0,200}getBestLanguage/);
    assert.match(backgroundSrc, /messages\.batch_active\.replace\("\{count\}"/);
  });

  test("keeps the key, the menu and the badge on one snapshot", () => {
    // The shortcut toggles, so a batch can start without the mouse.
    assert.match(backgroundSrc, /command !== BATCH_COMMAND/);
    assert.match(backgroundSrc, /const BATCH_COMMAND = "finish-batch"/);
    // Every surface refreshes from the same call, so none of them can go stale.
    assert.match(backgroundSrc, /async function syncBatchSurfaces\(\)/);
    assert.match(backgroundSrc, /chrome\.action\.setBadgeText/);
    assert.match(backgroundSrc, /type: "batch:changed"/);
    assert.doesNotMatch(backgroundSrc, /refreshBatchMenu/);
  });

  test("keeps the Chrome action menu in English for the global store listing", () => {
    assert.equal(manifest.default_locale, "en_US");
    assert.match(backgroundSrc, /title: translations\.en\.context_open_panel/);
    assert.doesNotMatch(backgroundSrc, /changes\.language/);
    assert.equal(translations.en.context_open_panel, "Open Panel");
  });
});
