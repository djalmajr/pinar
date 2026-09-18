import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { aiErrorPresentation } from "./ai-error-presentation";

describe("aiErrorPresentation", () => {
  test("routes local and BYOK authentication failures to AI settings", () => {
    assert.deepEqual(aiErrorPresentation(401, "ai_auth_failed", "local"), {
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
