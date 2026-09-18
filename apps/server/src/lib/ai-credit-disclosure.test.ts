import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const sources = [
  "../components/CollectionDesignSystemDialog.tsx",
  "../components/PinComponentPanel.tsx",
  "../components/PinDiagnosisPanel.tsx",
  "../components/ReproductionTimeline.tsx",
  "../pages/WebViewer.tsx",
];

describe("AI credit disclosure", () => {
  test("uses the shared cloud-only tooltip on every billable AI action", () => {
    for (const source of sources) {
      const contents = readFileSync(new URL(source, import.meta.url), "utf8");
      assert.match(contents, /<AiCreditCostHint\b/, source);
    }
  });

  test("does not repeat remaining-credit balances beside AI actions", () => {
    for (const source of sources) {
      const contents = readFileSync(new URL(source, import.meta.url), "utf8");
      assert.doesNotMatch(contents, /creditsRemaining/, source);
    }
  });
});
