import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ACCOUNT_TAB_STATES } from "./account-tab-states";

describe("ACCOUNT_TAB_STATES", () => {
  test("covers each account-tab branch with a unique id", () => {
    const ids = ACCOUNT_TAB_STATES.map((state) => state.id);
    assert.deepEqual(ids, [
      "loading",
      "free-no-code",
      "free-generating",
      "free-code-ready",
      "free-copied",
      "free-regenerate",
      "free-expired",
      "free-email-sending",
      "free-email-sent",
      "free-email-filled",
      "free-email-verifying",
      "free-email-invalid",
      "free-unavailable",
      "paid-pro",
      "paid-founder",
    ]);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("keeps paid mocks on account sessions and free mocks off them", () => {
    const paid = ACCOUNT_TAB_STATES.filter((state) => state.id.startsWith("paid-"));
    assert.ok(paid.every((state) => state.session?.kind === "account"));
    assert.equal(ACCOUNT_TAB_STATES.find((state) => state.id === "free-code-ready")?.session?.kind, "installation");
    assert.equal(ACCOUNT_TAB_STATES.find((state) => state.id === "loading")?.authReady, false);
    assert.ok(ACCOUNT_TAB_STATES.find((state) => state.id === "free-unavailable")?.authError);
  });
});
