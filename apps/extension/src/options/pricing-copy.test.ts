import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { translations } from "@pinar/shared";

describe("extension pricing copy", () => {
  test("keeps upgrade labels currency-neutral so /pricing owns regional amounts", () => {
    for (const [language, dictionary] of Object.entries(translations)) {
      assert.doesNotMatch(
        dictionary.btn_upgrade_pro,
        /[$€£¥₹]|\b(?:BRL|USD)\b|\d/,
        `${language} hard-codes a price outside the regional pricing page`,
      );
    }
  });
});
