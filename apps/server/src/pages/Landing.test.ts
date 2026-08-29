import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const landingSource = readFileSync(new URL("./Landing.tsx", import.meta.url), "utf8");

describe("landing page", () => {
  test("offers the published Chrome extension as the primary hero action", () => {
    assert.match(
      landingSource,
      /https:\/\/chromewebstore\.google\.com\/detail\/pinardev\/idpeaokdndjedekacfdfbilcolpholbo/,
    );
    assert.match(landingSource, /href=\{CHROME_EXTENSION_URL\}/);
    assert.match(landingSource, /target="_blank"/);
    assert.match(landingSource, /t\("landing\.installExtension"\)/);
    assert.match(landingSource, /className="text-xs"/);
    assert.doesNotMatch(landingSource, /t\("common\.signIn"\)/);
    assert.doesNotMatch(landingSource, /t\("landing\.viewPlans"\)/);
    assert.match(landingSource, /pinarRuntime\(\) === "local"/);
  });
});
