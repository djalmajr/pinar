import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import manifest from "./manifest.json" with { type: "json" };
import {
  DEVELOPMENT_EXTENSION_ID,
  DEVELOPMENT_EXTENSION_KEY,
  LOCAL_CLOUD_URL,
  PRODUCTION_CLOUD_URL,
  cloudEnvironment,
  isDevelopmentExtension,
  requiresExplicitLegalConsent,
  resolveCloudUrl,
} from "./environment.js";

const developmentManifest = { ...manifest, key: DEVELOPMENT_EXTENSION_KEY };
const extensionId = (key) => [...createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");

describe("extension runtime environment", () => {
  test("the unpacked repository build uses the development identity and the local cloud default", () => {
    assert.equal(manifest.key, DEVELOPMENT_EXTENSION_KEY);
    assert.equal(extensionId(manifest.key), DEVELOPMENT_EXTENSION_ID);
    assert.equal(LOCAL_CLOUD_URL, "http://127.0.0.1:3000");
    assert.equal(resolveCloudUrl(manifest), LOCAL_CLOUD_URL);
    assert.equal(cloudEnvironment(manifest), "local-cloud");
  });

  test("the development identity ignores non-loopback synced settings and falls back to the local cloud", () => {
    assert.equal(DEVELOPMENT_EXTENSION_ID, "bobfbkbogoiemdcjchoakflgepmekdeh");
    assert.equal(isDevelopmentExtension(developmentManifest), true);
    assert.equal(cloudEnvironment(developmentManifest, PRODUCTION_CLOUD_URL), "local-cloud");
    assert.equal(resolveCloudUrl(developmentManifest, PRODUCTION_CLOUD_URL), LOCAL_CLOUD_URL);
    assert.equal(resolveCloudUrl(developmentManifest, "https://untrusted.example"), LOCAL_CLOUD_URL);
    assert.equal(resolveCloudUrl(developmentManifest, "https://pinar.dev/"), LOCAL_CLOUD_URL);
  });

  test("the Store build is pinned to production regardless of synced settings", () => {
    const storeManifest = { ...manifest, key: undefined };
    assert.equal(isDevelopmentExtension(storeManifest), false);
    assert.equal(cloudEnvironment(storeManifest, LOCAL_CLOUD_URL), "production");
    assert.equal(resolveCloudUrl(storeManifest, LOCAL_CLOUD_URL), PRODUCTION_CLOUD_URL);
    assert.equal(resolveCloudUrl(storeManifest, PRODUCTION_CLOUD_URL), PRODUCTION_CLOUD_URL);
    assert.equal(requiresExplicitLegalConsent(), true);
  });

  test("the unpacked build preserves loopback cloud runtimes for isolated E2E", () => {
    assert.equal(cloudEnvironment(developmentManifest, "http://127.0.0.1:17384/"), "local-cloud");
    assert.equal(resolveCloudUrl(developmentManifest, "http://127.0.0.1:17384/"), "http://127.0.0.1:17384");
    assert.equal(resolveCloudUrl(developmentManifest, "http://localhost:17384"), "http://localhost:17384");
    assert.equal(requiresExplicitLegalConsent(), true);
  });

  test("every environment requires explicit legal consent", () => {
    assert.equal(cloudEnvironment({ ...manifest, key: undefined }, PRODUCTION_CLOUD_URL), "production");
    assert.equal(requiresExplicitLegalConsent(), true);
    assert.equal(cloudEnvironment(developmentManifest, LOCAL_CLOUD_URL), "local-cloud");
    assert.equal(requiresExplicitLegalConsent(), true);
  });
});
