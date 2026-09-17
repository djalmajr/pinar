import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Reproduction } from "@pinar/shared";
import { mergeGeneratedReproduction } from "./reproduction-result";

const reproduction: Reproduction = {
  startedAt: "2026-09-08T10:00:00.000Z",
  steps: [{ at: "2026-09-08T10:00:01.000Z", kind: "click", value: "Sign in" }],
  version: 1,
};

describe("mergeGeneratedReproduction", () => {
  test("keeps the recorded timeline and installs the paid result returned by the API", () => {
    const merged = mergeGeneratedReproduction(reproduction, {
      generatedAt: "2026-09-17T10:00:00.000Z",
      model: "@cf/openai/gpt-oss-20b",
      steps: ["Click Sign in"],
      test: "import { test } from '@playwright/test';",
    });

    assert.ok(merged?.generated);
    assert.deepEqual(merged.steps, reproduction.steps);
    assert.equal(merged.generated.steps[0], "Click Sign in");
    assert.match(merged.generated.test, /playwright/);
  });

  test("rejects an unusable result instead of overwriting the stored recording", () => {
    assert.equal(mergeGeneratedReproduction(reproduction, { steps: [], test: "" }), null);
  });
});
