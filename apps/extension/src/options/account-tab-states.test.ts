import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ACCOUNT_TAB_STATES } from "./account-tab-states";

describe("ACCOUNT_TAB_STATES", () => {
  test("covers each account-tab branch with a unique id", () => {
    const ids = ACCOUNT_TAB_STATES.map((state) => state.id);
    assert.deepEqual(ids, [
      "loading", "email-entry", "email-sending", "email-sent", "email-filled",
      "email-verifying", "email-invalid", "unavailable", "free-account", "paid-pro",
    ]);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("shows signed-out email flow and signed-in Free and Pro accounts", () => {
    assert.equal(ACCOUNT_TAB_STATES.find((state) => state.id === "email-entry")?.session, null);
    assert.equal(ACCOUNT_TAB_STATES.find((state) => state.id === "free-account")?.session?.kind, "account");
    assert.equal(ACCOUNT_TAB_STATES.find((state) => state.id === "paid-pro")?.session?.kind, "account");
    assert.equal(ACCOUNT_TAB_STATES.find((state) => state.id === "loading")?.authReady, false);
    assert.ok(ACCOUNT_TAB_STATES.find((state) => state.id === "unavailable")?.authError);
  });
});
