import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CloudEnv } from "../cloud-api";
import { ByokEgressUnavailableError, byokFetch, type ByokEgress } from "./fetch";

describe("byokFetch (F5/S1, A55)", () => {
  test("always refuses with ByokEgressUnavailableError, with or without BYOK_EGRESS", async () => {
    // The guard does not exist yet (S6): no egress at all, and no fallback.
    for (const env of [{}, { BYOK_EGRESS: "edger-guard" }] as CloudEnv[]) {
      await assert.rejects(
        byokFetch(env, "https://api.example.test/v1/chat/completions", { method: "POST" }),
        (error: unknown) => error instanceof ByokEgressUnavailableError,
      );
    }
  });

  test("the refusal carries no value, so it can be surfaced or logged safely", async () => {
    const url = "https://api.example.test/v1?sk-byok-test-secret=1";
    await assert.rejects(
      byokFetch({}, url),
      (error: unknown) =>
        error instanceof ByokEgressUnavailableError
        && !String(error.message).includes("api.example.test")
        && !String(error.message).includes("sk-byok-test-secret"),
    );
  });

  test("the signature is the injectable egress of the BYOK layer", async () => {
    // S2's capability tests (and their fakes) receive an egress through this
    // same signature; the S1 one is a refusal.
    const egress: ByokEgress = (url, init) => byokFetch({}, url, init);
    await assert.rejects(egress("https://api.example.test/v1/models"), (error: unknown) => error instanceof ByokEgressUnavailableError);
  });
});
