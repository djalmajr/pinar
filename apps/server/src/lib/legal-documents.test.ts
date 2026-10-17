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

  it("names the CentralIT appliance as the Pinar Cloud AI provider and what reaches it, in English and Portuguese", () => {
    const body = (id: Parameters<typeof legalDocument>[0], language: "en" | "pt") => legalDocument(id, language).body;
    for (const language of ["en", "pt"] as const) {
      const subprocessors = body("subprocessors", language);
      assert.match(subprocessors, /### CentralIT/);
      // The gateway and the model providers left the public texts (A46), and the
      // zero-retention wording went with them (A47).
      assert.doesNotMatch(subprocessors, /Vercel/i);
      assert.doesNotMatch(subprocessors, /gateway/i);
      assert.doesNotMatch(subprocessors, /Anthropic|DeepSeek|Z\.ai/);
      assert.doesNotMatch(subprocessors, language === "en" ? /zero data retention/i : /retenção zero de dados/i);
      const privacy = body("privacy", language);
      assert.match(privacy, language === "en" ? /an AI appliance operated by CentralIT, in Brazil/ : /um appliance de IA operado pela CentralIT, no Brasil/);
      assert.match(privacy, language === "en" ? /processed by CentralIT, in Brazil/ : /processados pela CentralIT, no Brasil/);
      assert.doesNotMatch(privacy, /Vercel/i);
      assert.doesNotMatch(privacy, /gateway/i);
      assert.doesNotMatch(privacy, language === "en" ? /zero data retention/i : /retenção zero de dados/i);
      assert.match(body("retention", language), language === "en" ? /90 days after its last message/ : /90 dias após a última mensagem/);
    }
    const privacyEn = body("privacy", "en");
    const privacyPt = body("privacy", "pt");
    // The appliance keeps only the request metadata and does not train on the data (A46).
    assert.match(privacyEn, /never the prompt, the answer, or the image/);
    assert.match(privacyPt, /nunca o prompt, a resposta ou a imagem/);
    assert.match(privacyEn, /does not use the data to train models/);
    assert.match(privacyPt, /não usa os dados para treinar modelos/);
    // Background indexing covers only accounts that already use the AI features (A49).
    assert.match(privacyEn, /used to search your pins, on accounts that use the assistant or have turned on the automatic collection choice/);
    assert.match(privacyPt, /usadas para buscar seus pins, nas contas que usam o assistente ou ligaram a escolha automática da coleção/);
    assert.match(privacyEn, /index, before you ask, only the sessions with pins of accounts that have already had a conversation with the assistant or turned on “Choose the collection automatically”/);
    assert.match(privacyPt, /indexar, antes de você perguntar, só as sessões com pins de contas que já conversaram com o assistente ou ligaram “Escolher a coleção automaticamente”/);
    // The customer carries the burden for third-party data, in the Policy and the Terms (A48).
    const termsEn = body("terms", "en");
    const termsPt = body("terms", "pt");
    assert.match(privacyEn, /you are the controller of that data/);
    assert.match(privacyEn, /you instruct Pinar to process it with the AI provider/);
    assert.match(privacyEn, /Pinar acts as a processor of that data/);
    assert.match(privacyPt, /você é o controlador desses dados/);
    assert.match(privacyPt, /você instrui o Pinar a tratá-lo com o provedor de IA/);
    assert.match(privacyPt, /o Pinar atua como operador desses dados/);
    assert.match(termsEn, /you are the controller/);
    assert.match(termsEn, /instructs Pinar to process it with the AI provider/);
    assert.match(termsEn, /Pinar acting as a processor/);
    assert.match(termsEn, /see the Privacy Policy/);
    assert.match(termsPt, /você é o controlador/);
    assert.match(termsPt, /instrui o Pinar a tratá-lo com o provedor de IA/);
    assert.match(termsPt, /o Pinar atuando como operador/);
    assert.match(termsPt, /veja a Política de Privacidade/);
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
