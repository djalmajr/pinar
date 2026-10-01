import assert from "node:assert/strict";
import { test } from "node:test";
import { continuousSummary, copyReviewHandoff, createContinuousSession, restoreEntriesForPage, reviewErrorKey } from "./continuous-session.js";

function fixture(overrides = {}) {
  let state = null, sequence = 0;
  const calls = [];
  const deps = {
    read: async () => structuredClone(state),
    write: async (value) => { state = structuredClone(value); },
    create: async () => ({ id: "review", includeScreenshot: true, collectionId: "fixed-destination" }),
    capture: async (entry) => { assert.ok(state.entries.some((item) => item.captureId === entry.captureId)); calls.push(["capture", entry.captureId]); return `image:${entry.captureId}`; },
    save: async (entry, draft) => { calls.push(["save", entry.captureId, entry.pin.comment, draft.collectionId]); return { path: "shot" }; },
    remove: async (entry) => { calls.push(["remove", entry.captureId]); },
    finish: async () => { calls.push(["finish"]); },
    publish: async () => { calls.push(["copy"]); },
    id: () => `capture-${++sequence}`,
    ...overrides,
  };
  return { engine: createContinuousSession(deps), restart: () => createContinuousSession(deps), calls, state: () => state };
}
const input = (source, ids, comment = "change this") => ({ source, page: { title: source, url: `https://example.test/${source}` }, pins: ids.map((id) => ({ id, pinId: id, comment })) });

test("first pin starts one durable session across pages and tabs", async () => {
  const f = fixture();
  await f.engine.sync(input("tab-a/page-one", ["a", "b"]));
  await f.engine.sync(input("tab-b/page-two", ["c"]));
  const summary = continuousSummary(f.state());
  assert.equal(summary.count, 2);
  assert.equal(summary.pins, 3);
  assert.equal(summary.pending, 0);
  assert.deepEqual(f.state().entries.map((entry) => entry.pin.number), [1, 2, 3]);
  await f.engine.finish();
  assert.equal(f.state(), null);
  assert.deepEqual(f.calls.slice(-2), [["finish"], ["copy"]]);
});
test("empty page does not start a session", async () => {
  const f = fixture();
  await f.engine.sync(input("page", []));
  assert.equal(f.state(), null);
});

test("numbering survives deletion, restart and concurrent pages without reusing numbers", async () => {
  const f = fixture();
  await f.engine.sync(input("one", ["a", "b"]));
  await f.engine.remove(f.state().entries[1].captureId);
  const resumed = f.restart();
  await Promise.all([resumed.sync(input("two", ["c"])), resumed.sync(input("three", ["d"]))]);
  assert.deepEqual(f.state().entries.map((entry) => entry.pin.number), [1, 2, 3, 4]);
  assert.equal(continuousSummary(f.state()).nextNumber, 5);
});

test("restart recovers evidence and edits retain capture/pin IDs and screenshot", async () => {
  const f = fixture();
  await f.engine.sync(input("page", ["a"]));
  const before = structuredClone(f.state().entries[0]);
  await f.restart().sync(input("page", ["a"], "new comment"));
  assert.equal(f.state().entries[0].captureId, before.captureId);
  assert.equal(f.state().entries[0].shot, before.shot);
  assert.equal(f.state().entries[0].pin.comment, "new comment");
  assert.equal(f.calls.filter(([kind]) => kind === "capture").length, 1);
});

test("failed upload keeps screenshot for retry without revisiting page", async () => {
  let online = false;
  const f = fixture({ save: async () => { if (!online) throw new Error("offline"); return {}; } });
  await f.engine.sync(input("page", ["a"]));
  await assert.rejects(f.engine.finish(), /session_pending/);
  assert.ok(f.state().entries[0].shot);
  online = true;
  await f.restart().finish();
  assert.equal(f.state(), null);
  assert.equal(f.calls.filter(([kind]) => kind === "capture").length, 1);
});

