import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { afterCopyAction, endTabPins, planSessionEnd } from "./session.js";

const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");

describe("session after copy", () => {
  test("successful copy ends the session in every frame instead of restoring overlays", () => {
    // Mutation captured: sending overlays:hidden false after capture shows
    // iframe pins again while the top toolbar stays gone.
    const action = afterCopyAction(true);
    assert.equal(action.type, "session:end");
    assert.notEqual(action.type, "overlays:hidden");
    assert.equal("hidden" in action, false);
  });

  test("failed copy restores overlays so iframe pins stay editable", () => {
    // Mutation captured: treating failure like success would hide pins the
    // user still needs to edit.
    assert.deepEqual(afterCopyAction(false), { hidden: false, type: "overlays:hidden" });
  });

  test("session:end drops every frame's pins for the tab and dismisses all frames", () => {
    // Mutation captured: clearing only the top frame leaves iframe pins in
    // the tab store and on screen.
    const tabPins = new Map([
      [7, [{ frameId: 0, comment: "top" }, { frameId: 2, comment: "iframe" }]],
    ]);
    const plan = planSessionEnd(7);
    assert.equal(plan.ok, true);
    assert.equal(plan.dismissAllFrames, true);
    assert.equal(plan.clearPins, true);
    endTabPins(tabPins, plan.tabId);
    assert.equal(tabPins.has(7), false);
  });

  test("the copy-success path dismisses every frame instead of restoring overlays", () => {
    // Mutation captured: the old success tail sent overlays:hidden false,
    // which put iframe markers back after the top toolbar had already closed.
    const start = contentSrc.indexOf("if (!copied?.ok)");
    const end = contentSrc.indexOf("} catch", start);
    assert.ok(start >= 0 && end > start);
    const success = contentSrc.slice(start, end);
    assert.match(success, /session:end/);
    assert.doesNotMatch(success, /hidden:\s*false/);
    assert.match(contentSrc, /__aiFeedbackDismiss/);
    assert.match(backgroundSrc, /session:end/);
    assert.match(backgroundSrc, /__aiFeedbackDismiss/);
  });
});
