import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LOCAL_CLOUD_URL, PRODUCTION_CLOUD_URL } from "./environment.js";
import { remoteProfileKey, remoteProfileStorage } from "./remote-profile.js";

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    async get(keys) {
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
      }
      return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, key in values ? values[key] : fallback]));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
    async set(next) {
      Object.assign(values, next);
    },
    values,
  };
}

describe("remote profile storage", () => {
  test("keeps identity, device session, and legal acceptance isolated by endpoint", async () => {
    const storage = memoryStorage();
    const production = remoteProfileStorage(storage, PRODUCTION_CLOUD_URL);
    const local = remoteProfileStorage(storage, LOCAL_CLOUD_URL);

    await production.set({ deviceToken: "prod-device", installationId: "prod-installation", remoteLegalAcceptance: { termsVersion: "prod" } });
    await local.set({ deviceToken: "local-device", installationId: "local-installation", remoteLegalAcceptance: { termsVersion: "local" } });

    assert.deepEqual(await production.get({ deviceToken: "", installationId: "", remoteLegalAcceptance: null }), {
      deviceToken: "prod-device",
      installationId: "prod-installation",
      remoteLegalAcceptance: { termsVersion: "prod" },
    });
    assert.deepEqual(await local.get({ deviceToken: "", installationId: "", remoteLegalAcceptance: null }), {
      deviceToken: "local-device",
      installationId: "local-installation",
      remoteLegalAcceptance: { termsVersion: "local" },
    });
  });

  test("migrates legacy remote state only into the production profile", async () => {
    const legacy = {
      deviceToken: "legacy-device",
      installationId: "legacy-installation",
      installationToken: "legacy-token",
      remoteLegalAcceptance: { termsVersion: "legacy" },
    };
    const storage = memoryStorage(legacy);

    const local = remoteProfileStorage(storage, LOCAL_CLOUD_URL);
    assert.deepEqual(await local.get({ installationId: "", remoteLegalAcceptance: null }), {
      installationId: "",
      remoteLegalAcceptance: null,
    });

    const production = remoteProfileStorage(storage, PRODUCTION_CLOUD_URL);
    assert.deepEqual(await production.get({ installationId: "", remoteLegalAcceptance: null }), {
      installationId: legacy.installationId,
      remoteLegalAcceptance: legacy.remoteLegalAcceptance,
    });
    assert.equal(storage.values.installationId, undefined);
    assert.equal(storage.values.remoteLegalAcceptance, undefined);
    assert.equal(storage.values[remoteProfileKey(PRODUCTION_CLOUD_URL, "installationId")], legacy.installationId);
  });
});
