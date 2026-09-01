import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SUPPORTED_LANGUAGES } from "@pinar/shared";
import { formatMessage } from "./i18n";
import {
  canonicalHref,
  isIndexablePath,
  isSupportedLanguage,
  languageAlternates,
  parseAcceptLanguage,
  readLanguageCookie,
} from "./language";
import englishMessages from "./ui-locales/en";
import portugueseMessages from "./ui-locales/pt";
import frenchMessages from "./ui-locales/fr";
import japaneseMessages from "./ui-locales/ja";

describe("language cookie and header parsing", () => {
  test("reads the language cookie out of a full cookie header", () => {
    assert.equal(
      readLanguageCookie("pinar-theme=dark; pinar-language=de; other=1"),
      "de",
    );
  });

  test("ignores an unsupported or absent cookie value", () => {
    assert.equal(readLanguageCookie("pinar-language=xx"), undefined);
    assert.equal(readLanguageCookie("pinar-theme=dark"), undefined);
    assert.equal(readLanguageCookie(undefined), undefined);
  });

  test("orders Accept-Language candidates by quality", () => {
    assert.deepEqual(
      parseAcceptLanguage("it-IT;q=0.4, fr-FR;q=0.9, en;q=0.8"),
      ["fr-FR", "en", "it-IT"],
    );
  });

  test("accepts every supported language and rejects anything else", () => {
    for (const language of SUPPORTED_LANGUAGES)
      assert.equal(isSupportedLanguage(language), true);
    assert.equal(isSupportedLanguage("xx"), false);
    assert.equal(isSupportedLanguage(null), false);
  });

  test("emits one absolute alternate per supported language", () => {
    const alternates = languageAlternates("https://pinar.dev", "/help");
    assert.equal(alternates.length, SUPPORTED_LANGUAGES.length);
    assert.deepEqual(alternates[0], {
      href: "https://pinar.dev/help?lang=en",
      language: "en",
    });
  });
});

describe("indexable surface", () => {
  test("marks public marketing and content routes as indexable", () => {
    for (const pathname of [
      "/",
      "/pricing",
      "/help",
      "/help/privacy/where-data-lives",
      "/releases",
      "/releases/0.1.5",
      "/legal/privacy",
      "/sign-in",
    ])
      assert.equal(isIndexablePath(pathname), true, pathname);
  });

  test("keeps the workspace, viewers, and endpoints out of the hreflang cluster", () => {
    for (const pathname of [
      "/app",
      "/success",
      "/v/abc",
      "/p/abc",
      "/c/abc",
      "/shots/abc",
      "/api/health",
    ])
      assert.equal(isIndexablePath(pathname), false, pathname);
  });

  test("self-references the negotiated URL as canonical", () => {
    assert.equal(
      canonicalHref("https://pinar.dev", "/help", ""),
      "https://pinar.dev/help",
    );
    assert.equal(
      canonicalHref("https://pinar.dev", "/help", "?lang=de"),
      "https://pinar.dev/help?lang=de",
    );
  });

  test("ignores an unsupported lang parameter in the canonical", () => {
    assert.equal(
      canonicalHref("https://pinar.dev", "/help", "?lang=xx&foo=1"),
      "https://pinar.dev/help",
    );
  });
});

describe("message formatting", () => {
  test("substitutes named placeholders", () => {
    assert.equal(formatMessage("Pin {number}", "en", { number: 3 }), "Pin 3");
  });

  test("selects English plural categories", () => {
    assert.equal(
      formatMessage(englishMessages["dashboard.pinCount"], "en", { count: 1 }),
      "1 pin",
    );
    assert.equal(
      formatMessage(englishMessages["dashboard.pinCount"], "en", { count: 4 }),
      "4 pins",
    );
    assert.equal(
      formatMessage(englishMessages["dashboard.pinCount"], "en", { count: 0 }),
      "0 pins",
    );
  });

  test("uses CLDR categories instead of an equality check", () => {
    assert.equal(
      formatMessage(frenchMessages["aggregate.sessionCount"], "fr", {
        count: 0,
      }),
      "0 session",
    );
    assert.equal(
      formatMessage(portugueseMessages["aggregate.sessionCount"], "pt", {
        count: 2,
      }),
      "2 sessões",
    );
  });

  test("falls back to the other branch for languages without plural forms", () => {
    assert.equal(
      formatMessage(japaneseMessages["dashboard.pinCount"], "ja", { count: 1 }),
      "1 ピン",
    );
    assert.equal(
      formatMessage(japaneseMessages["dashboard.pinCount"], "ja", { count: 7 }),
      "7 ピン",
    );
  });

  test("leaves a plural block untouched when the count is missing", () => {
    assert.equal(
      formatMessage("{count, plural, one {# pin} other {# pins}}", "en", {
        other: "x",
      }),
      "{count, plural, one {# pin} other {# pins}}",
    );
  });
});
