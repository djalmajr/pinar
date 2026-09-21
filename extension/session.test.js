import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  afterCopyAction,
  endTabPins,
  pinFrameIds,
  planSessionEnd,
  canInjectInto,
} from "./session.js";

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

  test("uses the platform-specific copy shortcut", () => {
    assert.match(contentSrc, /isCopyShortcut\(event, apple\)/);
    assert.match(contentSrc, /<kbd>\$\{copyShortcutLabel\(apple\)\}<\/kbd>/);
  });

  test("clipboard is published before the helper stores the screenshot", () => {
    // Mutation captured: waiting on saveShot before the first clipboard write
    // left the overlay stuck at 80% after comments were already pasteable.
    const copyBundle = backgroundSrc.slice(
      backgroundSrc.indexOf("async function copyBundle"),
      backgroundSrc.indexOf("async function ensureOffscreen"),
    );
    const firstWrite = copyBundle.indexOf("type: \"clipboard:write\"");
    const save = copyBundle.indexOf("saveShot(");
    assert.ok(firstWrite >= 0 && save > firstWrite);
    assert.match(copyBundle, /reportCopyProgress\(tabId, 0\.86\)/);
    assert.match(contentSrc, /message\?\.type === "copy:progress"/);
  });

  test("finishing immediately replaces the pin toolbar with a single-flight saving state", () => {
    const send = contentSrc.slice(
      contentSrc.indexOf("  async function sendPins() {"),
      contentSrc.indexOf("  function frameElementForSource"),
    );
    const markSending = send.indexOf("state.sending = true;");
    const showPending = send.indexOf('showPending(t("overlay_copying"));');
    const finishRequest = send.indexOf('type: "review:finish"');
    assert.ok(markSending >= 0 && showPending > markSending && finishRequest > showPending);
    assert.match(send, /catch \{[\s\S]*clearProgress\(\);[\s\S]*setReviewOpen\(true\);/);
    assert.match(contentSrc, /:host\(\[data-indeterminate\]\) \.toolbar::before/);
    assert.match(backgroundSrc, /concludeReviewOnce\("active-review", \(\) => performConcludeReview\(options\)\)/);
  });

  test("element composer identifies the selected HTML tag in a badge", () => {
    assert.match(contentSrc, /data-ref="selectionTag"/);
    assert.match(contentSrc, /tag:\s*element\.tagName\.toLowerCase\(\)/);
    assert.match(contentSrc, /ui\.selectionTag\.textContent = selectedTag \? `<\$\{selectedTag\}>` : ""/);
    assert.match(contentSrc, /state\.draft\?\.kind === "element"/);
  });

  test("live overlay can show pin regions without changing the saved crop", () => {
    const cropSrc = readFileSync(new URL("./crop.js", import.meta.url), "utf8");
    assert.match(contentSrc, /showPinRegions:\s*true/);
    assert.match(contentSrc, /function togglePinRegions/);
    assert.match(contentSrc, /event\.key === "r"/);
    assert.match(contentSrc, /class="pin-region/);
    assert.doesNotMatch(cropSrc, /showPinRegions/);
    const renderPins = cropSrc.slice(
      cropSrc.indexOf("export async function renderPinsCrop"),
      cropSrc.indexOf("return canvas.convertToBlob"),
    );
    assert.match(renderPins, /drawAreaBox/);
    assert.match(renderPins, /drawPinMarker/);
  });

  test("session controls remain available without a bound batch shortcut", () => {
    assert.match(contentSrc, /\[hidden\] \{ display: none !important; \}/);
    assert.doesNotMatch(contentSrc, /data-ref="batchPill"/);
  });

  test("extension controls use the same non-pill radius language as the app", () => {
    const toolbarStyles = contentSrc.slice(contentSrc.indexOf(".toolbar {"), contentSrc.indexOf(".toolbar.pass-through"));
    const composerStyles = contentSrc.slice(contentSrc.indexOf(".composer-card {"), contentSrc.indexOf(".privacy-mask {"));
    assert.match(toolbarStyles, /border-radius: 8px/);
    assert.match(composerStyles, /\.composer-card \{[\s\S]*border-radius: 8px/);
    assert.match(composerStyles, /\.btn-cancel, \.btn-add \{[\s\S]*border-radius: 6px/);
    assert.doesNotMatch(composerStyles, /border-radius: 999px/);
  });

  test("live element and area selection shows position and dimensions", () => {
    // Mutation captured: limiting the badge to is-dragging hides geometry while
    // the user navigates candidate elements with the pointer or keyboard.
    assert.match(contentSrc, /\.outline\.show-geometry \.outline-badge/);
    assert.match(contentSrc, /classList\.toggle\("show-geometry", showGeometry\)/);
    assert.match(contentSrc, /showOutline\(boxOf\(selection\.current\), false, false, BLUE, true\)/);
    assert.match(contentSrc, /normBox\(state\.drag\)[\s\S]*?true,[\s\S]*?\);/);
    assert.match(contentSrc, /outlineBadge\.textContent = geometryLabel\(box\)/);
  });

  test("area pin overlay projection uses nested scroller offsets, not only window scroll", () => {
    // Mutation captured: Help articles scroll inside ScrollArea. The numbered
    // marker and dashed box stayed glued to the viewport while the selected
    // region moved with the inner scroller. Pin 1 of install-pinar landed in
    // the gap between sections after that scroll.
    const viewportPin = contentSrc.slice(
      contentSrc.indexOf("function viewportPin"),
      contentSrc.indexOf("function cssPath"),
    );
    const openAreaDraft = contentSrc.slice(
      contentSrc.indexOf("async function openAreaDraft"),
      contentSrc.indexOf("function onPointerUp"),
    );
    const syncPins = contentSrc.slice(
      contentSrc.indexOf("async function syncPins"),
      contentSrc.indexOf("function cancelDraft"),
    );
    assert.match(contentSrc, /function pinLayoutScroll\(/);
    assert.match(contentSrc, /function scrollRootsFromPoint\(/);
    assert.match(contentSrc, /elementsFromPoint/);
    assert.match(contentSrc, /data-slot="scroll-area-viewport"/);
    assert.match(contentSrc, /function watchScrollRoots\(/);
    assert.match(contentSrc, /unwatchScrollRoots\(\)/);
    assert.match(viewportPin, /projectPin\(pin, pinLayoutScroll\(pin\)\)/);
    assert.doesNotMatch(viewportPin, /projectPin\(pin, currentScroll\(\)\)/);
    assert.match(openAreaDraft, /scrollRootsFromPoint\(/);
    assert.match(openAreaDraft, /layoutScroll\(scroll, scrollRoots\)/);
    assert.match(openAreaDraft, /documentBox\(box, nestedScroll\)/);
    assert.match(openAreaDraft, /scrollRoots,/);
    assert.match(syncPins, /working\.kind === "area"/);
    assert.match(syncPins, /projectPin\(working, pinLayoutScroll\(working\)\)/);
  });

  test("fixed modal capture preserves the measured viewport rect", () => {
    // Mutation captured: keeping a dialog's centering translation after moving
    // it to its measured absolute top/left shifts the screenshot by half the modal.
    const prepareCapture = contentSrc.slice(
      contentSrc.indexOf("async function prepareCapture"),
      contentSrc.indexOf("async function scrollCapture"),
    );
    assert.match(prepareCapture, /setProperty\("transform", "none", "important"\)/);
    assert.match(prepareCapture, /setProperty\("translate", "none", "important"\)/);
    assert.match(prepareCapture, /setProperty\("scale", "none", "important"\)/);
    assert.match(prepareCapture, /setProperty\("rotate", "none", "important"\)/);
    assert.ok(prepareCapture.indexOf('setProperty("translate", "none", "important")')
      < prepareCapture.indexOf('setProperty("top", `${rect.top + window.scrollY}px`, "important")'));
  });

  test("pin refresh targets only frames that own annotations", () => {
    // Mutation captured: refreshing all tab frames makes one unrelated,
    // inaccessible iframe abort copying annotations from the top page.
    assert.deepEqual(pinFrameIds([
      { frameId: 0 },
      { frameId: 4 },
      { frameId: 0 },
      { frameId: null },
    ]), [0, 4]);
    assert.match(backgroundSrc, /frameIds: \[frameId\]/);
    assert.doesNotMatch(backgroundSrc.slice(
      backgroundSrc.indexOf('message.type === "pins:refresh"'),
      backgroundSrc.indexOf('message.type === "pins:clear"'),
    ), /allFrames:\s*true/);
  });

  test("captures og:title and meta description instead of only document.title", () => {
    assert.match(contentSrc, /og:title/);
    assert.match(contentSrc, /meta\[name="description"\]/);
    assert.match(contentSrc, /og:description/);
  });
});

test("the action injects only where Chrome allows content scripts", () => {
  // Chrome's own surfaces reject executeScript; treating them as a deliberate
  // no-op keeps a rejection on an ordinary page loud instead of swallowed.
  for (const url of [
    "chrome://extensions/",
    "chrome://newtab/",
    "chrome-extension://abcdefghijklmnop/dist/options.html",
    "chrome-untrusted://x/",
    "devtools://devtools/bundled/inspector.html",
    "about:blank",
    "view-source:https://example.com/",
    "https://chromewebstore.google.com/detail/pinar/abc",
    "",
    undefined,
  ]) assert.equal(canInjectInto(url), false, String(url));
  for (const url of [
    "https://example.com/",
    "http://127.0.0.1:17373/app",
    "file:///Users/me/page.html",
  ]) assert.equal(canInjectInto(url), true, url);
});

test("a toggle during a capture is queued, never applied to the closing session", () => {
  // Pressing the shortcut while the confirmation lingered used to flip the
  // finished overlay back on, and the tear-down still in flight then wiped it -
  // together with whatever the user had just pinned.
  const src = readFileSync(new URL("./content.js", import.meta.url), "utf8");
  const toggleStart = src.indexOf("  function toggle() {");
  const toggle = src.slice(toggleStart, src.indexOf("\n  globalThis.__pinarToggle", toggleStart));
  assert.match(toggle, /if \(state\.sending\) \{/);
  assert.match(toggle, /state\.reopenAfterSend = true;/);
  assert.doesNotMatch(toggle, /finishEarly/);
  const send = src.slice(src.indexOf("  async function sendPins() {"), src.indexOf("  function frameElementForSource"));
  assert.doesNotMatch(send, /finishEarly/);
  assert.match(send, /finally \{[\s\S]*state\.sending = false;[\s\S]*if \(state\.reopenAfterSend\) \{[\s\S]*setVisible\(true\);/);
});
