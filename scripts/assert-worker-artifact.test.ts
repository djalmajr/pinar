import { describe, expect, test } from "bun:test";
import { assertWorkerArtifact } from "./assert-worker-artifact.mjs";

describe("assertWorkerArtifact", () => {
  test("accepts a matching production artifact", () => {
    expect(assertWorkerArtifact("production", { name: "pinar-prd", targetEnvironment: "production" })).toEqual({
      name: "pinar-prd",
      targetEnvironment: "production",
    });
  });

  test("rejects a staging artifact used for production", () => {
    expect(() => assertWorkerArtifact("production", { name: "pinar-stg", targetEnvironment: "staging" })).toThrow(
      "targetEnvironment is staging",
    );
  });

  test("accepts a matching staging artifact", () => {
    expect(assertWorkerArtifact("staging", { name: "pinar-stg", targetEnvironment: "staging" }).name).toBe("pinar-stg");
  });
});