test("missing screenshot blocks completion and preserves annotation", async () => {
  const f = fixture({ capture: async () => { throw new Error("tab changed"); } });
  await f.engine.sync(input("page", ["a"]));
  await assert.rejects(f.engine.finish(), /session_pending/);
  assert.equal(f.state().entries[0].pin.comment, "change this");
  assert.equal(f.calls.some(([kind]) => kind === "copy"), false);
});

test("finish reports a pending capture and preserves the durable pin", async () => {
  const f = fixture({ capture: async () => { throw new Error("screenshot_pin_not_visible"); } });
  await f.engine.sync(input("page", ["failed-pin"]));
  const before = structuredClone(f.state().entries[0]);

  await assert.rejects(f.restart().finish(), /session_pending/);

  assert.deepEqual(f.state().entries[0], before);
  assert.equal(f.calls.some(([kind]) => kind === "finish" || kind === "copy"), false);
});

test("only known failure codes map to an i18n key; raw text never surfaces", () => {
  assert.equal(reviewErrorKey("screenshot_pin_not_visible"), "overlay_session_error_pin_not_visible");
  assert.equal(reviewErrorKey("screenshot_page_changed"), "overlay_session_error_page_changed");
  assert.equal(reviewErrorKey("screenshot_tab_changed"), "overlay_session_error_tab_changed");
  assert.equal(reviewErrorKey("screenshot_missing"), "overlay_session_error_screenshot");
  assert.equal(reviewErrorKey("cloud_subscription_required"), "overlay_cloud_subscription_required");
  for (const hostile of ["fetch failed: ECONNREFUSED", "session_pending", "", null, undefined, "constructor", "__proto__", "toString"]) {
    assert.equal(reviewErrorKey(hostile), null, String(hostile));
  }
});

test("summary separates screenshot failures from send failures", async () => {
  let failSave = false;
  const f = fixture({
    capture: async (entry) => {
      if ((entry.pin.pinId || entry.pin.id) === "shot") throw new Error("screenshot_tab_changed");
      return "image";
    },
    save: async () => { if (failSave) throw new Error("fetch failed: ECONNREFUSED"); return { path: "shot" }; },
  });
  await f.engine.sync(input("page", ["shot"]));
  failSave = true;
  await f.engine.sync(input("page", ["shot", "send"]));
  const [screenshot, send] = continuousSummary(f.state()).entries;
  assert.equal(screenshot.errorKey, "overlay_session_error_tab_changed");
  assert.equal(send.status, "pending");
  assert.equal(send.errorKey, null);
});

test("a failed pin capture can recover across pages without losing or duplicating pins", async () => {
  let failPinB = true;
  const captureCounts = new Map();
  const f = fixture({
    capture: async (entry) => {
      const pinId = entry.pin.pinId || entry.pin.id;
      captureCounts.set(pinId, (captureCounts.get(pinId) || 0) + 1);
      if (pinId === "b" && failPinB) throw new Error("screenshot_pin_not_visible");
      return `image:${pinId}:${captureCounts.get(pinId)}`;
    },
  });

  await f.engine.sync(input("page-one", ["a", "b", "c"]));
  const first = structuredClone(f.state().entries);
  assert.deepEqual(first.map((entry) => entry.status), ["saved", "pending", "saved"]);
  assert.ok(first[0].shot);
  assert.equal(first[1].shot, null);
  assert.equal(first[1].pin.comment, "change this");
  assert.equal(first[1].error, "screenshot_pin_not_visible");
  assert.ok(first[2].shot);

  await f.engine.sync(input("page-two", ["d"]));
  const afterNavigation = await f.restart().read();
  assert.equal(afterNavigation.entries[1].captureId, first[1].captureId);
  assert.equal(afterNavigation.entries[1].pin.comment, first[1].pin.comment);
  assert.equal(afterNavigation.entries[1].shot, null);
  await assert.rejects(f.restart().finish(), /session_pending/);
  assert.equal(f.state().entries[1].error, "screenshot_pin_not_visible");

  failPinB = false;
  await f.restart().sync(input("page-one", ["a", "b", "c"]));
  const recovered = f.state().entries;
  assert.equal(recovered.length, 4);
  assert.deepEqual(recovered.slice(0, 3).map((entry) => entry.captureId), first.map((entry) => entry.captureId));
  assert.deepEqual(recovered.slice(0, 3).map((entry) => entry.pin.pinId), ["a", "b", "c"]);
  assert.deepEqual(recovered.slice(0, 3).map((entry) => entry.pin.comment), first.map((entry) => entry.pin.comment));
  assert.deepEqual(recovered.map((entry) => entry.status), ["saved", "saved", "saved", "saved"]);
  assert.deepEqual(Object.fromEntries(captureCounts), { a: 1, b: 2, c: 1, d: 1 });
  const savesById = new Map();
  for (const [kind, captureId] of f.calls) if (kind === "save") savesById.set(captureId, (savesById.get(captureId) || 0) + 1);
  assert.deepEqual([...savesById.values()], [1, 1, 1, 1]);
  await f.restart().finish();
  assert.equal(f.state(), null);
});

