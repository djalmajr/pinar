import { PRODUCTION_CLOUD_URL } from "./environment.js";

function normalizedEndpoint(endpoint) {
  return String(endpoint || "").trim().replace(/\/+$/, "");
}

export function remoteProfileKey(endpoint, key) {
  return `remote:${normalizedEndpoint(endpoint)}:${key}`;
}

export function remoteProfileStorage(storage, endpoint) {
  const normalized = normalizedEndpoint(endpoint);
  const migrateLegacy = normalized === PRODUCTION_CLOUD_URL;
  const scopedKey = (key) => remoteProfileKey(normalized, key);

  return {
    async get(defaults) {
      const keys = Object.keys(defaults);
      const scopedKeys = keys.map(scopedKey);
      const stored = await storage.get(migrateLegacy ? [...scopedKeys, ...keys] : scopedKeys);
      const result = {};
      const migrated = {};
      const legacyKeys = [];

      for (const key of keys) {
        const remoteKey = scopedKey(key);
        if (Object.prototype.hasOwnProperty.call(stored, remoteKey)) {
          result[key] = stored[remoteKey];
        } else if (migrateLegacy && Object.prototype.hasOwnProperty.call(stored, key)) {
          result[key] = stored[key];
          migrated[remoteKey] = stored[key];
          legacyKeys.push(key);
        } else {
          result[key] = defaults[key];
        }
      }

      if (Object.keys(migrated).length) await storage.set(migrated);
      if (legacyKeys.length) await storage.remove(legacyKeys);
      return result;
    },

    async remove(keys) {
      const logicalKeys = Array.isArray(keys) ? keys : [keys];
      await storage.remove(logicalKeys.map(scopedKey));
      if (migrateLegacy) await storage.remove(logicalKeys);
    },

    async set(values) {
      await storage.set(Object.fromEntries(Object.entries(values).map(([key, value]) => [scopedKey(key), value])));
      if (migrateLegacy) await storage.remove(Object.keys(values));
    },
  };
}
