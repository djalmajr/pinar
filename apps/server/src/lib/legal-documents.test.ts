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

  it("describes the Vercel AI Gateway as the Pinar Cloud AI path and what reaches it, in English and Portuguese", () => {
    const body = (id: Parameters<typeof legalDocument>[0], language: "en" | "pt") => legalDocument(id, language).body;
    for (const language of ["en", "pt"] as const) {
      const subprocessors = body("subprocessors", language);
      const privacy = body("privacy", language);
      // The AI features run through the Vercel AI Gateway, with the gateway and
      // the providers as subprocessors under Article 33 of the LGPD (A51).
      assert.match(subprocessors, /Vercel AI Gateway/);
      assert.match(privacy, /Vercel AI Gateway/);
      assert.match(subprocessors, language === "en" ? /Article 33/ : /art\. 33/);
      assert.match(privacy, language === "en" ? /Article 33/ : /art\. 33/);
      assert.match(subprocessors, /vercel\.com\/legal/);
      assert.match(privacy, /vercel\.com\/legal/);
      assert.match(subprocessors, /### Vercel Inc\. \(Vercel AI Gateway\)/);
      assert.match(subprocessors, language === "en" ? /### AI providers through the Vercel AI Gateway/ : /### Provedores de IA por meio do Vercel AI Gateway/);
      assert.match(privacy, language === "en" ? /the AI providers accessed through the Vercel AI Gateway \(Vercel Inc\., United States\)/ : /provedores de IA acessados pelo Vercel AI Gateway \(Vercel Inc\., Estados Unidos\)/);
      // Voice transcription and written reproduction steps also run through the
      // gateway (D5): CentralIT no longer appears in the public texts.
      for (const documentId of LegalDocumentIds) {
        assert.doesNotMatch(body(documentId, language), /CentralIT/i);
      }
      assert.match(subprocessors, language === "en" ? /voice transcription, and written reproduction steps/ : /a transcrição de voz e os passos escritos de reprodução/);
      assert.match(privacy, language === "en" ? /the voice recorded on a pin, to transcribe it/ : /o áudio gravado num pin, para transcrevê-lo/);
      assert.match(privacy, language === "en" ? /written reproduction steps/ : /passos escritos de reprodução/);
      assert.match(body("retention", language), language === "en" ? /90 days after its last message/ : /90 dias após a última mensagem/);
    }
    const privacyEn = body("privacy", "en");
    const privacyPt = body("privacy", "pt");
    const termsEn = body("terms", "en");
    const termsPt = body("terms", "pt");
    // The customer carries the burden for third-party data, with the gateway, in
    // the Policy section 1 and the Terms section 6 (A48).
    const privacySection1En = privacyEn.slice(privacyEn.indexOf("## 1."), privacyEn.indexOf("## 2."));
    const privacySection1Pt = privacyPt.slice(privacyPt.indexOf("## 1."), privacyPt.indexOf("## 2."));
    assert.match(privacySection1En, /you are the controller of that data/);
    assert.match(privacySection1En, /you instruct Pinar to process it with the AI providers accessed through the Vercel AI Gateway, including outside Brazil/);
    assert.match(privacySection1En, /Pinar acts as a processor of that data/);
    assert.match(privacySection1Pt, /você é o controlador desses dados/);
    assert.match(privacySection1Pt, /você instrui o Pinar a tratá-lo com os provedores de IA acessados pelo Vercel AI Gateway, inclusive fora do Brasil/);
    assert.match(privacySection1Pt, /o Pinar atua como operador desses dados/);
    const termsSection6En = termsEn.slice(termsEn.indexOf("## 6."), termsEn.indexOf("## 7."));
    const termsSection6Pt = termsPt.slice(termsPt.indexOf("## 6."), termsPt.indexOf("## 7."));
    assert.match(termsSection6En, /you are the controller/);
    assert.match(termsSection6En, /instructs Pinar to process it with the AI providers accessed through the Vercel AI Gateway, including outside Brazil/);
    assert.match(termsSection6En, /Pinar acting as a processor/);
    assert.match(termsSection6En, /see the Privacy Policy/);
    assert.match(termsSection6Pt, /você é o controlador/);
    assert.match(termsSection6Pt, /instrui o Pinar a tratá-lo com os provedores de IA acessados pelo Vercel AI Gateway, inclusive fora do Brasil/);
    assert.match(termsSection6Pt, /o Pinar atuando como operador/);
    assert.match(termsSection6Pt, /veja a Política de Privacidade/);
    // Background indexing covers only accounts that already use the AI features (A49).
    assert.match(privacyEn, /used to search your pins, on accounts that use the assistant or have turned on the automatic collection choice/);
    assert.match(privacyPt, /usadas para buscar seus pins, nas contas que usam o assistente ou ligaram a escolha automática da coleção/);
    assert.match(privacyEn, /index, before you ask, only the sessions with pins of accounts that have already had a conversation with the assistant or turned on “Choose the collection automatically”/);
    assert.match(privacyPt, /indexar, antes de você perguntar, só as sessões com pins de contas que já conversaram com o assistente ou ligaram “Escolher a coleção automaticamente”/);
    // The screenshot goes to the AI for search whatever the agent-copy option
    // says (A24), quoted with the option's real label.
    assert.match(privacyEn, new RegExp(`even when “${englishMessages["dashboard.includeScreenshot"]}” is off`));
    assert.match(privacyPt, new RegExp(`mesmo com a opção “${portugueseMessages["dashboard.includeScreenshot"]}” desligada`));
    // Conversations have their own retention, and the local app's AI never passes through Pinar.
    assert.match(privacyEn, /90 days after their last message/);
    assert.match(privacyPt, /90 dias após a última mensagem/);
    assert.match(privacyEn, /does not pass through Pinar/);
    assert.match(privacyPt, /não passa pelo Pinar/);
    // The public texts keep no model-provider name and no zero-retention or
    // no-training promise for the AI features (A51).
    for (const documentId of ["privacy", "subprocessors"] as const) {
      const english = body(documentId, "en");
      const portuguese = body(documentId, "pt");
      assert.doesNotMatch(english, /Anthropic|DeepSeek|Z\.ai|OpenAI|Google/i);
      assert.doesNotMatch(english, /train/i);
      assert.doesNotMatch(english, /zero data retention/i);
      assert.doesNotMatch(portuguese, /Anthropic|DeepSeek|Z\.ai|OpenAI|Google/i);
      assert.doesNotMatch(portuguese, /treinar|treino/i);
      assert.doesNotMatch(portuguese, /retenção zero/i);
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
