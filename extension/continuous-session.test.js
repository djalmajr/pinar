import assert from "node:assert/strict";
import { test } from "node:test";
import { continuousSummary, createContinuousSession } from "./continuous-session.js";

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
