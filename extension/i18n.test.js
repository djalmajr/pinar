import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getBestLanguage, translations } from "./i18n.js";

test("i18n translations dictionary", () => {
  const requiredKeys = [
    "batch_copied_link",
    "batch_copied_prompt",
    "batch_finished",
    "capture_destination_label",
    "collection_label",
    "batch_label",
    "destination_unavailable",
    "project_label",
    "overlay_copied",
    "overlay_saved",
    "overlay_hint_pin",
    "overlay_hint_regions",
    "overlay_regions_on",
    "overlay_write_comment",
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

test("overlay hint long and short copy stay identical at every width", () => {
  for (const lang of Object.keys(translations)) {
    const pack = translations[lang];
    assert.equal(pack.overlay_hint_tune_long, pack.overlay_hint_tune_short, lang);
    assert.equal(pack.overlay_hint_copy_long, pack.overlay_hint_copy_short, lang);
    assert.equal(pack.overlay_hint_mask_long, pack.overlay_hint_mask_short, lang);
    assert.equal(pack.overlay_hint_clear_long, pack.overlay_hint_clear_short, lang);
  }
});

test("overlay copy is served through ui:messages and falls back to English", () => {
  const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
  const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
  assert.match(contentSrc, /type: "ui:messages"/);
  assert.match(backgroundSrc, /message\.type === "ui:messages"/);
  assert.match(backgroundSrc, /chrome\.storage\.onChanged/);
  assert.match(backgroundSrc, /changes\.language/);

  const fallbackMatch = contentSrc.match(/const FALLBACK_MESSAGES = \{[\s\S]*?\n  \};/);
  assert.ok(fallbackMatch, "content.js should keep an English fallback dictionary");
  const fallback = fallbackMatch[0];
  const outside = contentSrc.replace(fallback, "");
  const literals = [
    "Click or drag",
    "Adjust selection",
    "Copy",
    "Mask",
    "Cancel",
    "Regions",
    "Showing pins only",
    "Showing pins and regions",
    "Comment",
    "Add",
    "Original page is unavailable",
    "Click the correct element to place this pin",
    "Reviewing saved session · pending pins need a manual place",
    "Region hidden · click the mask to restore",
    "Drag to hide a region · click a mask to restore",
    "Pin mode",
    "Saving the annotations…",
    "Copied successfully!",
    "Annotations saved successfully!",
    "no screenshot",
    "helper unavailable",
    "no viewer",
    "Write a comment first",
    "Add a pin first",
    "Copy failed",
  ];
  for (const literal of literals) {
    const quoted = `"${literal}"`;
    assert.ok(fallback.includes(quoted), `fallback missing ${literal}`);
    assert.equal(outside.includes(quoted), false, `${literal} still appears outside the fallback dictionary`);
  }
});
