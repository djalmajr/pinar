import assert from "node:assert/strict";
import test from "node:test";
import { getBestLanguage, translations } from "./i18n.js";

test("i18n translations dictionary", () => {
  const supportedLangs = ["en", "pt", "es", "fr", "de", "zh", "ja"];
  const requiredKeys = [
    "capture_destination_label",
    "collection_label",
    "destination_unavailable",
    "header_title",
    "header_desc",
    "storage_title",
    "local_title",
    "local_desc",
    "install_hint",
    "remote_title",
    "remote_desc",
    "plan_free",
    "plan_pro",
    "btn_upgrade_pro",
    "btn_manage_sub",
    "license_placeholder",
    "btn_activate",
    "btn_deactivate",
    "license_activated",
    "license_invalid",
    "preferences_title",
    "project_label",
    "history_label",
    "history_desc",
    "viewer_label",
    "viewer_desc",
    "btn_history",
    "btn_coffee",
    "btn_sponsor",
    "btn_save",
    "status_saved",
    "btn_copy",
    "status_copied",
  ];

  supportedLangs.forEach((lang) => {
    assert.ok(translations[lang], `Language '${lang}' should exist in translations`);
    assert.ok(translations[lang].name, `Language '${lang}' should have a display name`);
    requiredKeys.forEach((key) => {
      assert.ok(translations[lang][key], `Language '${lang}' should have translation for '${key}'`);
      assert.strictEqual(typeof translations[lang][key], "string");
    });
  });
});

test("getBestLanguage resolution", () => {
  assert.strictEqual(getBestLanguage("pt", ["de-DE"]), "pt");
  assert.strictEqual(getBestLanguage(undefined, ["es-MX"]), "es");
  assert.strictEqual(getBestLanguage(undefined, ["it-IT", "fr-FR"]), "fr");
  assert.strictEqual(getBestLanguage("invalid", ["it-IT"]), "en");
});
