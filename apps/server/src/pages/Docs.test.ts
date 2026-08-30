import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const docsSource = readFileSync(new URL("./Docs.tsx", import.meta.url), "utf8");

describe("docs page", () => {
  test("sends extension setup to the Chrome Web Store, not GitHub", () => {
    assert.match(docsSource, /href=\{CHROME_EXTENSION_URL\}/);
    assert.match(docsSource, /t\("landing\.installExtension"\)/);
    assert.match(docsSource, /<ServerFooter\b/);
    assert.doesNotMatch(docsSource, /github\.com\/djalmajr\/pinar/);
  });
});
