import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");

describe("toolbar visibility", () => {
  test("reinjecting content.js does not call the toolbar toggle", () => {
    const guard = contentSrc.slice(0, contentSrc.indexOf("const DRAG_THRESHOLD"));
    const code = guard.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.match(guard, /if \(globalThis\.__pinarToggle\) return;/);
    assert.equal(code.includes("__pinarToggle()"), false);
  });

  test("screenshot conceal does not change the user's visibility", () => {
    const setHidden = contentSrc.slice(
      contentSrc.indexOf("function setHidden"),
      contentSrc.indexOf("function isVisible"),
    );
    assert.equal(/state\.active\s*=/.test(setHidden), false);
    assert.match(setHidden, /host\.style\.display = hidden \|\| !state\.active \? "none" : ""/);
  });

  test("dismissing the toolbar records that this tab stays hidden", () => {
    const dismiss = contentSrc.slice(
      contentSrc.indexOf("function dismiss()"),
      contentSrc.indexOf("function isMounted()"),
    );
    assert.match(dismiss, /type: "toolbar:visibility", visible: false/);
  });

  test("a stored boolean cannot reopen the toolbar, and each tab keeps its own intent", () => {
    assert.match(backgroundSrc, /function toolbarVisibilityMap\(value\)/);
    assert.match(backgroundSrc, /typeof value !== "object"/);
    assert.match(backgroundSrc, /async function toolbarVisibleForTab\(tabId\)/);
    assert.equal(backgroundSrc.includes("async function toolbarVisible()"), false);
    const resume = backgroundSrc.slice(
      backgroundSrc.indexOf("async function resumeReviewTab"),
      backgroundSrc.indexOf("async function persistReviewPins"),
    );
    assert.match(resume, /await toolbarVisibleForTab\(tabId\)/);
    assert.equal(resume.includes("await toolbarVisible()"), false);
    assert.match(resume, /recording && !recording\.finished \? false : await toolbarVisibleForTab\(tabId\)/);
  });

  test("the extension action toggles a live toolbar without reinjecting it", () => {
    const click = backgroundSrc.slice(
      backgroundSrc.indexOf("chrome.action.onClicked.addListener"),
      backgroundSrc.indexOf("async function resumeRecordingOnTab"),
    );
    const already = click.slice(click.indexOf("if (probe?.result)"), click.indexOf("await setToolbarVisible"));
    assert.match(already, /globalThis\.__pinarToggle\?\.\(\)/);
    assert.match(already, /return;/);
    assert.equal(already.includes("CONTENT_INJECTION_FILES"), false);
    assert.match(click, /setToolbarVisible\(tab\.id, true\)/);
    assert.match(backgroundSrc, /setToolbarVisible\(sender\.tab\.id, message\.visible\)/);
  });

  test("a missing script during recording or a finish toast does not default the toolbar open", () => {
    const recording = backgroundSrc.slice(
      backgroundSrc.indexOf("async function resumeRecordingOnTab"),
      backgroundSrc.indexOf("async function recordingThumbnail"),
    );
    assert.match(recording, /prepareInitialToolbarVisibility\(tabId, false\)/);
    const ensure = backgroundSrc.slice(
      backgroundSrc.indexOf("async function ensureContentOnActiveTab"),
      backgroundSrc.indexOf("async function writeClipboardPlain"),
    );
    assert.match(ensure, /prepareInitialToolbarVisibility\(tab\.id, await toolbarVisibleForTab\(tab\.id\)\)/);
  });
});
