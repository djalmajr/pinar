import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { startShotServer } from "./http.mjs";
import { decodeDataUrl, migrateNestedShots, safeShotName, writeShot } from "./shots.mjs";

describe("shots", () => {
  test("safeShotName strips path characters", () => {
    // Mutation captured: writing ../../etc/passwd.png from a hostile pin id.
    assert.equal(safeShotName("../../etc/passwd"), "etcpasswd.png");
  });

  test("writeShot stores png bytes in one shots directory", async () => {
    // Mutation captured: treating ~/.pinar/shots as the app root creates shots/shots.
    const root = await mkdtemp(join(tmpdir(), "pinar-shots-"));
    const png = Uint8Array.from([137, 80, 78, 71]);
    const dataUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    const path = await writeShot("pin_1", dataUrl, root);
    assert.equal(path, join(root, "shots", "pin_1.png"));
    assert.deepEqual(await readFile(path), Buffer.from(png));
    assert.deepEqual(decodeDataUrl(dataUrl), png);
  });

  test("writeShot treats a root named shots as the app root", async () => {
    // Mutation captured: the old endsWith("shots") heuristic silently changes root semantics.
    const parent = await mkdtemp(join(tmpdir(), "pinar-root-name-"));
    const root = join(parent, "shots");
    const path = await writeShot("pin_2", "data:image/png;base64,iVBORw==", root);
    assert.equal(path, join(root, "shots", "pin_2.png"));
  });

  test("migrateNestedShots flattens an existing shots/shots directory", async () => {
    // Mutation captured: leaving screenshots created by the old double-shots root contract stranded.
    const root = await mkdtemp(join(tmpdir(), "pinar-nested-shots-"));
    const nested = join(root, "shots", "shots");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "legacy.png"), "png");
    const result = await migrateNestedShots(root);
    assert.deepEqual(result, { conflicts: [], moved: ["legacy.png"] });
    assert.equal(await readFile(join(root, "shots", "legacy.png"), "utf8"), "png");
    assert.equal(existsSync(nested), false);
  });

  test("POST /api/shots returns the absolute path", async () => {
    // Mutation captured: returning a relative filename the agent cannot open.
    const root = await mkdtemp(join(tmpdir(), "pinar-http-"));
    const { port, server } = await startShotServer({ port: 0, root });
    const png = Uint8Array.from([137, 80, 78, 71]);
    const res = await fetch(`http://127.0.0.1:${port}/api/shots`, {
      body: JSON.stringify({
        id: "abc",
        image: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.path, join(root, "shots", "abc.png"));
    assert.deepEqual(await readFile(body.path), Buffer.from(png));
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  test("local history serves the shared React app shell", async () => {
    // Mutation captured: local history drifted because it rendered a separate handwritten dashboard.
    const root = await mkdtemp(join(tmpdir(), "pinar-history-ui-"));
    const webRoot = join(root, "web");
    await mkdir(webRoot, { recursive: true });
    await writeFile(join(webRoot, "index.html"), '<main id="root">Shared Pinar app</main>');
    const { port, server } = await startShotServer({ port: 0, root, webRoot });
    const res = await fetch(`http://127.0.0.1:${port}/history`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.equal(html, '<main id="root">Shared Pinar app</main>');
    assert.doesNotMatch(html, /No expiry|7-Day/);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  test("local viewer serves the shared app and exposes one public session contract", async () => {
    // Mutation captured: the viewer depended on private history and a separate HTML renderer.
    const root = await mkdtemp(join(tmpdir(), "pinar-viewer-"));
    const webRoot = join(root, "web");
    await mkdir(webRoot, { recursive: true });
    await writeFile(join(webRoot, "index.html"), '<main id="root">Shared Pinar viewer</main>');
    const { port, server } = await startShotServer({ port: 0, root, webRoot });
    const png = Uint8Array.from([137, 80, 78, 71]);
    const createRes = await fetch(`http://127.0.0.1:${port}/api/shots`, {
      body: JSON.stringify({
        id: "viewer-1",
        image: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
        page: { title: "<script>alert(1)</script>", url: "https://example.com/?a=<b>" },
        pins: [{ comment: "<strong>Fix</strong>", number: 1 }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(createRes.status, 201);

    const viewerRes = await fetch(`http://127.0.0.1:${port}/v/viewer-1`);
    const html = await viewerRes.text();
    assert.equal(viewerRes.status, 200);
    assert.equal(html, '<main id="root">Shared Pinar viewer</main>');
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);

    const sessionRes = await fetch(`http://127.0.0.1:${port}/api/sessions/viewer-1`);
    const sessionBody = await sessionRes.json();
    assert.equal(sessionRes.status, 200);
    assert.equal(sessionBody.session.page.title, "<script>alert(1)</script>");
    assert.equal(sessionBody.session.pins[0].comment, "<strong>Fix</strong>");
    assert.match(sessionBody.session.shotUrl, /\/shots\/viewer-1\.png$/);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
});