test("finish waits for concurrent saves", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ capture: async () => { await gate; return "image"; } });
  const saved = f.engine.sync(input("page", ["a"]));
  const finished = f.engine.finish();
  release();
  await Promise.all([saved, finished]);
  assert.deepEqual(f.calls.map(([kind]) => kind), ["save", "finish", "copy"]);
});

test("attaching a recording stays durable without announcing a second saving state", async () => {
  const notifications = [];
  const f = fixture({
    changed: async (draft) => notifications.push(continuousSummary(draft)),
  });
  await f.engine.sync(input("tab-a:page", ["a"]));
  notifications.length = 0;

  await f.engine.attachReproduction("tab-a", {
    startedAt: "2026-09-21T16:00:00.000Z",
    steps: [{ at: "2026-09-21T16:00:01.000Z", kind: "click" }],
    version: 1,
  });

  assert.equal(f.state().entries[0].status, "pending");
  assert.equal(f.state().entries[0].reproduction.steps.length, 1);
  assert.deepEqual(notifications, []);

  await f.engine.finish();
  assert.equal(notifications.some((summary) => summary.pending > 0), false);
});

test("removing pins only affects their source document", async () => {
  const f = fixture();
  await f.engine.sync(input("a", ["a"]));
  await f.engine.sync(input("b", ["b"]));
  await f.engine.sync(input("a", []));
  assert.equal(continuousSummary(f.state()).pins, 1);
  assert.equal(f.state().entries.find((entry) => entry.pin.id === "b").deleted, undefined);
  assert.deepEqual(f.calls.filter(([kind]) => kind === "remove"), [["remove", "capture-1"]]);
});

test("clipboard and finish failures leave a retryable draft", async () => {
  for (const operation of ["publish", "finish"]) {
    let fail = true;
    const f = fixture({ [operation]: async () => { if (fail) throw new Error("unavailable"); } });
    await f.engine.sync(input("page", ["a"]));
    await assert.rejects(f.engine.finish(), /unavailable/);
    assert.equal(f.state().entries.length, 1);
    fail = false;
    await f.engine.finish();
    assert.equal(f.state(), null);
  }
});

test("finish without copying and discard are distinct operations", async () => {
  const f = fixture();
  await f.engine.sync(input("page", ["a"]));
  await f.engine.finish({ copy: false });
  assert.equal(f.calls.some(([kind]) => kind === "copy" || kind === "remove"), false);
  await f.engine.sync(input("page", ["b"]));
  await f.engine.discard();
  assert.equal(f.calls.filter(([kind]) => kind === "remove").length, 1);
  assert.equal(f.state(), null);
});

test("abandon cancels a pending session locally without retrying network work", async () => {
  const f = fixture({ save: async () => { throw new Error("offline"); } });
  await f.engine.sync(input("page", ["a"]));
  assert.equal(f.state().entries[0].status, "pending");
  const callsBeforeCancel = structuredClone(f.calls);

  const abandoned = await f.engine.abandon();

  assert.equal(abandoned.entries[0].status, "pending");
  assert.equal(f.state(), null);
  assert.deepEqual(f.calls, callsBeforeCancel);
});

