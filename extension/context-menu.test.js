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
    assert.equal(manifest.name, "Pinar.dev");
    assert.equal(manifest.version, "0.2.0");
    assert.equal(extensionPackage.version, manifest.version);
    assert.equal(manifest.homepage_url, "https://pinar.dev");
    assert.match(backgroundSrc, /contexts: \["action"\]/);
    assert.match(backgroundSrc, /title: messages\.context_open_panel/);
    assert.match(backgroundSrc, /chrome\.contextMenus\.onClicked\.addListener/);
  });

  test("opens the configured Pinar homepage", () => {
    assert.match(backgroundSrc, /info\.menuItemId !== OPEN_PANEL_MENU_ID/);
    assert.match(backgroundSrc, /void openApp\(\)/);
    assert.match(backgroundSrc, /withLanguage\(`\$\{base\}\/`\)/);
    assert.doesNotMatch(backgroundSrc, /browser-ticket|\/history/);
  });

  test("localizes the panel label for every supported extension language", () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(translations).map(([language, messages]) => [language, messages.context_open_panel])),
      {
        de: "Panel öffnen",
        en: "Open Panel",
        es: "Abrir panel",
        fr: "Ouvrir le panneau",
        ja: "パネルを開く",
        pt: "Abrir painel",
        zh: "打开面板",
      },
    );
    assert.match(backgroundSrc, /changes\.language/);
  });
});
