import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withExtensionResponseFallback } from "./extension-response";

describe("extension response fallback", () => {
  test("turns an absent service-worker response into a localized failure", () => {
    // Mutation captured: returning the absent response makes the options page
    // read `.ok` from undefined and expose a TypeError to the user.
    assert.deepEqual(
      withExtensionResponseFallback(undefined, "O serviço de conta está indisponível."),
      { error: "O serviço de conta está indisponível.", ok: false },
    );
  });

  test("preserves a successful response", () => {
    const response = { ok: true, session: { kind: "local", plan: "free" } };
    assert.equal(withExtensionResponseFallback(response, "unavailable"), response);
  });
});