test("text-only preference persists without capturing pixels", async () => {
  const f = fixture({ create: async () => ({ id: "review", includeScreenshot: false }) });
  await f.engine.sync(input("page", ["a"]));
  await f.engine.finish();
  assert.equal(f.calls.some(([kind]) => kind === "capture"), false);
  assert.equal(f.state(), null);
});


test("review editing preserves evidence and capture identity across pages", async () => {
  const f = fixture();
  await f.engine.sync(input("one", ["a"]));
  await f.engine.sync(input("two", ["b"]));
  const original = structuredClone(f.state().entries[0]);
  await f.engine.edit(original.captureId, "Updated from review");
  const edited = f.state().entries[0];
  assert.equal(edited.pin.comment, "Updated from review");
  assert.equal(edited.pin.pinId, original.pin.pinId);
  assert.equal(edited.shot, original.shot);
  assert.equal(edited.captureId, original.captureId);
  assert.equal(edited.status, "saved");
  assert.equal(f.calls.filter(([kind]) => kind === "capture").length, 2);
});

test("failed recapture keeps previous shot and preserves draft pending for recovery", async () => {
  let failCapture = false;
  const f = fixture({
    capture: async (entry) => {
      if (failCapture) throw new Error("capture_transient_error");
      return `image:${entry.captureId}`;
    },
  });
  await f.engine.sync(input("page", ["a"]));
  assert.equal(f.state().entries[0].status, "saved");
  const originalShot = f.state().entries[0].shot;
  const captureId = f.state().entries[0].captureId;

  // Drawing a mask triggers shot refresh; capture failure keeps session pending
  // without persisting shot: null, which would corrupt the session if navigation occurs
  failCapture = true;
  await f.engine.sync({ ...input("page", ["a"]), refreshShot: true });
  assert.equal(f.state().entries[0].status, "pending");
  assert.equal(f.state().entries[0].shot, originalShot);
  assert.equal(f.state().entries[0].refreshPending, true);
  await assert.rejects(f.engine.finish(), /session_pending/);

  // Restarting service worker preserves the pending state and the screenshot evidence
  const restarted = f.restart();
  assert.equal(f.state().entries[0].status, "pending");
  assert.equal(f.state().entries[0].shot, originalShot);
  await assert.rejects(restarted.finish(), /session_pending/);

  // Without the active page's capture context the unmasked shot is never delivered as saved
  assert.equal(f.state().entries[0].status, "pending");

  // Recovery while page is available: syncing from the active page (finish shortcut)
  // recaptures even without refreshShot because entry.refreshPending is true
  failCapture = false;
  await restarted.sync(input("page", ["a"]));
  assert.equal(f.state().entries[0].status, "saved");
  assert.equal(f.state().entries[0].captureId, captureId);
  assert.notEqual(f.state().entries[0].shot, null);
  await restarted.finish();
  assert.equal(f.state(), null);
});

test("recapture persists its pending guard before waiting for a new screenshot", async () => {
  let startCapture;
  let releaseCapture;
  let captureCount = 0;
  const started = new Promise((resolve) => { startCapture = resolve; });
  const gate = new Promise((resolve) => { releaseCapture = resolve; });
  const f = fixture({
    capture: async () => {
      captureCount += 1;
      if (captureCount === 1) return "original-image";
      startCapture();
      await gate;
      return "masked-image";
    },
  });
  await f.engine.sync(input("page", ["a"]));

  const recapture = f.engine.sync({ ...input("page", ["a"]), refreshShot: true });
  await started;
  assert.equal(f.state().entries[0].status, "pending");
  assert.equal(f.state().entries[0].refreshPending, true);
  assert.equal(f.state().entries[0].shot, "original-image");
  await assert.rejects(f.restart().finish(), /session_pending/);

  releaseCapture();
  await recapture;
  assert.equal(f.state().entries[0].status, "saved");
  assert.equal(f.state().entries[0].shot, "masked-image");
});

