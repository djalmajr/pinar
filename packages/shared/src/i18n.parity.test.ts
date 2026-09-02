import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SUPPORTED_LANGUAGES } from "./types/index.js";
import { translations } from "./i18n/index.js";

describe("shared translation catalog", () => {
  test("ships every key in every language", () => {
    const expected = Object.keys(translations.en).sort();
    for (const language of SUPPORTED_LANGUAGES) {
      assert.deepEqual(Object.keys(translations[language]).sort(), expected, language);
    }
  });

  test("keeps placeholders identical across languages", () => {
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [key, english] of Object.entries(translations.en)) {
      for (const language of SUPPORTED_LANGUAGES) {
        const value = translations[language][key as keyof typeof translations.en];
        assert.deepEqual(placeholders(value), placeholders(english), `${language}:${key}`);
      }
    }
  });

  test("never leaves a value empty", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      for (const [key, value] of Object.entries(translations[language])) {
        assert.ok(value.length > 0, `${language}:${key}`);
      }
    }
  });
});
