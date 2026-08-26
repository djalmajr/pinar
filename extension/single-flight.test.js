import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSingleFlight } from "./single-flight.js";

describe("single-flight", () => {
  test("shares one in-flight registration for concurrent requests with the same identity", async () => {
    const singleFlight = createSingleFlight();
    let calls = 0;
    let resolveOperation;
    const operation = () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveOperation = resolve;
      });
    };

    const first = singleFlight("https://pinar.dev:ins_same", operation);
    const second = singleFlight("https://pinar.dev:ins_same", operation);

    assert.equal(calls, 0);
    await Promise.resolve();
    assert.equal(calls, 1);
    resolveOperation({ accepted: true });
    assert.deepEqual(await Promise.all([first, second]), [
      { accepted: true },
      { accepted: true },
    ]);
  });

  test("clears a failed operation so a later registration can retry", async () => {
    const singleFlight = createSingleFlight();
    let calls = 0;
    const operation = () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return "registered";
    };

    await assert.rejects(singleFlight("installation", operation), /temporary failure/);
    assert.equal(await singleFlight("installation", operation), "registered");
    assert.equal(calls, 2);
  });
});
