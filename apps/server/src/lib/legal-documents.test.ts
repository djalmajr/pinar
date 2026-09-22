import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURRENT_LEGAL_VERSION,
  LegalDocumentIds,
  isLegalDocumentId,
  legalDocument,
} from "./legal-documents";

describe("public legal documents", () => {
  it("publishes every required policy in Portuguese and English under one version", () => {
    assert.match(CURRENT_LEGAL_VERSION, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(LegalDocumentIds, [
      "terms",
      "privacy",
      "acceptable-use",
      "retention",
      "refunds",
      "fair-source",
      "subprocessors",
    ]);
    for (const documentId of LegalDocumentIds) {
      const english = legalDocument(documentId, "en");
      const portuguese = legalDocument(documentId, "pt");
      assert.ok(english.body.length > 300);
      assert.ok(portuguese.body.length > 300);
      assert.notEqual(english.title, portuguese.title);
      assert.equal(english.version, CURRENT_LEGAL_VERSION);
      assert.equal(portuguese.version, CURRENT_LEGAL_VERSION);
    }
  });

  it("rejects unknown route identifiers and keeps other UI languages on English legal text", () => {
    assert.equal(isLegalDocumentId("terms"), true);
    assert.equal(isLegalDocumentId("lifetime"), false);
    assert.deepEqual(legalDocument("terms", "es"), legalDocument("terms", "en"));
  });

  it("names Djalma Júnior as operator without a Pinar/we alias", () => {
    const termsEn = legalDocument("terms", "en").body;
    const termsPt = legalDocument("terms", "pt").body;
    const privacyEn = legalDocument("privacy", "en").body;
    const privacyPt = legalDocument("privacy", "pt").body;
    assert.match(termsEn, /Djalma Júnior/);
    assert.match(termsPt, /Djalma Júnior/);
    assert.match(privacyEn, /Djalma Júnior/);
    assert.match(privacyPt, /Djalma Júnior/);
    assert.doesNotMatch(termsEn, /Araújo/);
    assert.doesNotMatch(termsPt, /Araújo/);
    assert.doesNotMatch(termsEn, /\("Pinar", "we", "us"\)/);
    assert.doesNotMatch(termsPt, /\("Pinar", "nós"\)/);
    assert.equal(CURRENT_LEGAL_VERSION, "2026-09-22");
    for (const documentId of LegalDocumentIds) {
      const english = legalDocument(documentId, "en").body;
      const portuguese = legalDocument(documentId, "pt").body;
      assert.match(english, /contact@pinar\.dev/);
      assert.match(portuguese, /contato@pinar\.dev/);
      assert.doesNotMatch(english, /contato@pinar\.dev/);
      assert.doesNotMatch(portuguese, /contact@pinar\.dev/);
      assert.doesNotMatch(english, /gmail\.com/i);
      assert.doesNotMatch(portuguese, /gmail\.com/i);
    }
  });

  it("describes Pro benefits without offering a one-time plan", () => {
    const terms = legalDocument("terms", "en").body;
    const fairSource = legalDocument("fair-source", "en").body;
    assert.match(terms, /2 GB/);
    assert.match(terms, /one-time allocation of 500 AI credits/);
    assert.doesNotMatch(terms, /Founder|Lifetime|500 bonus AI credits/);
    assert.match(fairSource, /active subscription/);
    assert.match(fairSource, /not OSI-approved Open Source/);
  });
});
