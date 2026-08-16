import assert from "node:assert/strict";
import http from "node:http";
import { describe, test } from "node:test";
import { canListen, findAvailablePort, findHealthyPort, isAddrInUse, isHealthy, waitHealthy } from "./ensure.mjs";
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

  test("isHealthy accepts only a Pinar health response", async () => {
    // Mutation captured: treating any listener on the port as a Pinar helper.
    assert.equal(await isHealthy(59999), false);
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "pinar" }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
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

  test("a bound port is unavailable", async () => {
    // Mutation captured: crashing ensure when another session already started the helper.
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    assert.equal(await canListen(port), false);
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    assert.equal(await canListen(port), true);
    assert.equal(isAddrInUse({ code: "EADDRINUSE" }), true);
  });

  test("findAvailablePort skips a busy non-pinar port", async () => {
    const blocker = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const busy = blocker.address().port;
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const free = probe.address().port;
    await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
    assert.equal(await findAvailablePort([busy, free]), free);
    assert.equal(await findHealthyPort([busy, free]), null);
    await new Promise((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));
  });
});
