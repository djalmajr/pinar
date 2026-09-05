import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { remainingCodeCountdown } from "./account-code-countdown";

describe("remainingCodeCountdown", () => {
  test("formats minutes and seconds until expiry", () => {
    assert.deepEqual(
      remainingCodeCountdown("2026-08-18T00:05:00.000Z", Date.parse("2026-08-18T00:00:28.000Z")),
      { expired: false, time: "4:32" },
    );
  });

  test("reports expired at and after the deadline", () => {
    const deadline = "2026-08-18T00:05:00.000Z";
    assert.deepEqual(remainingCodeCountdown(deadline, Date.parse(deadline)), { expired: true, time: "0:00" });
    assert.deepEqual(
      remainingCodeCountdown(deadline, Date.parse("2026-08-18T00:06:00.000Z")),
      { expired: true, time: "0:00" },
    );
  });

  test("treats an unparseable timestamp as expired", () => {
    assert.deepEqual(remainingCodeCountdown("not-a-date", Date.now()), { expired: true, time: "0:00" });
  });
});
