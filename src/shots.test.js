import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { startShotServer } from "./http.mjs";
import { decodeDataUrl, safeShotName, writeShot } from "./shots.mjs";

describe("shots", () => {
  test("safeShotName strips path characters", () => {
    // Mutation captured: writing ../../etc/passwd.png from a hostile pin id.
    assert.equal(safeShotName("../../etc/passwd"), "etcpasswd.png");
  });

  test("writeShot stores png bytes under the screenshots dir", async () => {
    // Mutation captured: persisting the data URL string instead of decoded bytes.
    const root = await mkdtemp(join(tmpdir(), "pinar-shots-"));
    const png = Uint8Array.from([137, 80, 78, 71]);
    const dataUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    const path = await writeShot("pin_1", dataUrl, root);
    assert.equal(path.endsWith("pin_1.png"), true);
    assert.deepEqual(await readFile(path), Buffer.from(png));
    assert.deepEqual(decodeDataUrl(dataUrl), png);
  });

  test("POST /v1/shots returns the absolute path", async () => {
    // Mutation captured: returning a relative filename the agent cannot open.
    const root = await mkdtemp(join(tmpdir(), "pinar-http-"));
    const { port, server } = await startShotServer({ port: 0, root });
    const png = Uint8Array.from([137, 80, 78, 71]);
    const res = await fetch(`http://127.0.0.1:${port}/v1/shots`, {
      body: JSON.stringify({
        id: "abc",
        image: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.path.endsWith("abc.png"), true);
    assert.deepEqual(await readFile(body.path), Buffer.from(png));
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
});
