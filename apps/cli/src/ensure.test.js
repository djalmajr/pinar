import assert from "node:assert/strict";
import http from "node:http";
import { describe, test } from "node:test";
import { canListen, findAvailablePort, findHealthyPort, isAddrInUse, isHealthy, waitHealthy } from "./ensure.mjs";
import { pinarHome, portRange, resolvePort } from "./paths.mjs";

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

  test("path configuration honors PINAR_HOME and rejects invalid ports", () => {
    // Mutation captured: ignoring PINAR_HOME writes personal history during isolated runs.
    const previousHome = process.env.PINAR_HOME;
    const previousPort = process.env.PINAR_PORT;
    process.env.PINAR_HOME = "/tmp/pinar-explicit-home";
    try {
      assert.equal(pinarHome(), "/tmp/pinar-explicit-home");
      for (const invalid of ["-1", "65536", "1.5", "not-a-port"]) {
        process.env.PINAR_PORT = invalid;
        assert.throws(() => resolvePort(), new RegExp(`Invalid PINAR_PORT: ${invalid.replace(".", "\\.")}`));
      }
    } finally {
      if (previousHome == null) delete process.env.PINAR_HOME;
      else process.env.PINAR_HOME = previousHome;
      if (previousPort == null) delete process.env.PINAR_PORT;
      else process.env.PINAR_PORT = previousPort;
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
    assert.equal(isAddrInUse(new Error("Failed to start server")), true);
    assert.equal(isAddrInUse("permission denied"), false);
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
    assert.equal(await findAvailablePort([busy]), null);
    assert.equal(await findHealthyPort([busy, free]), null);
    await new Promise((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));
  });

  test("waitHealthy performs a final probe after its deadline", async () => {
    // Mutation captured: dropping the final probe skips a helper that becomes healthy at the deadline.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "pinar" }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      // A zero deadline skips the polling loop, so success can only come from
      // the unconditional final probe. Keeping the server already listening
      // avoids a scheduler race under a loaded test runner.
      assert.equal(await waitHealthy(port, 0), port);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  test("canListen rejects unexpected socket errors", async () => {
    // Mutation captured: treating every listen error as EADDRINUSE hides invalid host failures.
    await assert.rejects(canListen(0, "256.256.256.256"), /ENOTFOUND|EINVAL/);
  });
});
