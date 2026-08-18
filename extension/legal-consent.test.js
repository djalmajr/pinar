import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  acceptedRemoteLegalAcceptance,
  createRemoteLegalAcceptance,
  parseLegalBundle,
} from "./legal-consent.js";

const bundle = {
  acceptableUseUrl: "/legal/acceptable-use",
  privacyUrl: "/legal/privacy",
  termsUrl: "/legal/terms",
  version: "2026-08-18",
};

describe("remote legal consent", () => {
  test("accepts only a complete current legal bundle", () => {
    assert.deepEqual(parseLegalBundle(bundle), bundle);
    assert.equal(parseLegalBundle({ ...bundle, version: "latest" }), null);
    assert.equal(parseLegalBundle({ version: bundle.version }), null);
  });

  test("creates a locale-scoped acceptance and rejects a stale stored version", () => {
    const acceptance = createRemoteLegalAcceptance(bundle, "pt", "2026-08-18T12:00:00.000Z");
    assert.deepEqual(acceptance, {
      acceptableUseVersion: bundle.version,
      accepted: true,
      acceptedAt: "2026-08-18T12:00:00.000Z",
      locale: "pt",
      privacyVersion: bundle.version,
      termsVersion: bundle.version,
    });
    assert.deepEqual(acceptedRemoteLegalAcceptance(acceptance, bundle), {
      acceptableUseVersion: bundle.version,
      accepted: true,
      locale: "pt",
      privacyVersion: bundle.version,
      termsVersion: bundle.version,
    });
    assert.equal(acceptedRemoteLegalAcceptance({ ...acceptance, termsVersion: "2026-01-01" }, bundle), null);
  });
});
