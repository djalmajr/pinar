import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { beginTrialLoad, decideAuthLoad, decideTrialLoad, type TrialLoadClock } from "./cloud-trial-load";

const activeTrial = {
  endsAt: "2026-10-09T10:00:00.000Z",
  startedAt: "2026-09-25T10:00:00.000Z",
  state: "active",
  uploadAllowed: true,
};

describe("options cloud trial loads", () => {
  test("applies trial when Options opens already signed in to Cloud", () => {
    const clock: TrialLoadClock = { id: 0 };
    const requestId = beginTrialLoad(clock);
    assert.deepEqual(decideTrialLoad({
      activeId: clock.id,
      requestId,
      responseMode: "cloud",
      responseOk: true,
      sessionKind: "account",
      storageMode: "cloud",
      trial: activeTrial,
    }), { type: "apply", trial: activeTrial });
  });

  test("drops a late status after logout or a newer account load", () => {
    const clock: TrialLoadClock = { id: 0 };
    const first = beginTrialLoad(clock);
    const second = beginTrialLoad(clock);
    const newer = {
      ...activeTrial,
      endsAt: "2026-11-01T00:00:00.000Z",
    };
    assert.equal(decideAuthLoad({
      activeId: clock.id,
      ok: true,
      requestId: first,
      session: { email: "old@example.com", kind: "account" },
    }).type, "ignore");
    assert.deepEqual(decideTrialLoad({
      activeId: clock.id,
      requestId: first,
      responseMode: "cloud",
      responseOk: true,
      sessionKind: "account",
      storageMode: "cloud",
      trial: activeTrial,
    }), { type: "ignore" });
    assert.deepEqual(decideTrialLoad({
      activeId: clock.id,
      requestId: second,
      responseMode: "cloud",
      responseOk: true,
      sessionKind: "account",
      storageMode: "cloud",
      trial: newer,
    }), { type: "apply", trial: newer });
  });

  test("local mode and a failed status clear the trial instead of inventing one", () => {
    const clock: TrialLoadClock = { id: 0 };
    const requestId = beginTrialLoad(clock);
    assert.deepEqual(decideTrialLoad({
      activeId: clock.id,
      requestId,
      responseMode: "cloud",
      responseOk: true,
      sessionKind: "account",
      storageMode: "local",
      trial: activeTrial,
    }), { type: "clear" });
    assert.deepEqual(decideTrialLoad({
      activeId: clock.id,
      failed: true,
      requestId,
      sessionKind: "account",
      storageMode: "cloud",
      trial: activeTrial,
    }), { type: "clear" });
    assert.deepEqual(decideTrialLoad({
      activeId: clock.id,
      requestId,
      responseOk: false,
      sessionKind: "account",
      storageMode: "cloud",
    }), { type: "clear" });
  });
});
