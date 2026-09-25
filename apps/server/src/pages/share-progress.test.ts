import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shareControlState } from "../lib/share-control-state";

describe("session share progress labels", () => {
  test("keeps Publishing until onShareChange finishes, then shows copy and revoke", () => {
    const started = shareControlState({ operation: "publish", revokeSettled: false, token: null });
    assert.equal(started.branch, "publish");
    assert.equal(started.publishLabel, "publishing");
    assert.equal(started.publishDisabled, true);

    const tokenReady = shareControlState({ operation: "publish", revokeSettled: false, token: "tok" });
    assert.equal(tokenReady.branch, "publish");
    assert.equal(tokenReady.publishLabel, "publishing");
    assert.equal(tokenReady.publishDisabled, true);

    const done = shareControlState({ operation: null, revokeSettled: false, token: "tok" });
    assert.equal(done.branch, "shared");
    assert.equal(done.copyEnabled, true);
    assert.equal(done.revokeLabel, "revoke");
    assert.equal(done.revokeDisabled, false);
  });

  test("keeps Revoking and blocks a revoked token until the refresh finishes, then shows Publish", () => {
    const started = shareControlState({ operation: "revoke", revokeSettled: false, token: "tok" });
    assert.equal(started.branch, "shared");
    assert.equal(started.revokeLabel, "revoking");
    assert.equal(started.revokeDisabled, true);
    assert.equal(started.copyEnabled, true);

    const revoked = shareControlState({ operation: "revoke", revokeSettled: true, token: null });
    assert.equal(revoked.branch, "shared");
    assert.equal(revoked.revokeLabel, "revoking");
    assert.equal(revoked.revokeDisabled, true);
    assert.equal(revoked.copyEnabled, false);
    assert.notEqual(revoked.publishLabel, "publishing");

    const done = shareControlState({ operation: null, revokeSettled: false, token: null });
    assert.equal(done.branch, "publish");
    assert.equal(done.publishLabel, "publish");
    assert.equal(done.publishDisabled, false);
  });

  test("error returns to the confirmed token without swapping the idle labels", () => {
    const publishFailed = shareControlState({ operation: null, revokeSettled: false, token: null });
    assert.equal(publishFailed.branch, "publish");
    assert.equal(publishFailed.publishLabel, "publish");

    const revokeFailed = shareControlState({ operation: null, revokeSettled: false, token: "tok" });
    assert.equal(revokeFailed.branch, "shared");
    assert.equal(revokeFailed.revokeLabel, "revoke");
    assert.equal(revokeFailed.copyEnabled, true);
  });
});
