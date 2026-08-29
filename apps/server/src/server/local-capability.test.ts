import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  localCapabilityMatches,
  localCapabilityPath,
  readOrCreateLocalCapability,
  resetLocalCapabilityForTests,
  revokeLocalCapability,
  rotateLocalCapability,
} from "./local-capability";

let root = "";
let previousHome: string | undefined;
let previousGrace: string | undefined;

describe("local capability store", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    previousGrace = process.env.PINAR_CAPABILITY_GRACE_MS;
    root = await mkdtemp(join(tmpdir(), "pinar-capability-"));
    process.env.PINAR_HOME = root;
    delete process.env.PINAR_CAPABILITY_GRACE_MS;
    resetLocalCapabilityForTests();
  });

  afterEach(async () => {
    resetLocalCapabilityForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    if (previousGrace === undefined) delete process.env.PINAR_CAPABILITY_GRACE_MS;
    else process.env.PINAR_CAPABILITY_GRACE_MS = previousGrace;
    await rm(root, { force: true, recursive: true });
  });

  test("mints a 0600 store on first bootstrap and reuses it", async () => {
    const created = await readOrCreateLocalCapability();
    const again = await readOrCreateLocalCapability();
    assert.equal(again.current.secret, created.current.secret);
    const info = await stat(localCapabilityPath(root));
    assert.equal(info.mode & 0o777, 0o600);
    assert.equal(await localCapabilityMatches(created.current.secret), true);
    assert.equal(await localCapabilityMatches("not-the-secret"), false);
    assert.equal(await localCapabilityMatches(""), false);
  });

  test("rotation accepts the previous secret until the grace window elapses", async () => {
    const created = await readOrCreateLocalCapability();
    const rotated = await rotateLocalCapability(created.current.secret);
    assert.ok(rotated);
    assert.equal(await localCapabilityMatches(rotated.current.secret), true);
    assert.equal(await localCapabilityMatches(created.current.secret), true);
  });

  test("rotation keeps the previous secret only for the grace window", async () => {
    process.env.PINAR_CAPABILITY_GRACE_MS = "0";
    const created = await readOrCreateLocalCapability();
    const rotated = await rotateLocalCapability(created.current.secret);
    assert.ok(rotated);
    assert.notEqual(rotated.current.secret, created.current.secret);
    assert.equal(await localCapabilityMatches(rotated.current.secret), true);
    assert.equal(await localCapabilityMatches(created.current.secret), false);
    assert.equal(await rotateLocalCapability(created.current.secret), null);
  });

  test("revocation deletes the store so the next bootstrap mints a new secret", async () => {
    const created = await readOrCreateLocalCapability();
    assert.equal(await revokeLocalCapability("wrong"), false);
    assert.equal(await revokeLocalCapability(created.current.secret), true);
    const minted = await readOrCreateLocalCapability();
    assert.notEqual(minted.current.secret, created.current.secret);
    assert.equal(await localCapabilityMatches(created.current.secret), false);
  });
});
