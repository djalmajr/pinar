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

  test("the action menu carries only the rare action, in the extension's language", () => {
    // The toolbar fades under the pointer, so it cannot host a click; the last
    // default-key slot went to the shortcut. The menu is the pointer path for
    // closing a batch without copying, and nothing else. Its title is our own
    // string set at runtime, so it follows the language chosen in Options -
    // never the English catalog, which was the old menu's mistake.
    assert.ok(manifest.permissions.includes("contextMenus"));
    const menu = backgroundSrc.slice(
      backgroundSrc.indexOf("async function syncCancelBatchMenu"),
      backgroundSrc.indexOf("chrome.tabs.onRemoved"),
    );
    assert.match(menu, /translations\[getBestLanguage\(settings\.language\)\]\.batch_close_menu/);
    assert.doesNotMatch(menu, /translations\.en/);
    assert.match(menu, /visible: Boolean\(state\?\.active\)/);
    assert.equal((backgroundSrc.match(/chrome\.contextMenus\.create\(/g) ?? []).length, 1);
    assert.match(menu, /finishBatch\(\{ copy: false \}\)/);
    for (const lang of Object.keys(translations)) assert.ok(translations[lang].batch_close_menu);
  });

  test("the menu title is refreshed when the language or the batch changes", () => {
    assert.match(backgroundSrc, /async function syncBatchSurfaces[\s\S]*?await syncCancelBatchMenu\(state\)/);
    assert.match(backgroundSrc, /changes\.language[\s\S]*?syncCancelBatchMenu/);
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
    assert.equal(manifest.name, "Pinar");
    assert.equal(manifest.version, "0.4.0");
    assert.equal(extensionPackage.version, manifest.version);
    assert.equal(manifest.homepage_url, "https://pinar.dev");
    assert.equal(manifest.default_locale, "en_US");
  });
});
