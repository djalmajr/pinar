import assert from "node:assert/strict";
import http from "node:http";
import { describe, test } from "node:test";
import { findHealthyPort, isAddrInUse, isHealthy, listenFirstFree, waitHealthy } from "./ensure.mjs";
import { startShotServer } from "./http.mjs";
import { portRange } from "./paths.mjs";

describe("ensure", () => {
  test("portRange stays on 17373 unless PINAR_PORT is set", () => {
    assert.equal(portRange()[0], 17373);
    assert.equal(portRange().length, 10);
    const previous = process.env.PINAR_PORT;
    process.env.PINAR_PORT = "19001";
    try {
      assert.deepEqual(portRange(), [19001]);
    } finally {
      if (previous == null) delete process.env.PINAR_PORT;
      else process.env.PINAR_PORT = previous;
    }
  });

  test("isHealthy is true only after the shot server binds", async () => {
    // Mutation captured: treating any listener on the port as a Pinar helper.
    assert.equal(await isHealthy(59999), false);
    const { port, server } = await startShotServer({ port: 0, root: "/tmp/pinar-ensure" });
    assert.equal(await isHealthy(port), true);
    assert.equal(await waitHealthy(port, 200), port);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    assert.equal(await isHealthy(port), false);
  });

  test("a generic {ok:true} listener is not the Pinar helper", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    assert.equal(await isHealthy(port), false);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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

  test("listenFirstFree skips a busy non-pinar port", async () => {
    const blocker = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const busy = blocker.address().port;
    const started = await listenFirstFree({
      ports: [busy, 0],
      root: "/tmp/pinar-ensure",
    });
    assert.equal(started.existing, false);
    assert.notEqual(started.port, busy);
    assert.equal(await findHealthyPort([busy, started.port]), started.port);
    await new Promise((resolve, reject) => started.server.close((error) => (error ? reject(error) : resolve())));
    await new Promise((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));
  });
});
