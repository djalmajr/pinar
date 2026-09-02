import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { translations } from "./i18n.js";

const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const extensionPackage = JSON.parse(
  readFileSync(new URL("../apps/extension/package.json", import.meta.url), "utf8"),
);

describe("extension action entry points", () => {
  test("every everyday action is a rebindable command", () => {
    assert.ok(manifest.commands["open-panel"]);
    assert.ok(manifest.commands["finish-batch"]);
    assert.ok(manifest.commands["cancel-batch"]);
    // Chrome allows four commands with a default key, _execute_action included.
    const withDefault = Object.values(manifest.commands).filter((c) => c.suggested_key?.default);
    assert.equal(withDefault.length, 4);
    assert.match(backgroundSrc, /command === PANEL_COMMAND/);
    assert.match(backgroundSrc, /command === CANCEL_BATCH_COMMAND/);
    assert.match(backgroundSrc, /command !== BATCH_COMMAND/);
  });

  test("the action menu mirrors the commands, in the extension's language", () => {
    // The toolbar fades under the pointer, so it cannot host a click. The menu
    // is the pointer path: open the panel, start/finish the batch, and close
    // it without copying while one runs. Every title is our own string set at
    // runtime, so it follows the language chosen in Options - never the
    // English catalog, which was the old menu's mistake.
    assert.ok(manifest.permissions.includes("contextMenus"));
    const menu = backgroundSrc.slice(
      backgroundSrc.indexOf("function menuItem("),
      backgroundSrc.indexOf("chrome.tabs.onRemoved"),
    );
    assert.match(menu, /translations\[getBestLanguage\(settings\.language\)\]/);
    assert.doesNotMatch(menu, /translations\.en/);
    assert.match(menu, /messages\.context_open_panel/);
    assert.match(menu, /messages\.batch_finish/);
    assert.match(menu, /messages\.batch_start/);
    assert.match(menu, /title: messages\.batch_close_menu, visible: active/);
    assert.match(menu, /finishBatch\(\{ copy: false \}\)/);
    assert.match(menu, /void toggleBatch\(\)/);
    assert.match(menu, /void openApp\(\)/);
    for (const lang of Object.keys(translations)) {
      for (const key of ["context_open_panel", "batch_start", "batch_finish", "batch_close_menu"]) assert.ok(translations[lang][key], `${lang}.${key}`);
    }
  });

  test("the batch label shown on the pill, badge and menu follows the extension language", () => {
    const state = backgroundSrc.slice(backgroundSrc.indexOf("async function batchState()"), backgroundSrc.indexOf("async function syncBatchSurfaces"));
    assert.match(state, /translations\[getBestLanguage\(settings\.language\)\]/);
    assert.doesNotMatch(state, /translations\.en/);
  });

  test("the menu title is refreshed when the language or the batch changes", () => {
    assert.match(backgroundSrc, /async function syncBatchSurfaces[\s\S]*?await syncActionMenu\(state\)/);
    assert.match(backgroundSrc, /changes\.language[\s\S]*?syncActionMenu/);
  });

  test("closing without copying never touches the clipboard", () => {
    const finish = backgroundSrc.slice(
      backgroundSrc.indexOf("async function finishBatch("),
      backgroundSrc.indexOf("async function toggleBatch"),
    );
    assert.match(finish, /\{ copy = true \} = \{\}/);
    assert.match(finish, /if \(copy && summary\.saved > 0\)/);
    assert.match(finish, /copy \? finishedBatchToastKey\(copied\) : "batch_closed"/);
  });

  test("opens the default workspace in the user's language", () => {
    assert.match(backgroundSrc, /withLanguage\(`\$\{base\}\/app`\)/);
    assert.doesNotMatch(backgroundSrc, /browser-ticket|\/history/);
  });

  test("ships a coherent identity", () => {
    // The name heads the action menu, chrome://extensions and the store listing.
    assert.equal(manifest.name, "Pinar.dev");
    assert.equal(manifest.version, "0.4.0");
    assert.equal(extensionPackage.version, manifest.version);
    assert.equal(manifest.homepage_url, "https://pinar.dev");
    assert.equal(manifest.default_locale, "en_US");
  });
});
