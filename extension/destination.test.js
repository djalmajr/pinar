import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { destinationKey, resolveDestinationPreference } from "./destination.js";

const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const optionsSrc = readFileSync(new URL("../apps/extension/src/options/OptionsApp.tsx", import.meta.url), "utf8");

const tree = {
  projects: [{
    collections: [{ id: "inbox", isProtected: true }, { id: "review", isProtected: false }],
    id: "personal",
  }],
};

describe("capture destination", () => {
  test("keeps local and each configured cloud server in separate preference buckets", () => {
    assert.equal(destinationKey({ storageMode: "local" }, "http://127.0.0.1:17373"), "local");
    assert.equal(destinationKey({ cloudUrl: "https://pinar.dev/", storageMode: "cloud" }), "cloud:https://pinar.dev");
    assert.equal(destinationKey({ cloudUrl: "https://staging.pinar.dev", storageMode: "cloud" }), "cloud:https://staging.pinar.dev");
  });

  test("falls back to the protected collection when a saved destination disappeared", () => {
    assert.deepEqual(resolveDestinationPreference(tree, { collectionId: "review" }), {
      collectionId: "review",
      projectId: "personal",
    });
    assert.deepEqual(resolveDestinationPreference(tree, { collectionId: "deleted" }), {
      collectionId: "inbox",
      projectId: "personal",
    });
  });

  test("resolves the destination in the background and sends the effective collection with captures", () => {
    assert.doesNotMatch(contentSrc, /data-ref="projectSelect"|data-ref="collectionSelect"|message\.destination/);
    assert.match(optionsSrc, /type: "destination:get"/);
    assert.match(optionsSrc, /collectionId, type: "destination:set"/);
    assert.match(optionsSrc, /flattenDestinationCollections\(destinationCollections\)/);
    assert.match(backgroundSrc, /getCaptureDestinationContext\(settings\)/);
    assert.match(backgroundSrc, /JSON\.stringify\(\{ collectionId, id, image: dataUrl, page, pins \}\)/);
    assert.match(backgroundSrc, /storeDestination\(settings, "", body\.destination\)/);
  });

  test("offers storage, preferences and account tabs without legacy credentials", () => {
    assert.match(optionsSrc, /<TabsTrigger value="storage">\{t\.tab_storage\}<\/TabsTrigger>/);
    assert.match(optionsSrc, /<TabsTrigger value="preferences">\{t\.tab_preferences\}<\/TabsTrigger>/);
    assert.match(optionsSrc, /<TabsTrigger value="account">\{t\.tab_account\}<\/TabsTrigger>/);
    assert.match(optionsSrc, /type: "auth:extension-code"/);
    assert.match(optionsSrc, /type: "auth:email-code:verify"/);
    assert.match(optionsSrc, /type: "auth:logout"/);
    assert.doesNotMatch(optionsSrc, /license|identity:regenerate|installationId/i);
  });

  test("opens every Pinar entry point at the configured homepage", () => {
    assert.match(optionsSrc, /type: "app:open"/);
    assert.match(backgroundSrc, /withLanguage\(`\$\{base\}\/`\)/);
    assert.doesNotMatch(backgroundSrc, /withLanguage\(`\$\{base\}\/app`\)/);
    assert.doesNotMatch(backgroundSrc, /browser-ticket|\/history/);
  });
});
