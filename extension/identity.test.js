import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createInstallationIdentity,
  ensureInstallationIdentity,
  installationAuthHeaders,
  isInstallationIdentity,
  replaceInstallationIdentity,
} from "./identity.js";

function deterministicRandom(bytes) {
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index + 1;
  return bytes;
}

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    async get(defaults) {
      return { ...defaults, ...values };
    },
    async set(next) {
      Object.assign(values, next);
    },
    values,
  };
}

describe("installation identity", () => {
  test("creates a cryptographically shaped installation id and secret", () => {
    const identity = createInstallationIdentity(deterministicRandom);
    assert.equal(isInstallationIdentity(identity), true);
    assert.match(identity.id, /^ins_[A-Za-z0-9_-]{24}$/);
    assert.match(identity.token, /^pit_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(identity.id, identity.token);
  });

  test("installation identity is generated once and kept in local storage", async () => {
    const storage = memoryStorage();
    const first = await ensureInstallationIdentity(storage, deterministicRandom);
    const second = await ensureInstallationIdentity(storage, () => {
      throw new Error("must not regenerate");
    });
    assert.deepEqual(second, first);
    assert.equal(storage.values.installationId, first.id);
    assert.equal(storage.values.installationToken, first.token);
  });

  test("replacement is explicit and auth headers never confuse id with secret", async () => {
    const storage = memoryStorage();
    const previous = await ensureInstallationIdentity(storage, deterministicRandom);
    const next = createInstallationIdentity((bytes) => {
      bytes.fill(42);
      return bytes;
    });
    await replaceInstallationIdentity(storage, next);
    assert.notDeepEqual(next, previous);
    assert.deepEqual(installationAuthHeaders(next), {
      authorization: `Bearer ${next.token}`,
      "x-pinar-installation-id": next.id,
    });
    assert.equal(storage.values.installationId, next.id);
    assert.equal(storage.values.installationToken, next.token);
  });
});
