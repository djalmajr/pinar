import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  afterCopyAction,
  dropHydrationIfTabLeftOrigin,
  endTabPins,
  pinFrameIds,
  planSessionEnd,
  planSessionReopen,
  selectHydrateSession,
} from "./session.js";

const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const LEGACY_GLOBAL = ["__ai", "Feedback"].join("");
const LEGACY_NAMESPACE = ["ai", "feedback"].join("-");

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
    const start = contentSrc.indexOf("if (!copied?.ok && !locallyCopied)");
    const end = contentSrc.indexOf("} catch", start);
    assert.ok(start >= 0 && end > start);
    const success = contentSrc.slice(start, end);
    assert.match(success, /session:end/);
    assert.doesNotMatch(success, /hidden:\s*false/);
    assert.match(contentSrc, /__pinarDismiss/);
    assert.match(backgroundSrc, /session:end/);
    assert.match(backgroundSrc, /__pinarDismiss/);
    assert.equal(contentSrc.includes(LEGACY_NAMESPACE), false);
    assert.equal(contentSrc.includes(LEGACY_GLOBAL), false);
    assert.equal(backgroundSrc.includes(LEGACY_NAMESPACE), false);
    assert.equal(backgroundSrc.includes(LEGACY_GLOBAL), false);
  });

  test("Cmd/Ctrl+Enter keeps a page-level clipboard fallback before ending the session", () => {
    // Regression captured: an unavailable offscreen clipboard or a transient
    // Markdown endpoint used to leave the user with no copied content.
    assert.match(contentSrc, /async function writePlainText/);
    assert.match(contentSrc, /copied\?\.plain\s*\?\s*await writePlainText/);
    assert.match(contentSrc, /!copied\?\.ok\s*&&\s*!locallyCopied/);
    assert.match(backgroundSrc, /return \{ degraded, error: String\(error\), ok: false, plain: payload\.plain, warning: uniqueWarnings\[0\] \|\| null, warnings: uniqueWarnings \}/);
  });

  test("screenshot and helper failures still copy a correlatable bundle", () => {
    assert.match(contentSrc, /const shot = capture\?\.ok \? capture\.shot : null/);
    assert.match(contentSrc, /function handoffStatusText/);
    assert.match(contentSrc, /no screenshot/);
    assert.match(contentSrc, /helper unavailable/);
    assert.match(backgroundSrc, /warnings\.push\("screenshot_missing"\)/);
    assert.match(backgroundSrc, /warnings\.push\("helper_unavailable"\)/);
    assert.match(backgroundSrc, /warnings\.push\("viewer_unavailable"\)/);
    assert.match(backgroundSrc, /degraded, ok: true, plain: payload\.plain/);
    assert.match(backgroundSrc, /viewerUrl,/);
  });

  test("element composer identifies the selected HTML tag in a badge", () => {
    assert.match(contentSrc, /data-ref="selectionTag"/);
    assert.match(contentSrc, /tag:\s*element\.tagName\.toLowerCase\(\)/);
    assert.match(contentSrc, /ui\.selectionTag\.textContent = selectedTag \? `<\$\{selectedTag\}>` : ""/);
    assert.match(contentSrc, /state\.draft\?\.kind === "element"/);
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

  test("reopen hydrates only the chosen session onto a matching origin tab", () => {
    const session = {
      captureId: "cap_one",
      id: "session_one",
      page: { url: "https://app.example.test/settings" },
    };
    assert.deepEqual(planSessionReopen({
      appUrl: "http://127.0.0.1:17373/v/session_one",
      requestedSessionId: "session_one",
      session,
    }), {
      ok: true,
      origin: "https://app.example.test",
      pageUrl: session.page.url,
      sessionId: "session_one",
    });
    assert.equal(planSessionReopen({
      appUrl: "https://evil.example",
      requestedSessionId: "session_one",
      session,
    }).error, "untrusted_app");
    assert.equal(selectHydrateSession("session_two", session), null);

    const hydrations = new Map([[3, { pageUrl: session.page.url }]]);
    const tabPins = new Map([[3, [{ comment: "only session_one" }]]]);
    assert.deepEqual(
      dropHydrationIfTabLeftOrigin(hydrations, tabPins, 3, "https://evil.example"),
      { dropped: true, reason: "origin_mismatch" },
    );
    assert.equal(tabPins.has(3), false);

    assert.match(backgroundSrc, /session:reopen/);
    assert.match(backgroundSrc, /session_mismatch/);
    assert.match(backgroundSrc, /CONTENT_INJECTION_FILES/);
    assert.match(contentSrc, /__pinarHydrateSession/);
    assert.match(contentSrc, /historicalAnchor/);
    assert.match(contentSrc, /manual-reposition/);
    assert.doesNotMatch(contentSrc, /session:reopen[\s\S]*pins of every session/);
  });

  test("captures og:title and meta description instead of only document.title", () => {
    assert.match(contentSrc, /og:title/);
    assert.match(contentSrc, /meta\[name="description"\]/);
    assert.match(contentSrc, /og:description/);
  });
});
