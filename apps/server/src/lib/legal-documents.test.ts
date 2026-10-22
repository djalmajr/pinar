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
    assert.equal(CURRENT_LEGAL_VERSION, "2026-10-22");
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
      // The AI features run through the Vercel AI Gateway; the dual role and the
      // Article 33, IX + Article 7, V basis now live in the policy (J2/J3), and
      // the subprocessor page keeps the short form pointing at the policy.
      assert.match(subprocessors, /Vercel AI Gateway/);
      assert.match(privacy, /Vercel AI Gateway/);
      assert.match(subprocessors, language === "en" ? /act as processors of Pinar and, for third-party data that you control, as subprocessors/ : /atuam como operadores do Pinar e, para dados de terceiros que você controla, como suboperadores/);
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
    assert.match(privacySection1En, /you are the controller of that data and are responsible for having a legal basis and for informing the data subjects, including when you use the AI features of Pinar Cloud described in Section 4/);
    assert.match(privacySection1En, /Pinar acts as a processor of that data/);
    assert.match(privacySection1Pt, /você é o controlador desses dados e responde por ter base legal e por informar os titulares, inclusive quando usa os recursos de IA do Pinar Cloud descritos na seção 4/);
    assert.match(privacySection1Pt, /O Pinar atua como operador desses dados/);
    const termsSection6En = termsEn.slice(termsEn.indexOf("## 6."), termsEn.indexOf("## 7."));
    const termsSection6Pt = termsPt.slice(termsPt.indexOf("## 6."), termsPt.indexOf("## 7."));
    assert.match(termsSection6En, /you are the controller and are responsible for having a legal basis and for informing the data subjects/);
    assert.match(termsSection6En, /process that content with AI providers outside Brazil as described in the Privacy Policy\. Pinar processes that content as a processor\./);
    assert.match(termsSection6Pt, /você é o controlador e responde por ter base legal e por informar os titulares/);
    assert.match(termsSection6Pt, /tratam esse conteúdo com provedores de IA fora do Brasil, como descreve a Política de Privacidade\. O Pinar trata esse conteúdo como operador\./);
    // The customer's instruction or acceptance never stands in for the legal
    // basis of third-party data (technical opinion of 22/10, F1).
    for (const text of [termsSection6En, termsSection6Pt, privacySection1En, privacySection1Pt]) {
      assert.doesNotMatch(text, /instruct|instrui/);
    }
    // Cookies (J13): the session and language cookies, and the interface
    // preferences in local storage (every localStorage key of the web app);
    // no advertising or analytics; Cloudflare's own protection cookies.
    assert.match(privacyEn, /a session cookie that keeps you signed in for up to 30 days and is removed when you sign out, a cookie that remembers the language you chose, and your browser's local storage for interface preferences: the language, the theme, the project and collection you last selected, the history view, and whether the assistant panel is open\. Pinar uses no advertising or analytics cookies\./);
    assert.match(privacyPt, /um cookie de sessão que mantém você conectado por até 30 dias e é removido quando você sai, um cookie que lembra o idioma escolhido e o armazenamento local do navegador para preferências da interface: o idioma, o tema, o projeto e a coleção selecionados por último, a visualização do histórico e se o painel do assistente está aberto\. O Pinar não usa cookies de publicidade nem de análise\./);
    assert.match(privacyEn, /Cloudflare, which sits in front of pinar\.dev, may set cookies needed to protect the service/);
    assert.match(privacyPt, /A Cloudflare, que fica na frente do pinar\.dev, pode definir cookies necessários para proteger o serviço/);
    // No background indexing (A53): the pins are indexed only while the
    // assistant answers a message, and the filing choice reads that index.
    assert.match(privacyEn, /used to search your pins and created only while the assistant answers your messages;/);
    assert.match(privacyPt, /usadas para buscar seus pins e criadas só enquanto o assistente responde às suas mensagens;/);
    assert.match(privacyEn, /indexes your pins for search only while the assistant answers one of your messages, never in the background; the automatic collection choice uses the index that already exists/);
    assert.match(privacyPt, /indexa os seus pins para a busca só enquanto o assistente responde a uma mensagem sua, nunca em segundo plano; a escolha automática da coleção usa o índice que já existe/);
    for (const text of [privacyEn, privacyPt]) {
      assert.doesNotMatch(text, /before you ask|antes de você perguntar/);
    }
    // The screenshot goes to the AI for search whatever the agent-copy option
    // says (A24), quoted with the option's real label.
    assert.match(privacyEn, new RegExp(`even when “${englishMessages["dashboard.includeScreenshot"]}” is off`));
    assert.match(privacyPt, new RegExp(`mesmo com a opção “${portugueseMessages["dashboard.includeScreenshot"]}” desligada`));
    // Conversations have their own retention, and the local app's AI never passes through Pinar.
    assert.match(privacyEn, /90 days after their last message/);
    assert.match(privacyPt, /90 dias após a última mensagem/);
    assert.match(privacyEn, /does not pass through Pinar/);
    assert.match(privacyPt, /não passa pelo Pinar/);
    // The public texts keep no model-provider name and no training promise for
    // the AI features (A51). The only zero-retention mention in the whole set is
    // the policy's transparency sentence that Pinar does not request it (J4); the
    // subprocessor page keeps none.
    for (const documentId of ["privacy", "subprocessors"] as const) {
      const english = body(documentId, "en");
      const portuguese = body(documentId, "pt");
      assert.doesNotMatch(english, /Anthropic|DeepSeek|Z\.ai|OpenAI|Google/i);
      assert.doesNotMatch(english, /train/i);
      assert.doesNotMatch(portuguese, /Anthropic|DeepSeek|Z\.ai|OpenAI|Google/i);
      assert.doesNotMatch(portuguese, /treinar|treino/i);
    }
    for (const language of ["en", "pt"] as const) {
      const privacy = body("privacy", language);
      const subprocessors = body("subprocessors", language);
      const zeroRetention = language === "en" ? /zero data retention/gi : /retenção zero/gi;
      assert.equal((privacy.match(zeroRetention) ?? []).length, 1);
      assert.doesNotMatch(subprocessors, zeroRetention);
    }
  });

  it("applies the legal review findings: DPO, dual role, provider retention, own-purpose controller, indexing basis, incident notice, LGPD deadlines, third-party channel, and license exclusion (J1-J9, J12)", () => {
    const body = (id: Parameters<typeof legalDocument>[0], language: "en" | "pt") => legalDocument(id, language).body;
    for (const language of ["en", "pt"] as const) {
      const privacy = body("privacy", language);
      const terms = body("terms", language);
      const subprocessors = body("subprocessors", language);
      if (language === "en") {
        // J1: the data protection officer is named through the existing privacy contact.
        assert.match(privacy, /Data protection officer: \*\*Djalma Júnior\*\*, through the same contact\./);
        // J2/J3: the providers act as processors of Pinar and, for third-party data
        // you control, as subprocessors. Article 33, IX + Article 7, V covers only
        // the account's own data; third-party data rests on the controller's basis (F1).
        assert.match(privacy, /act as processors of Pinar and, for third-party data that you control, as subprocessors/);
        assert.match(privacy, /For your own account data, the transfer is necessary to run the features you invoke under your contract with Pinar \(Article 33, IX, combined with Article 7, V, of the LGPD\)\. For third-party data in your content, it is up to you, as controller, to have a legal basis for using it with these features\./);
        // J4: Pinar does not request zero data retention; providers keep their own periods.
        assert.match(privacy, /Pinar does not request zero data retention, so the providers may retain the data from each request for the periods in their own terms/);
        // J5: Pinar is controller for its own purposes.
        assert.match(privacy, /When we process that data for our own purposes, such as security, fraud and abuse prevention, and legal compliance, we act as controller/);
        // J8: the screenshot description and pin indexing run the features you use;
        // no blanket contract basis, since screenshots carry third-party data (F1).
        assert.match(privacy, /The description of screenshots and the indexing of pins for search are done to run the AI features you use\./);
        // J9: a relevant incident is reported to the ANPD and to the data subjects.
        assert.match(privacy, /If a security incident may cause relevant risk or harm to the data subjects, we will notify the ANPD and the affected data subjects, as required by law\./);
        // J12: requests are answered within the LGPD time limits.
        assert.match(privacy, /We will respond within the LGPD time limits\./);
        // J6: a third party who appears in submitted content is pointed to the customer.
        assert.match(privacy, /If you appear in content a customer sent to Pinar \(for example, in a screenshot\) and are not a user of the service, direct your request to the person who sent the content, who is the controller of that data\./);
        assert.match(privacy, /If you contact us, we will forward the request to the customer when we can identify them\./);
        // J7: the license never includes training AI models on your content.
        assert.match(terms, /That license does not include using your content to train AI models\./);
      } else {
        // J1: encarregado indicado pelo mesmo contato de privacidade.
        assert.match(privacy, /Encarregado pelo tratamento de dados pessoais: \*\*Djalma Júnior\*\*, pelo mesmo contato\./);
        // J2/J3: duplo papel operador/suboperador; o art. 33, IX + art. 7º, V vale
        // só para os dados da própria conta, e terceiros dependem do controlador (F1).
        assert.match(privacy, /atuam como operadores do Pinar e, para dados de terceiros que você controla, como suboperadores/);
        assert.match(privacy, /Para os dados da sua própria conta, a transferência é necessária para executar os recursos que você aciona no seu contrato com o Pinar \(art\. 33, IX, combinado com o art\. 7º, V, da LGPD\)\. Para dados de terceiros no seu conteúdo, cabe a você, como controlador, ter base legal para usá-los nesses recursos\./);
        // J4: o Pinar não solicita retenção zero; os provedores mantêm os prazos dos próprios termos.
        assert.match(privacy, /O Pinar não solicita retenção zero de dados, então os provedores podem reter os dados de cada pedido pelos prazos dos próprios termos/);
        // J5: o Pinar é controlador para finalidades próprias.
        assert.match(privacy, /Quando tratamos esses dados para finalidades próprias, como segurança, prevenção a fraude e abuso e cumprimento da lei, atuamos como controlador/);
        // J8: a descrição dos screenshots e a indexação dos pins executam os recursos
        // que você usa, sem base contratual genérica (F1).
        assert.match(privacy, /A descrição dos screenshots e a indexação dos pins para busca são feitas para executar os recursos de IA que você usa\./);
        // J9: incidente relevante é comunicado à ANPD e aos titulares.
        assert.match(privacy, /Se um incidente de segurança puder gerar risco ou dano relevante aos titulares, comunicaremos a ANPD e os titulares afetados, conforme a lei\./);
        // J12: resposta nos prazos da LGPD.
        assert.match(privacy, /Responderemos nos prazos da LGPD\./);
        // J6: o terceiro que aparece no conteúdo enviado é encaminhado ao cliente.
        assert.match(privacy, /Se você aparece no conteúdo que um cliente enviou ao Pinar \(por exemplo, num screenshot\) e não é usuário do serviço, dirija o pedido a quem enviou o conteúdo, que é o controlador desses dados\./);
        assert.match(privacy, /Se nos procurar, encaminharemos o pedido ao cliente quando pudermos identificá-lo\./);
        // J7: a licença não inclui treinar modelos de IA com o conteúdo.
        assert.match(terms, /Essa licença não inclui usar o seu conteúdo para treinar modelos de IA\./);
      }
      // J3: a página de suboperadores mantém o raciocínio em forma curta.
      assert.match(subprocessors, language === "en" ? /act as processors of Pinar and, for third-party data that you control, as subprocessors; processing may take place outside Brazil in the circumstances described in the Privacy Policy/ : /atuam como operadores do Pinar e, para dados de terceiros que você controla, como suboperadores; o tratamento pode ocorrer fora do Brasil nas hipóteses da Política de Privacidade/);
    }
  });

  it("describes the real production infrastructure: Hetzner hosting, the Cloudflare proxy/CDN/protection with R2 and the email, and the 14-day database backups (J10)", () => {
    const body = (id: Parameters<typeof legalDocument>[0], language: "en" | "pt") => legalDocument(id, language).body;
    for (const language of ["en", "pt"] as const) {
      const subprocessors = body("subprocessors", language);
      const privacy = body("privacy", language);
      const retention = body("retention", language);
      // Hetzner hosts the application server and the database, with the backups,
      // in Falkenstein, Germany, and gets no link (no verified URL).
      const hetznerEntry = subprocessors.slice(subprocessors.indexOf("### Hetzner Online GmbH"), subprocessors.indexOf("### Stripe"));
      assert.match(hetznerEntry, language === "en" ? /hosts the Pinar Cloud application server and the database, including the backups/ : /hospedagem dos servidores da aplicação e do banco de dados, com os backups/);
      assert.match(hetznerEntry, language === "en" ? /Germany \(Falkenstein\)/ : /Alemanha \(Falkenstein\)/);
      assert.doesNotMatch(hetznerEntry, /https?:\/\//);
      // The Cloudflare entry covers the proxy/CDN/protection, the R2 storage of the
      // uploaded files and the transactional email, and no longer names Workers, D1
      // or Workers AI, which no longer run in production.
      const cloudflareEntry = subprocessors.slice(subprocessors.indexOf("### Cloudflare"), subprocessors.indexOf("### Hetzner Online GmbH"));
      assert.doesNotMatch(cloudflareEntry, /Workers|D1/i);
      assert.match(cloudflareEntry, language === "en" ? /proxy, CDN, and protection/ : /proxy, CDN e proteção/);
      assert.match(cloudflareEntry, /R2/);
      assert.match(cloudflareEntry, language === "en" ? /transactional email/ : /e-mail transacional/);
      assert.match(cloudflareEntry, /cloudflare\.com\/gdpr\/subprocessors/);
      // The policy says where the service is hosted; the retention policy gives the
      // database backups their ~14-day window.
      assert.match(privacy, language === "en" ? /the hosted service runs on servers in Germany/ : /a hospedagem do serviço fica na Alemanha/);
      assert.match(retention, language === "en" ? /until normal rotation \(about 14 days for the database\)/ : /até a rotação normal \(cerca de 14 dias para o banco de dados\)/);
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

  it("no longer offers an own AI endpoint in Pinar Cloud nor claims unproven transfer safeguards", () => {
    const body = (id: Parameters<typeof legalDocument>[0], language: "en" | "pt") => legalDocument(id, language).body;
    for (const language of ["en", "pt"] as const) {
      // Pinar Cloud dropped the customer's own AI endpoint (BYOK); only the
      // local app's own endpoint, which never passes through Pinar, remains.
      for (const documentId of ["privacy", "terms", "subprocessors"] as const) {
        assert.doesNotMatch(body(documentId, language), language === "en" ? /Your own AI endpoint|AI endpoint you configure yourself|connection test/ : /Seu próprio endpoint de IA|endpoint de IA que você configura por sua conta|teste de conexão/);
      }
      // Section 4 lists the providers without asserting contract safeguards the
      // service cannot show yet (technical opinion of 22/10, point 3).
      assert.doesNotMatch(body("privacy", language), language === "en" ? /legally recognized safeguards/ : /salvaguardas reconhecidas em lei/);
    }
  });
});
