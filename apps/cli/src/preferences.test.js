import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { readDeliveryPreferences, writeDeliveryPreferences } from "./preferences.mjs";
import {
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

  test("defaults to delivering screenshots", () => {
    assert.deepEqual(readDeliveryPreferences(tempDir), { includeScreenshot: true });
  });

  test("persists includeScreenshot for the local helper", () => {
    assert.deepEqual(writeDeliveryPreferences({ includeScreenshot: false }, tempDir), {
      includeScreenshot: false,
    });
    assert.equal(readDeliveryPreferences(tempDir).includeScreenshot, false);
    assert.equal(writeDeliveryPreferences({}, tempDir).includeScreenshot, false);
  });

  test("treats numeric 0 as omitting the screenshot", () => {
    assert.equal(parseDeliveryPreferences({ includeScreenshot: 0 }).includeScreenshot, false);
    assert.equal(
      mergeDeliveryPreferences({ includeScreenshot: true }, { includeScreenshot: false }).includeScreenshot,
      false,
    );
  });
});
