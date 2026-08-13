import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isAddrInUse, isHealthy, waitHealthy } from "./ensure.mjs";
import { startShotServer } from "./http.mjs";

describe("ensure", () => {
  test("isHealthy is true only after the shot server binds", async () => {
    // Mutation captured: treating any listener on the port as a Pinar helper.
    assert.equal(await isHealthy(59999), false);
    const { port, server } = await startShotServer({ port: 0, root: "/tmp/pinar-ensure" });
    assert.equal(await isHealthy(port), true);
    assert.equal(await waitHealthy(port, 200), true);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    assert.equal(await isHealthy(port), false);
  });

  test("a second bind on the same port is address-in-use", async () => {
    // Mutation captured: crashing ensure when another session already started the helper.
    const { port, server } = await startShotServer({ port: 0, root: "/tmp/pinar-ensure" });
    let error;
    try {
      await startShotServer({ port, root: "/tmp/pinar-ensure" });
    } catch (caught) {
      error = caught;
    }
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    assert.equal(isAddrInUse(error), true);
  });
});
