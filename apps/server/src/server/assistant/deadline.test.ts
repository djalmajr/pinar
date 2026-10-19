import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantTurnTimeoutError, afterAssistantTurnWrite, createAssistantTurnBudget } from "./deadline";
import { fakeTurnClock } from "./deadline.test-helpers";

// A write the turn waits for (afterAssistantTurnWrite): it never races the
// budget, and the budget is read only once it settled.
describe("afterAssistantTurnWrite", () => {
  function heldWrite<T>(value: T, options: { fail?: boolean } = {}) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const work = async () => {
      started += 1;
      await gate;
      if (options.fail) throw new Error("D1_ERROR: database is locked");
      return value;
    };
    return { release, started: () => started, work };
  }

  test("a write that lands within the budget resolves with its value", async () => {
    const clock = fakeTurnClock();
    const budget = createAssistantTurnBudget(clock);
    const write = heldWrite("ok");
    const pending = afterAssistantTurnWrite(budget, write.work);
    write.release();
    assert.equal(await pending, "ok");
    budget.dispose();
  });

  test("a write still pending when the budget runs out is waited for, then rejects with the turn timeout", async () => {
    const clock = fakeTurnClock();
    const budget = createAssistantTurnBudget(clock);
    const write = heldWrite("ok");
    let settled = false;
    const pending = afterAssistantTurnWrite(budget, write.work).finally(() => {
      settled = true;
    });
    const rejected = assert.rejects(pending, (error: unknown) => error instanceof AssistantTurnTimeoutError && error.phase === "turn");
    await clock.advance(300_000);
    assert.equal(budget.signal.aborted, true);
    assert.equal(settled, false, "no rejection while the write is pending");
    write.release();
    await rejected;
  });

  test("a write that fails after the budget ran out rejects with the turn timeout; with the budget left, with its own error", async () => {
    const clock = fakeTurnClock();
    const spent = createAssistantTurnBudget(clock);
    const late = heldWrite("ok", { fail: true });
    const pending = afterAssistantTurnWrite(spent, late.work);
    await clock.advance(240_000);
    late.release();
    await assert.rejects(pending, AssistantTurnTimeoutError);
    const live = createAssistantTurnBudget(clock);
    const failing = heldWrite("ok", { fail: true });
    const failed = afterAssistantTurnWrite(live, failing.work);
    failing.release();
    await assert.rejects(failed, /database is locked/);
    live.dispose();
  });

  test("with the budget already spent the write never starts", async () => {
    const budget = createAssistantTurnBudget(fakeTurnClock(), 0);
    const write = heldWrite("ok");
    write.release(); // A write that would land at once still never starts.
    await assert.rejects(afterAssistantTurnWrite(budget, write.work), AssistantTurnTimeoutError);
    assert.equal(write.started(), 0);
  });
});
