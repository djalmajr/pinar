import assert from "node:assert/strict";
import { describe, test } from "node:test";
import manifest from "./manifest.json" with { type: "json" };
import {
  DEVELOPMENT_EXTENSION_ID,
  DEVELOPMENT_EXTENSION_KEY,
  PRODUCTION_CLOUD_URL,
  STAGING_CLOUD_URL,
  cloudEnvironment,
  isDevelopmentExtension,
  requiresExplicitLegalConsent,
  resolveCloudUrl,
} from "./environment.js";

describe("extension runtime environment", () => {
  test("the unpacked repository build has the stable staging identity", () => {
    assert.equal(manifest.key, DEVELOPMENT_EXTENSION_KEY);
    assert.equal(DEVELOPMENT_EXTENSION_ID, "bobfbkbogoiemdcjchoakflgepmekdeh");
    assert.equal(isDevelopmentExtension(manifest), true);
    assert.equal(cloudEnvironment(manifest, PRODUCTION_CLOUD_URL), "staging");
    assert.equal(resolveCloudUrl(manifest, PRODUCTION_CLOUD_URL), STAGING_CLOUD_URL);
  });

  test("the Store build is pinned to production regardless of synced settings", () => {
    const storeManifest = { ...manifest, key: undefined };
    assert.equal(isDevelopmentExtension(storeManifest), false);
    assert.equal(cloudEnvironment(storeManifest, STAGING_CLOUD_URL), "production");
    assert.equal(resolveCloudUrl(storeManifest, STAGING_CLOUD_URL), PRODUCTION_CLOUD_URL);
    assert.equal(requiresExplicitLegalConsent(storeManifest, STAGING_CLOUD_URL), true);
  });

  test("the unpacked build preserves loopback cloud runtimes for isolated E2E", () => {
    assert.equal(cloudEnvironment(manifest, "http://127.0.0.1:17384/"), "local-cloud");
    assert.equal(resolveCloudUrl(manifest, "http://127.0.0.1:17384/"), "http://127.0.0.1:17384");
    assert.equal(resolveCloudUrl(manifest, "https://untrusted.example"), STAGING_CLOUD_URL);
    assert.equal(requiresExplicitLegalConsent(manifest, "http://127.0.0.1:17384/"), true);
  });

  test("only the stable unpacked staging profile skips explicit legal consent", () => {
    assert.equal(requiresExplicitLegalConsent(manifest, STAGING_CLOUD_URL), false);
  });
});
