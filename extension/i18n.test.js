import assert from "node:assert/strict";
import test from "node:test";
import { getBestLanguage, translations } from "./i18n.js";

test("i18n translations dictionary", () => {
  const supportedLangs = ["en", "pt", "es", "fr", "de", "zh", "ja"];
  const requiredKeys = [
    "capture_destination_label",
    "collection_label",
    "context_open_panel",
    "destination_unavailable",
    "project_label",
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
