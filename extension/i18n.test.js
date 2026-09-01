import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getBestLanguage, translations } from "./i18n.js";

test("i18n translations dictionary", () => {
  const requiredKeys = [
    "capture_destination_label",
    "collection_label",
    "batch_label",
    "destination_unavailable",
    "project_label",
  ];

  for (const lang of Object.keys(translations)) {
    assert.ok(translations[lang], `Language '${lang}' should exist in translations`);
    assert.ok(translations[lang].name, `Language '${lang}' should have a display name`);
    requiredKeys.forEach((key) => {
      assert.ok(translations[lang][key], `Language '${lang}' should have translation for '${key}'`);
      assert.strictEqual(typeof translations[lang][key], "string");
    });
  }
});

test("checked-in i18n.js is byte-identical to a fresh generation from the shared catalog", () => {
  const script = fileURLToPath(new URL("../scripts/generate-extension-i18n.mjs", import.meta.url));
  const generated = execFileSync("bun", [script, "--stdout"]);
  const checkedIn = readFileSync(new URL("./i18n.js", import.meta.url));
  assert.deepEqual(checkedIn, generated);
});

test("getBestLanguage resolution", () => {
  assert.strictEqual(getBestLanguage("pt", ["de-DE"]), "pt");
  assert.strictEqual(getBestLanguage(undefined, ["es-MX"]), "en");
  assert.strictEqual(getBestLanguage(undefined, ["it-IT", "fr-FR"]), "en");
  assert.strictEqual(getBestLanguage("invalid", ["it-IT"]), "en");
});

test("getBestLanguage ignores browser language so the shipped extension stays English", () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "de-DE", languages: ["ja-JP", "de-DE"] },
    });
    assert.strictEqual(getBestLanguage(), "en");

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "pt-BR", languages: ["pt-BR"] },
    });
    assert.strictEqual(getBestLanguage(), "en");

    Reflect.deleteProperty(globalThis, "navigator");
    assert.strictEqual(getBestLanguage(), "en");
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
