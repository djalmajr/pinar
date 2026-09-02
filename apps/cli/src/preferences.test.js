import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { readDeliveryPreferences, writeDeliveryPreferences } from "./preferences.mjs";
import {
  DEFAULT_DELIVERY_PREFERENCES,
  mergeDeliveryPreferences,
  parseDeliveryPreferences,
} from "../../../packages/shared/src/types/index.ts";

describe("delivery preferences", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pinar-preferences-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { force: true, recursive: true });
  });

  test("defaults to compact agent copies with screenshots", () => {
    assert.deepEqual(readDeliveryPreferences(tempDir), { ...DEFAULT_DELIVERY_PREFERENCES });
  });

  test("persists includeScreenshot for the local helper", () => {
    assert.deepEqual(writeDeliveryPreferences({ includeScreenshot: false }, tempDir), {
      ...DEFAULT_DELIVERY_PREFERENCES,
      includeScreenshot: false,
    });
    assert.equal(readDeliveryPreferences(tempDir).includeScreenshot, false);
    assert.equal(writeDeliveryPreferences({}, tempDir).includeScreenshot, false);
  });

  test("persists the handoff detail independently from the saved capture", () => {
    assert.deepEqual(writeDeliveryPreferences({ handoffMode: "full" }, tempDir), {
      ...DEFAULT_DELIVERY_PREFERENCES,
      handoffMode: "full",
    });
    assert.equal(readDeliveryPreferences(tempDir).handoffMode, "full");
    assert.equal(writeDeliveryPreferences({ handoffMode: "invalid" }, tempDir).handoffMode, "full");
  });

  test("keeps untouched keys when a partial patch is written", () => {
    writeDeliveryPreferences({
      copyOnFinishBatch: "link",
      includeViewer: false,
      language: "pt",
    }, tempDir);
    const next = writeDeliveryPreferences({ includeScreenshot: false, unknownKey: true }, tempDir);
    assert.deepEqual(next, {
      ...DEFAULT_DELIVERY_PREFERENCES,
      copyOnFinishBatch: "link",
      includeScreenshot: false,
      includeViewer: false,
      language: "pt",
    });
    assert.equal("unknownKey" in next, false);
  });

  test("treats numeric 0 as omitting the screenshot", () => {
    assert.equal(parseDeliveryPreferences({ includeScreenshot: 0 }).includeScreenshot, false);
    assert.equal(
      mergeDeliveryPreferences(
        { ...DEFAULT_DELIVERY_PREFERENCES, includeScreenshot: true },
        { includeScreenshot: false },
      ).includeScreenshot,
      false,
    );
  });
});
