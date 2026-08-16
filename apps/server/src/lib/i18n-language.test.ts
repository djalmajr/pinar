import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getBestLanguage } from "@pinar/shared";

describe("getBestLanguage", () => {
  test("keeps an explicit preference ahead of the browser locale", () => {
    assert.equal(getBestLanguage("de", ["pt-BR"]), "de");
  });

  test("detects regional browser locales", () => {
    assert.equal(getBestLanguage(undefined, ["pt-BR"]), "pt");
    assert.equal(getBestLanguage(undefined, ["zh-CN"]), "zh");
  });

  test("uses the first supported language from the browser preference list", () => {
    assert.equal(getBestLanguage(undefined, ["it-IT", "fr-FR", "en-US"]), "fr");
  });

  test("falls back to English when no candidate is supported", () => {
    assert.equal(getBestLanguage(undefined, ["it-IT"]), "en");
  });
});
