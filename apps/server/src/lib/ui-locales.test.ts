import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SUPPORTED_LANGUAGES } from "@pinar/shared";
import { loadUiMessages } from "./i18n";
import englishMessages from "./ui-locales/en";

const PLACEHOLDER = /\{(\w+)(?:,\s*plural[^}]*)?\}/g;

function placeholders(message: string) {
  return [...message.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

async function loadEveryUiLocale() {
  return Promise.all(
    SUPPORTED_LANGUAGES.map(async (language) => ({
      language,
      messages: await loadUiMessages(language),
    })),
  );
}

describe("ui message catalogs", () => {
  test("memoizes each locale module", async () => {
    const first = loadUiMessages("de");
    assert.equal(loadUiMessages("de"), first);
    assert.equal((await first)["common.help"], "Hilfe");
  });

  test("ships the same keys in every language", async () => {
    const expectedKeys = Object.keys(englishMessages).sort();
    for (const { language, messages } of await loadEveryUiLocale()) {
      assert.deepEqual(Object.keys(messages).sort(), expectedKeys, language);
    }
  });

  test("keeps placeholders and plural arguments identical across languages", async () => {
    for (const { language, messages } of await loadEveryUiLocale()) {
      for (const [key, message] of Object.entries(englishMessages)) {
        assert.deepEqual(
          placeholders(messages[key as keyof typeof englishMessages]),
          placeholders(message),
          `${language}:${key}`,
        );
      }
    }
  });

  test("translates every message away from English", async () => {
    const english = await loadUiMessages("en");
    for (const { language, messages } of await loadEveryUiLocale()) {
      if (language === "en") continue;
      const untouched = Object.keys(english).filter(
        (key) =>
          messages[key as keyof typeof englishMessages] ===
          english[key as keyof typeof englishMessages],
      );
      assert.ok(
        untouched.length < Object.keys(english).length / 2,
        `${language} left ${untouched.length} messages untranslated`,
      );
    }
  });

  test("declares a plural branch for every plural message", async () => {
    for (const { language, messages } of await loadEveryUiLocale()) {
      for (const [key, message] of Object.entries(messages)) {
        if (!message.includes(", plural,")) continue;
        assert.match(message, /other\s*\{/, `${language}:${key}`);
      }
    }
  });
});