test("failed recapture remains pending after navigation until removed or discarded", async () => {
  let failCapture = false;
  const f = fixture({
    capture: async (entry) => {
      if (failCapture) throw new Error("capture_transient_error");
      return `image:${entry.captureId}`;
    },
  });
  await f.engine.sync(input("page-one", ["a"]));
  assert.equal(f.state().entries[0].status, "saved");
  const originalShot = f.state().entries[0].shot;
  const captureId = f.state().entries[0].captureId;

  // Mask refresh fails on page-one
  failCapture = true;
  await f.engine.sync({ ...input("page-one", ["a"]), refreshShot: true });
  assert.equal(f.state().entries[0].status, "pending");
  assert.equal(f.state().entries[0].shot, originalShot);

  // User navigates to page-two: entry-a remains pending with original shot preserved
  failCapture = false;
  await f.engine.sync(input("page-two", ["b"]));
  assert.equal(f.state().entries.length, 2);
  const entryA = f.state().entries.find((e) => e.captureId === captureId);
  assert.equal(entryA.status, "pending");
  assert.equal(entryA.shot, originalShot);
  await assert.rejects(f.engine.finish(), /session_pending/);

  // Removing the pending entry from review allows completing the session
  await f.engine.remove(captureId);
  await f.engine.finish();
  assert.equal(f.state(), null);
});

// Wires the session's publish step exactly like the worker: saved copy mode → clipboard.
function handoffFixture(mode, flags = {}) {
  const base = "http://127.0.0.1:17373/", markdown = "# Prompt body";
  const io = { fetched: [], clipboard: [], flags };
  const f = fixture({
    publish: (draft) => copyReviewHandoff(draft, {
      base,
      mode,
      fetchMarkdown: async (item) => {
        io.fetched.push(item.id);
        if (flags.failFetch) throw new Error("copy_failed_500");
        return markdown;
      },
      writeClipboard: async (text) => {
        if (flags.failWrite) throw new Error("clipboard_denied");
        io.clipboard.push(text);
      },
    }),
  });
  return { ...f, io };
}

test("finishing in prompt mode copies the authenticated Markdown body", async () => {
  const f = handoffFixture("prompt");
  await f.engine.sync(input("page", ["a"]));
  await f.engine.finish();
  assert.deepEqual(f.io.fetched, ["review"]);
  assert.deepEqual(f.io.clipboard, ["# Prompt body"]);
  assert.equal(f.state(), null);
});

