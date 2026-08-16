import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { decodeDataUrl, migrateNestedShots, safeShotName, writeShot } from "./shots.mjs";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("shots", () => {
  test("safeShotName strips path characters", () => {
    // Mutation captured: writing ../../etc/passwd.png from a hostile pin id.
    assert.equal(safeShotName("../../etc/passwd"), "etcpasswd.png");
  });

  test("writeShot stores png bytes in one shots directory", async () => {
    // Mutation captured: treating ~/.pinar/shots as the app root creates shots/shots.
    const root = await mkdtemp(join(tmpdir(), "pinar-shots-"));
    const png = decodeDataUrl(VALID_PNG);
    const path = await writeShot("pin_1", VALID_PNG, root);
    assert.equal(path, join(root, "shots", "pin_1.png"));
    assert.deepEqual(await readFile(path), Buffer.from(png));
    assert.deepEqual(decodeDataUrl(VALID_PNG), png);
  });

  test("writeShot treats a root named shots as the app root", async () => {
    // Mutation captured: the old endsWith("shots") heuristic silently changes root semantics.
    const parent = await mkdtemp(join(tmpdir(), "pinar-root-name-"));
    const root = join(parent, "shots");
    const path = await writeShot("pin_2", VALID_PNG, root);
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

});
