import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./locators.js", import.meta.url), "utf8");
const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const sessionSrc = readFileSync(new URL("./session.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { isPendingLocation, locateResultMeta, splitFrameDomPath } = context.__pinarLocators;

describe("extension locators", () => {
  test("injects locators.js before content.js and never treats pending matches as exact", () => {
    assert.match(sessionSrc, /"locators\.js"/);
    assert.match(backgroundSrc, /CONTENT_INJECTION_FILES/);
    assert.ok(sessionSrc.indexOf('"locators.js"') < sessionSrc.indexOf('"content.js"'));
    assert.match(contentSrc, /__pinarLocators/);
    assert.match(contentSrc, /data-location-confidence/);
    assert.match(contentSrc, /is-pending/);
    assert.match(contentSrc, /Needs review/);
    assert.equal(isPendingLocation({ confidence: "exact" }), false);
    assert.equal(isPendingLocation({ confidence: "probable" }), false);
    assert.equal(isPendingLocation({ confidence: "ambiguous" }), true);
    assert.equal(isPendingLocation({ confidence: "unresolved" }), true);
    assert.equal(locateResultMeta({
      confidence: "probable",
      evidence: ["visible text"],
      score: 0.7,
      strategy: "semantic",
    }).confidence, "probable");
    assert.equal(splitFrameDomPath("iframe#a ::frame:: button#b").join(" | "), "iframe#a | button#b");
  });
});