test("finishing in link mode copies only the bundle URL without fetching Markdown", async () => {
  const f = handoffFixture("link");
  await f.engine.sync(input("page", ["a"]));
  await f.engine.finish();
  assert.deepEqual(f.io.fetched, []);
  assert.deepEqual(f.io.clipboard, ["http://127.0.0.1:17373/b/review.md"]);
  assert.doesNotMatch(f.io.clipboard[0], /token|key|[?#]/i);
  assert.equal(f.state(), null);
});

test("finishing with copy off concludes the session and leaves the clipboard alone", async () => {
  const f = handoffFixture("off");
  await f.engine.sync(input("page", ["a"]));
  await f.engine.finish();
  assert.deepEqual([f.io.fetched, f.io.clipboard], [[], []]);
  assert.deepEqual(f.calls.filter(([kind]) => kind === "finish"), [["finish"]]);
  assert.equal(f.state(), null);
});

test("an unknown saved mode falls back to prompt", async () => {
  const f = handoffFixture("bogus");
  await f.engine.sync(input("page", ["a"]));
  await f.engine.finish();
  assert.deepEqual(f.io.clipboard, ["# Prompt body"]);
});

test("entries record the workspace view captured with them", async () => {
  const f = fixture();
  await f.engine.sync({ page: { title: "one", url: "https://pages.test/one" }, pins: [{ comment: "a", id: "a", pinId: "a" }], source: "t1:one", workspaceView: "view-one" });
  await f.engine.sync({ page: { title: "two", url: "https://pages.test/two" }, pins: [{ comment: "b", id: "b", pinId: "b" }], source: "t1:two" });
  assert.equal(f.state().entries[0].workspaceView, "view-one");
  assert.equal(f.state().entries[1].workspaceView, null);
});

test("page restore matches sanitized url and workspace view, keeps pending and drops deleted", async () => {
  const comment = "restore me";
  const geometry = { box: { height: 40, width: 120, x: 12, y: 34 }, location: { confidence: "exact", strategy: "stable-selector" } };
  const f = fixture({ save: async (entry) => { if ((entry.pin.pinId || entry.pin.id) === "b") throw new Error("offline"); return { path: "shot" }; } });
  await f.engine.sync({
    page: { title: "one", url: "https://pages.test/one" },
    pins: [{ ...geometry, comment, id: "a", pinId: "a" }, { ...geometry, comment, id: "b", pinId: "b" }],
    source: "tab-1:one",
    workspaceView: "view-one",
  });
  await f.engine.sync({
    page: { title: "two", url: "https://pages.test/two" },
    pins: [{ comment, id: "c", pinId: "c" }],
    source: "tab-1:two",
  });
  assert.equal(f.state().entries[0].status, "saved");
  assert.equal(f.state().entries[1].status, "pending");
  await f.engine.remove(f.state().entries[0].captureId);

  const restored = restoreEntriesForPage(f.state(), { pageUrl: "https://pages.test/one", workspaceView: "view-one" });
  assert.equal(restored.length, 1, "deleted entry stays excluded");
  assert.equal(restored[0].pin.pinId, "b");
  assert.equal(restored[0].status === undefined, true);
  assert.equal(restored[0].shot, undefined);
  assert.deepEqual(restored[0].pin.box, geometry.box);
  assert.deepEqual(restored[0].pin.location, geometry.location);
  assert.equal(restored[0].pin.comment, comment);
  assert.equal(restored[0].pin.number, 2);
  assert.equal(restored[0].captureId, f.state().entries[1].captureId);
  assert.doesNotMatch(JSON.stringify(restored), /image:capture-|shot/);

  const pending = restoreEntriesForPage(f.state(), { pageUrl: "https://pages.test/two" });
  assert.equal(pending.length, 1, "workspace view defaults to null");
  assert.equal(pending[0].pin.pinId, "c");

  assert.deepEqual(restoreEntriesForPage(f.state(), { pageUrl: "https://pages.test/one", workspaceView: "view-two" }), []);
  assert.deepEqual(restoreEntriesForPage(f.state(), { pageUrl: "https://pages.test/other" }), []);
  for (const hostile of [null, undefined, 123, "__proto__", { url: "x" }]) {
    assert.deepEqual(restoreEntriesForPage(f.state(), { pageUrl: hostile }), [], String(hostile));
  }
  for (const hostile of [null, undefined, {}]) {
    assert.deepEqual(restoreEntriesForPage(hostile, { pageUrl: "https://pages.test/one" }), [], String(hostile));
  }
});

test("finished or discarded drafts restore nothing", async () => {
  const f = fixture();
  await f.engine.sync({ page: { title: "one", url: "https://pages.test/one" }, pins: [{ id: "a", pinId: "a", comment: "c" }], source: "tab-1:one" });
  await f.engine.finish();
  assert.deepEqual(restoreEntriesForPage(await f.engine.read(), { pageUrl: "https://pages.test/one" }), []);
  await f.engine.sync({ page: { title: "one", url: "https://pages.test/one" }, pins: [{ id: "b", pinId: "b", comment: "c" }], source: "tab-1:one" });
  await f.engine.discard();
  assert.equal(await f.engine.read(), null);
  assert.deepEqual(restoreEntriesForPage(null, { pageUrl: "https://pages.test/one" }), []);
});

test("page restore keeps each pin in its own frame by stable dom path prefix", async () => {
  const box = { height: 40, width: 120, x: 12, y: 34 };
  const f = fixture();
  await f.engine.sync({
    page: { title: "host", url: "https://pages.test/host" },
    pins: [
      { box, comment: "top", id: "a", pinId: "a", path: "body > button#top" },
      { box, comment: "frame", id: "b", pinId: "b", path: "body > iframe#fr ::frame:: body > button#in-frame" },
      { box, comment: "nested", id: "c", pinId: "c", path: "body > iframe#outer ::frame:: body > div > iframe#inner ::frame:: body > button#deep" },
    ],
    source: "tab-1:host",
    workspaceView: "view-one",
  });
  const draft = f.state();
  const top = restoreEntriesForPage(draft, { pageUrl: "https://pages.test/host", workspaceView: "view-one" });
  assert.deepEqual(top.map((item) => item.pin.pinId), ["a"], "top frame gets only top pins");
  const frame = restoreEntriesForPage(draft, { pageUrl: "https://pages.test/host", workspaceView: "view-one", framePath: "body > iframe#fr" });
  assert.equal(frame.length, 1, "child frame gets only its own pin");
  assert.equal(frame[0].pin.pinId, "b");
  assert.equal(frame[0].pin.path, "body > iframe#fr ::frame:: body > button#in-frame", "local geometry stays as stored");
  assert.equal(frame[0].pin.comment, "frame");
  assert.equal(frame[0].pin.number, 2);
  assert.equal(frame[0].captureId, draft.entries[1].captureId);
  assert.equal(frame[0].shot, undefined);
  const nested = restoreEntriesForPage(draft, { pageUrl: "https://pages.test/host", workspaceView: "view-one", framePath: "body > iframe#outer ::frame:: body > div > iframe#inner" });
  assert.deepEqual(nested.map((item) => item.pin.pinId), ["c"], "nested frame matches its full prefix");
  assert.deepEqual(restoreEntriesForPage(draft, { pageUrl: "https://pages.test/host", workspaceView: "view-one", framePath: "body > iframe#outer" }), [], "a parent/sibling frame never gets a child pin");
  assert.deepEqual(restoreEntriesForPage(draft, { pageUrl: "https://pages.test/host", workspaceView: "view-one", framePath: "body > iframe#other" }), [], "an unrelated sibling frame gets nothing");
});

test("entries without a frame path restore only on the top frame", async () => {
  const f = fixture();
  await f.engine.sync({
    page: { title: "host", url: "https://pages.test/host" },
    pins: [{ comment: "legacy", id: "a", pinId: "a" }],
    source: "tab-1:host",
  });
  const draft = f.state();
  assert.deepEqual(restoreEntriesForPage(draft, { pageUrl: "https://pages.test/host" }).map((item) => item.pin.pinId), ["a"], "top frame restores legacy pins");
  assert.deepEqual(restoreEntriesForPage(draft, { pageUrl: "https://pages.test/host", framePath: "body > iframe#fr" }), [], "a child frame is never silently assigned legacy pins");
});

test("a Markdown fetch or clipboard failure keeps the session recoverable and a retry converges", async () => {
  for (const [mode, flag, error] of [["prompt", "failFetch", /copy_failed_500/], ["prompt", "failWrite", /clipboard_denied/], ["link", "failWrite", /clipboard_denied/]]) {
    const f = handoffFixture(mode, { [flag]: true });
    await f.engine.sync(input("page", ["a"]));
    const captureId = f.state().entries[0].captureId;
    await assert.rejects(f.engine.finish(), error);
    assert.equal(f.state().entries.length, 1);
    assert.equal(f.state().entries[0].status, "saved");
    assert.deepEqual(f.io.clipboard, []);
    // Same draft and IDs: once the copy works again the session concludes.
    f.io.flags[flag] = false;
    await f.restart().finish();
    assert.equal(f.state(), null);
    assert.equal(f.io.clipboard.length, 1);
    assert.equal(f.calls.filter(([kind, id]) => kind === "save" && id === captureId).length, 1);
  }
});
