import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { aiErrorPresentation, byokCauseMessageKey, BYOK_CAUSE_CODES } from "./ai-error-presentation";

describe("aiErrorPresentation", () => {
  test("routes local and BYOK authentication failures to AI settings", () => {
    assert.deepEqual(aiErrorPresentation(401, "ai_auth_failed", "local"), {
      messageKey: "viewer.aiConfigure",
      recovery: "settings",
    });
    assert.deepEqual(aiErrorPresentation(502, "ai_scope_denied", "local"), {
      messageKey: "viewer.aiConfigure",
      recovery: "settings",
    });
    assert.deepEqual(aiErrorPresentation(503, "ai_endpoint_unavailable", "local"), {
      messageKey: "viewer.aiConfigure",
      recovery: "settings",
    });
  });

  test("keeps Pinar Cloud billing and sign-in recoveries cloud-only", () => {
    assert.deepEqual(aiErrorPresentation(401, "unauthorized", "cloud"), {
      messageKey: "viewer.aiSignIn",
      recovery: "signIn",
    });
    assert.deepEqual(aiErrorPresentation(402, "insufficient_ai_credits", "cloud"), {
      messageKey: "viewer.aiNoCredits",
      recovery: "pricing",
    });
    assert.deepEqual(aiErrorPresentation(401, "ai_auth_failed", "local"), {
      messageKey: "viewer.aiConfigure",
      recovery: "settings",
    });
  });
});

describe("byok_error (F5/S3b: the cause and the credits offer)", () => {
  test("every cause maps to its own key, in 429 (rate_limited) and 502 (the rest)", () => {
    for (const cause of BYOK_CAUSE_CODES) {
      const status = cause === "rate_limited" ? 429 : 502;
      assert.deepEqual(aiErrorPresentation(status, "byok_error", "cloud", cause), {
        messageKey: `byok.cause.${cause}` as `byok.cause.${typeof cause}`,
        recovery: "byok",
      });
    }
  });

  test("a byok_error without a readable cause falls back to the generic BYOK note", () => {
    assert.deepEqual(aiErrorPresentation(502, "byok_error", "cloud", null), {
      messageKey: "byok.errorGeneric",
      recovery: "byok",
    });
    assert.deepEqual(aiErrorPresentation(502, "byok_error", "cloud", ""), {
      messageKey: "byok.errorGeneric",
      recovery: "byok",
    });
    assert.deepEqual(aiErrorPresentation(502, "byok_error", "cloud", "not_a_cause"), {
      messageKey: "byok.errorGeneric",
      recovery: "byok",
    });
    // byokCauseMessageKey is the shared cause-text lookup (settings, assistant
    // and reproduction all use it).
    assert.equal(byokCauseMessageKey("timeout"), "byok.cause.timeout");
    assert.equal(byokCauseMessageKey(undefined), "byok.errorGeneric");
  });

  test("the cause codes are the 12 of the common table", () => {
    assert.deepEqual([...BYOK_CAUSE_CODES].sort(), [
      "egress_unavailable",
      "endpoint_blocked",
      "endpoint_unreachable",
      "invalid_response",
      "key_rejected",
      "model_not_configured",
      "model_not_found",
      "rate_limited",
      "scope_denied",
      "service_disabled",
      "timeout",
      "unavailable",
    ]);
  });
});
