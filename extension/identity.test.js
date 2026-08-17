import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clearDeviceToken,
  createInstallationIdentity,
  deviceAuthHeaders,
  ensureInstallationIdentity,
  getDeviceToken,
  installationAuthHeaders,
  isInstallationIdentity,
  replaceInstallationIdentity,
  storeDeviceToken,
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
    async remove(key) {
      delete values[key];
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

  test("keeps the authenticated device token in local storage and clears it on logout", async () => {
    const storage = memoryStorage();
    const token = `pdt_${"d".repeat(43)}`;
    await storeDeviceToken(storage, token);
    assert.equal(await getDeviceToken(storage), token);
    assert.deepEqual(deviceAuthHeaders(token), { authorization: `Bearer ${token}` });
    await clearDeviceToken(storage);
    assert.equal(await getDeviceToken(storage), "");
    assert.equal("deviceToken" in storage.values, false);
  });

  test("rejects malformed device tokens", async () => {
    const storage = memoryStorage();
    await assert.rejects(() => storeDeviceToken(storage, "bad"), /Invalid device token/);
    assert.throws(() => deviceAuthHeaders("bad"), /Invalid device token/);
  });
});
