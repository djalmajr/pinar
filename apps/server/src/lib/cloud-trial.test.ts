import { describe, expect, it } from "bun:test";
import { cloudTrialAccess, newCloudTrialWindow } from "./cloud-trial";

describe("Cloud trial policy", () => {
  it("allows a new Free account until the exact 14-day boundary", () => {
    const started = new Date("2026-09-25T10:00:00.000Z");
    const window = newCloudTrialWindow(started);
    expect(window.endsAt).toBe("2026-10-09T10:00:00.000Z");
    expect(cloudTrialAccess({ enabled: true, now: new Date("2026-10-09T09:59:59.999Z"), plan: "free", ...window })).toMatchObject({ state: "active", uploadAllowed: true });
    expect(cloudTrialAccess({ enabled: true, now: new Date(window.endsAt), plan: "free", ...window })).toMatchObject({ state: "expired", uploadAllowed: false });
  });

  it("preserves legacy Free access and paid access after the switch", () => {
    const now = new Date("2026-10-15T00:00:00.000Z");
    expect(cloudTrialAccess({ enabled: true, endsAt: null, now, plan: "free", startedAt: null })).toMatchObject({ state: "legacy", uploadAllowed: true });
    expect(cloudTrialAccess({ enabled: true, endsAt: "2026-10-09T10:00:00.000Z", now, plan: "pro", startedAt: "2026-09-25T10:00:00.000Z" })).toMatchObject({ state: "paid", uploadAllowed: true });
    expect(cloudTrialAccess({ enabled: false, endsAt: "2026-10-09T10:00:00.000Z", now, plan: "free", startedAt: "2026-09-25T10:00:00.000Z" })).toMatchObject({ state: "disabled", uploadAllowed: true });
  });

  it("fails closed for an incomplete trial record instead of treating it as legacy", () => {
    expect(cloudTrialAccess({ enabled: true, endsAt: null, now: new Date("2026-10-15T00:00:00.000Z"), plan: "free", startedAt: "2026-09-25T10:00:00.000Z" })).toMatchObject({ state: "expired", uploadAllowed: false });
  });
});
