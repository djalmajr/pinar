import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURRENT_LEGAL_VERSION,
  LegalDocumentIds,
  isLegalDocumentId,
  legalDocument,
} from "./legal-documents";
import englishMessages from "./ui-locales/en";
import portugueseMessages from "./ui-locales/pt";

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
    assert.equal(CURRENT_LEGAL_VERSION, "2026-10-17");
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

  it("names the Pinar Cloud assistant's AI providers and what reaches them, in English and Portuguese", () => {
    const body = (id: Parameters<typeof legalDocument>[0], language: "en" | "pt") => legalDocument(id, language).body;
    for (const language of ["en", "pt"] as const) {
      const subprocessors = body("subprocessors", language);
      for (const provider of [/### Vercel Inc\. \(Vercel AI Gateway\)/, /Anthropic/, /DeepSeek/, /Z\.ai/, /### CentralIT/]) {
        assert.match(subprocessors, provider);
      }
      const privacy = body("privacy", language);
      assert.match(privacy, language === "en" ? /Vercel AI Gateway \(Vercel Inc\., United States\)/ : /Vercel AI Gateway \(Vercel Inc\., Estados Unidos\)/);
      assert.match(privacy, language === "en" ? /processed by CentralIT, in Brazil/ : /processados pela CentralIT, no Brasil/);
      assert.match(body("retention", language), language === "en" ? /90 days after its last message/ : /90 dias após a última mensagem/);
    }
    const privacyEn = body("privacy", "en");
    const privacyPt = body("privacy", "pt");
    // Training is always disallowed; zero data retention is not claimed.
    assert.match(privacyEn, /disallows using it to train models/);
    assert.match(privacyPt, /proíbe usá-lo para treinar modelos/);
    assert.match(privacyEn, /Zero data retention is not currently requested/);
    assert.match(privacyPt, /A retenção zero de dados não é solicitada hoje/);
    assert.match(body("subprocessors", "en"), /zero data retention is not currently requested/);
    assert.match(body("subprocessors", "pt"), /a retenção zero de dados não é solicitada hoje/);
    // The screenshot goes to the AI for search whatever the agent-copy option
    // says (A24), quoted with the option's real label.
    assert.match(privacyEn, new RegExp(`even when “${englishMessages["dashboard.includeScreenshot"]}” is off`));
    assert.match(privacyPt, new RegExp(`mesmo com a opção “${portugueseMessages["dashboard.includeScreenshot"]}” desligada`));
    // Conversations have their own retention, and the local app's AI never passes through Pinar.
    assert.match(privacyEn, /90 days after their last message/);
    assert.match(privacyPt, /90 dias após a última mensagem/);
    assert.match(privacyEn, /does not pass through Pinar/);
    assert.match(privacyPt, /não passa pelo Pinar/);
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
