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
    assert.equal(manifest.commands["finish-batch"], undefined);
    assert.ok(manifest.commands["cancel-batch"]);
    // Chrome allows four commands with a default key, _execute_action included.
    const withDefault = Object.values(manifest.commands).filter((c) => c.suggested_key?.default);
    assert.equal(withDefault.length, 3);
    assert.match(backgroundSrc, /command === PANEL_COMMAND/);
    assert.match(backgroundSrc, /command === CANCEL_BATCH_COMMAND/);
    assert.doesNotMatch(backgroundSrc, /const BATCH_COMMAND/);
  });

  test("the action menu mirrors the commands, in the extension's language", () => {
    // The toolbar fades under the pointer, so it cannot host a click. The menu
    // is the pointer path for every command except _execute_action: open the
    // panel, start/finish the batch, and close it without copying. Close stays
    // listed even with no batch so the menu matches the shortcuts page.
    // Every title is our own string set at runtime, so it follows the language
    // chosen in Options - never the English catalog, which was the old menu's
    // mistake.
    assert.ok(manifest.permissions.includes("contextMenus"));
    const menu = backgroundSrc.slice(
      backgroundSrc.indexOf("function menuItem("),
      backgroundSrc.indexOf("chrome.tabs.onRemoved"),
    );
    assert.match(menu, /translations\[getBestLanguage\(settings\.language\)\]/);
    assert.doesNotMatch(menu, /translations\.en/);
    assert.match(menu, /messages\.context_open_panel/);
    assert.match(menu, /messages\.batch_finish/);
    assert.match(menu, /title: messages\.batch_close_menu, visible: true/);
    assert.doesNotMatch(menu, /visible: active/);
    assert.match(menu, /cancelReview\(\)/);
    assert.match(menu, /void concludeReview\(\)/);
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

  test("the action badge counts pins instead of pages", () => {
    const surfaces = backgroundSrc.slice(
      backgroundSrc.indexOf("async function syncBatchSurfaces"),
      backgroundSrc.indexOf("function overlayMessages"),
    );
    assert.match(surfaces, /state\.pins > 0 \? String\(state\.pins\) : "on"/);
    assert.doesNotMatch(surfaces, /state\.count > 0 \? String\(state\.count\) : "on"/);
  });

  test("the batch shortcut follows the browser platform without a Ctrl fallback", () => {
    const state = backgroundSrc.slice(backgroundSrc.indexOf("async function batchState()"), backgroundSrc.indexOf("async function syncBatchSurfaces"));
    assert.match(state, /getPlatformInfo/);
    assert.match(state, /platform\.os === "mac" \? "Command\+Enter" : "Alt\+Enter"/);
    assert.doesNotMatch(state, /Ctrl\+Enter/);
  });

  test("the menu title is refreshed when the language or the batch changes", () => {
    assert.match(backgroundSrc, /async function syncBatchSurfaces[\s\S]*?await syncActionMenu\(state\)/);
    assert.match(backgroundSrc, /changes\.language[\s\S]*?syncActionMenu/);
  });

  test("closing without copying never touches the clipboard", () => {
    const finish = backgroundSrc.slice(
      backgroundSrc.indexOf("async function finishBatch("),
      backgroundSrc.indexOf("async function getAuthSession"),
    );
    assert.match(finish, /\{ copy = true \} = \{\}/);
    assert.match(finish, /if \(copy && summary\.saved > 0\)/);
    assert.match(finish, /copy \? "batch_finished" : "batch_closed"/);
  });

  test("cancelling abandons pending local work and always closes review", () => {
    const cancel = backgroundSrc.slice(
      backgroundSrc.indexOf("async function cancelReview()"),
      backgroundSrc.indexOf("async function removeReviewPin("),
    );
    assert.match(cancel, /continuous\.abandon\(\)/);
    assert.match(cancel, /finishReviewDraft\(draft\)\.catch/);
    assert.match(cancel, /endReviewTabs\("cancelled"\)/);
    assert.doesNotMatch(cancel, /continuous\.finish|session_pending/);
    assert.match(backgroundSrc, /message\.type === "batch:cancel"[\s\S]*?cancelReview\(\)/);
  });

  test("opens the default workspace in the user's language", () => {
    assert.match(backgroundSrc, /withLanguage\(`\$\{base\}\/app`\)/);
    const openApp = backgroundSrc.slice(backgroundSrc.indexOf("async function openApp()"), backgroundSrc.indexOf("async function saveShot"));
    assert.doesNotMatch(openApp, /browser-ticket|\/history/);
  });

  test("ships a coherent identity", () => {
    // The name heads the action menu, chrome://extensions and the store listing.
    assert.equal(manifest.name, "Pinar.dev");
    assert.equal(manifest.version, "0.6.2");
    assert.equal(extensionPackage.version, manifest.version);
    assert.equal(manifest.homepage_url, "https://pinar.dev");
    assert.equal(manifest.default_locale, "en_US");
    assert.equal(manifest.permissions.includes("notifications"), false);
  });
});
