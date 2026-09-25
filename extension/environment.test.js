import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const developmentManifest = { ...manifest, key: DEVELOPMENT_EXTENSION_KEY };
const extensionId = (key) => [...createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");

describe("extension runtime environment", () => {
  test("the unpacked repository build has a recognized development or production identity", () => {
    const id = extensionId(manifest.key);
    assert.ok([DEVELOPMENT_EXTENSION_ID, "idpeaokdndjedekacfdfbilcolpholbo"].includes(id));
    assert.equal(resolveCloudUrl(manifest), id === DEVELOPMENT_EXTENSION_ID ? STAGING_CLOUD_URL : PRODUCTION_CLOUD_URL);
  });

  test("the development identity remains pinned to staging", () => {
    assert.equal(DEVELOPMENT_EXTENSION_ID, "bobfbkbogoiemdcjchoakflgepmekdeh");
    assert.equal(isDevelopmentExtension(developmentManifest), true);
    assert.equal(cloudEnvironment(developmentManifest, PRODUCTION_CLOUD_URL), "staging");
    assert.equal(resolveCloudUrl(developmentManifest, PRODUCTION_CLOUD_URL), STAGING_CLOUD_URL);
  });

  test("the Store build is pinned to production regardless of synced settings", () => {
    const storeManifest = { ...manifest, key: undefined };
    assert.equal(isDevelopmentExtension(storeManifest), false);
    assert.equal(cloudEnvironment(storeManifest, STAGING_CLOUD_URL), "production");
    assert.equal(resolveCloudUrl(storeManifest, STAGING_CLOUD_URL), PRODUCTION_CLOUD_URL);
    assert.equal(requiresExplicitLegalConsent(storeManifest, STAGING_CLOUD_URL), true);
  });

  test("the unpacked build preserves loopback cloud runtimes for isolated E2E", () => {
    assert.equal(cloudEnvironment(developmentManifest, "http://127.0.0.1:17384/"), "local-cloud");
    assert.equal(resolveCloudUrl(developmentManifest, "http://127.0.0.1:17384/"), "http://127.0.0.1:17384");
    assert.equal(resolveCloudUrl(developmentManifest, "https://untrusted.example"), STAGING_CLOUD_URL);
    assert.equal(requiresExplicitLegalConsent(developmentManifest, "http://127.0.0.1:17384/"), true);
  });

  test("only the stable unpacked staging profile skips explicit legal consent", () => {
    assert.equal(requiresExplicitLegalConsent(developmentManifest, STAGING_CLOUD_URL), false);
  });
});
