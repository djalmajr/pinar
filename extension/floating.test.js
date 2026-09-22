import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./floating.js", import.meta.url), "utf8");
const sessionSource = readFileSync(new URL("./session.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const fitFloatingPosition = context.__pinarFitFloating;

describe("composer placement", () => {
  test("moves a comment that would leave the window back inside it", () => {
    const fitted = fitFloatingPosition({
      anchor: { left: 900, top: 700 },
      size: { width: 340, height: 280 },
      viewport: { width: 1000, height: 800 },
    });
    assert.equal(fitted.left, 652);
    assert.equal(fitted.top, 512);
    assert.equal(fitted.maxHeight, null);
    assert.equal(fitted.left + 340 <= 992, true);
    assert.equal(fitted.top + 280 <= 792, true);
  });

  test("keeps a comment that is taller than the window at the top and caps its height", () => {
    const fitted = fitFloatingPosition({
      anchor: { left: 40, top: 40 },
      size: { width: 340, height: 900 },
      viewport: { width: 800, height: 500 },
    });
    assert.equal(fitted.top, 8);
    assert.equal(fitted.maxHeight, 484);
    assert.equal(fitted.tooltipBelow, true);
  });

  test("is injected before the overlay", () => {
    assert.ok(sessionSource.indexOf('"floating.js"') < sessionSource.indexOf('"content.js"'));
  });
});
