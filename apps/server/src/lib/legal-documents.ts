import type { SupportedLanguage } from "@pinar/shared";

export const CURRENT_LEGAL_VERSION = "2026-08-24";

export const LegalDocumentIds = [
  "terms",
  "privacy",
  "acceptable-use",
  "retention",
  "refunds",
  "fair-source",
  "subprocessors",
] as const;

export type LegalDocumentId = (typeof LegalDocumentIds)[number];

interface LocalizedLegalDocument {
  en: string;
  pt: string;
}

export interface LegalDocument {
  body: string;
  id: LegalDocumentId;
  title: string;
  version: string;
}

const titles: Record<LegalDocumentId, LocalizedLegalDocument> = {
  "acceptable-use": {
    en: "Acceptable Use Policy",
    pt: "Política de Uso Aceitável",
  },
  "fair-source": {
    en: "Fair Source Notice",
    pt: "Aviso Fair Source",
  },
  privacy: {
    en: "Privacy Policy",
    pt: "Política de Privacidade",
  },
  refunds: {
    en: "Refund Policy",
    pt: "Política de Reembolso",
  },
  retention: {
    en: "Data Retention Policy",
    pt: "Política de Retenção de Dados",
  },
  subprocessors: {
    en: "Service Providers and Subprocessors",
    pt: "Provedores de Serviço e Suboperadores",
  },
  terms: {
    en: "Terms of Service",
    pt: "Termos de Serviço",
  },
};

const documents: Record<LegalDocumentId, LocalizedLegalDocument> = {
  terms: {
    en: `## 1. Who operates Pinar

Pinar is operated by **Djalma Júnior**, an individual operating the pinar.dev service from Brazil. Contact: **djalmajr@gmail.com**.

These Terms govern the hosted Pinar service, paid plans, cloud storage, AI features, browser extension integrations, and related websites. Software distributed from the public repository is also governed by its repository license.

## 2. Eligibility and acceptance

You must have legal capacity to enter into this agreement. By creating a remote account, purchasing a plan, or using a hosted feature, you accept these Terms, the Privacy Policy, the Acceptable Use Policy, and the policies incorporated here by reference. Local-only use that does not contact Pinar's hosted service remains subject to the software license, but does not require a hosted-service account.

## 3. Accounts and security

You are responsible for the email address, devices, access codes, extension tokens, and activity associated with your account. Do not share temporary codes or bypass account or quota controls. Notify us promptly if you suspect unauthorized access.

## 4. Plans, billing, and quotas

- **Free** provides limited cloud retention, storage, and introductory AI credits.
- **Pro** is a recurring monthly or annual subscription. Included storage, AI-credit refills, and paid retention apply only while the subscription remains eligible, subject to the Retention Policy.
- **Pinar Founder** is a limited-cohort, one-time purchase with 5 GB of base cloud storage and 500 initial AI credits without monthly refill. It is not a promise that the hosted service, every feature, or unlimited operating cost will continue forever.
- Storage and AI-credit add-ons have the amount, validity, and consumption rules shown before purchase.

Prices, taxes, currency, renewal interval, and the applicable offer are shown at Checkout. Stripe processes payments. You may cancel a recurring plan before its next renewal. Cancellation stops future renewals but does not automatically refund an already-started billing period.

## 5. Content and permissions

You retain ownership of content you submit. You grant Pinar a limited license to host, copy, process, transmit, and display that content only as needed to provide, secure, maintain, and improve the service. You must have the rights and permissions needed to capture, upload, annotate, or share the content, including screenshots and personal data visible on a page.

## 6. AI features

AI output may be incomplete, inaccurate, or unsuitable. You must review it before relying on it. Do not use AI output as the sole basis for legal, medical, financial, employment, credit, or other high-impact decisions. Credits represent product usage units, not currency, stored value, or a guaranteed number of tokens.

## 7. Availability and changes

We aim to operate Pinar reliably but do not guarantee uninterrupted or error-free availability. Features, models, quotas, and integrations may change for security, legal, sustainability, or product reasons. Material adverse changes to a paid plan will receive reasonable notice when practicable. If the hosted service is discontinued, we will use reasonable efforts to provide advance notice and an export opportunity, but Founder status does not create a perpetual hosting obligation.

## 8. Suspension and termination

We may restrict or suspend access when reasonably necessary to address fraud, abuse, security risk, unlawful activity, nonpayment, material breach, or risk to other users. When appropriate, we will provide notice and an opportunity to cure. You may stop using Pinar and request account deletion, subject to legally required retention and the Retention Policy.

## 9. Warranties and liability

To the extent permitted by law, Pinar is provided "as is" and "as available". We do not exclude or limit rights, warranties, remedies, or liability that cannot legally be excluded, including mandatory consumer rights. To the extent a limitation is permitted, Pinar is not liable for indirect or consequential losses that were not reasonably foreseeable.

## 10. Governing law and contact

Brazilian law governs these Terms, without removing mandatory protections available where you live. Brazilian consumers may bring claims in the legally competent forum, including their domicile where applicable. Questions and formal requests may be sent to **djalmajr@gmail.com**.`,
    pt: `## 1. Quem opera o Pinar

O Pinar é operado por **Djalma Júnior**, pessoa física responsável pelo serviço pinar.dev no Brasil. Contato: **djalmajr@gmail.com**.

Estes Termos regem o serviço hospedado do Pinar, planos pagos, armazenamento em nuvem, recursos de IA, integrações com a extensão de navegador e sites relacionados. O software distribuído pelo repositório público também é regido pela licença presente no repositório.

## 2. Elegibilidade e aceite

Você deve ter capacidade legal para celebrar este contrato. Ao criar uma conta remota, comprar um plano ou usar um recurso hospedado, você aceita estes Termos, a Política de Privacidade, a Política de Uso Aceitável e as políticas aqui incorporadas por referência. O uso exclusivamente local, sem contato com o serviço hospedado do Pinar, permanece sujeito à licença do software, mas não exige uma conta do serviço hospedado.

## 3. Contas e segurança

Você é responsável pelo endereço de e-mail, dispositivos, códigos de acesso, tokens da extensão e atividades associados à sua conta. Não compartilhe códigos temporários nem tente contornar controles de conta ou de cota. Avise-nos prontamente se suspeitar de acesso não autorizado.

## 4. Planos, cobrança e cotas

- **Free** oferece retenção em nuvem, armazenamento e créditos iniciais de IA limitados.
- **Pro** é uma assinatura mensal ou anual recorrente. Armazenamento incluído, recargas de créditos de IA e retenção paga aplicam-se somente enquanto a assinatura permanecer elegível, conforme a Política de Retenção.
- **Pinar Founder** é uma compra única para uma coorte limitada, com 5 GB de armazenamento-base em nuvem e 500 créditos iniciais de IA sem recarga mensal. Não é uma promessa de que o serviço hospedado, todos os recursos ou custos operacionais ilimitados continuarão para sempre.
- Adicionais de armazenamento e créditos de IA seguem a quantidade, a validade e as regras de consumo exibidas antes da compra.

Preços, tributos, moeda, intervalo de renovação e oferta aplicável são exibidos no Checkout. O Stripe processa os pagamentos. Você pode cancelar um plano recorrente antes da próxima renovação. O cancelamento impede renovações futuras, mas não gera automaticamente reembolso de um período de cobrança já iniciado.

## 5. Conteúdo e permissões

Você mantém a titularidade do conteúdo enviado. Você concede ao Pinar uma licença limitada para hospedar, copiar, processar, transmitir e exibir esse conteúdo apenas conforme necessário para fornecer, proteger, manter e melhorar o serviço. Você deve possuir os direitos e permissões necessários para capturar, enviar, anotar ou compartilhar o conteúdo, inclusive screenshots e dados pessoais visíveis em uma página.

## 6. Recursos de IA

Resultados de IA podem ser incompletos, imprecisos ou inadequados. Você deve revisá-los antes de utilizá-los. Não use resultados de IA como fundamento exclusivo para decisões jurídicas, médicas, financeiras, trabalhistas, de crédito ou outras decisões de alto impacto. Créditos representam unidades de uso do produto, não moeda, valor armazenado nem uma quantidade garantida de tokens.

## 7. Disponibilidade e alterações

Buscamos operar o Pinar de forma confiável, mas não garantimos disponibilidade ininterrupta ou sem erros. Recursos, modelos, cotas e integrações podem mudar por motivos de segurança, legais, de sustentabilidade ou de produto. Alterações materiais desfavoráveis em um plano pago receberão aviso prévio razoável quando viável. Se o serviço hospedado for encerrado, empregaremos esforços razoáveis para avisar com antecedência e oferecer oportunidade de exportação, mas o status Founder não cria obrigação de hospedagem perpétua.

## 8. Suspensão e encerramento

Podemos restringir ou suspender o acesso quando razoavelmente necessário para lidar com fraude, abuso, risco de segurança, atividade ilícita, inadimplência, violação material ou risco a outros usuários. Quando apropriado, forneceremos aviso e oportunidade de correção. Você pode deixar de usar o Pinar e solicitar a exclusão da conta, ressalvadas retenções legalmente obrigatórias e a Política de Retenção.

## 9. Garantias e responsabilidade

Na medida permitida por lei, o Pinar é fornecido "como está" e "conforme disponível". Não excluímos nem limitamos direitos, garantias, remédios ou responsabilidades que não possam ser legalmente excluídos, inclusive direitos obrigatórios do consumidor. Quando uma limitação for permitida, o Pinar não responde por perdas indiretas ou consequenciais que não fossem razoavelmente previsíveis.

## 10. Lei aplicável e contato

A lei brasileira rege estes Termos, sem afastar proteções obrigatórias disponíveis no local onde você vive. Consumidores brasileiros podem ajuizar demandas no foro legalmente competente, inclusive o de seu domicílio quando aplicável. Dúvidas e solicitações formais podem ser enviadas para **djalmajr@gmail.com**.`,
  },
  privacy: {
    en: `## 1. Controller and scope

For the hosted Pinar service, the data controller is **Djalma Júnior**, an individual in Brazil. Privacy contact: **djalmajr@gmail.com**. This Policy does not govern local-only data that never leaves your device; you control that data locally.

## 2. Data we process

Depending on your use, we process: account email and authentication records; policy-acceptance evidence; billing identifiers and plan status received from Stripe (not full card details); device and extension identifiers; IP address, request, security, and diagnostic logs; projects, collections, page URLs and titles, screenshots, annotations, comments, selectors, and sharing metadata you submit; storage and AI-credit usage; and prompts, inputs, outputs, model usage, and error details when you invoke an AI feature.

Avoid capturing secrets or unnecessary sensitive personal data. A screenshot may contain information about you or third parties, and you are responsible for having an appropriate basis to submit it.

## 3. Purposes and legal bases

We process data to provide accounts and contracted features; authenticate users; store and share content at your direction; process billing and entitlements; operate AI features; prevent fraud and abuse; secure and troubleshoot the service; comply with law; establish or defend legal claims; and communicate service or policy changes. Under the LGPD, the applicable bases may include contract performance, compliance with legal obligations, legitimate interests subject to safeguards, regular exercise of rights, fraud prevention, and consent where specifically requested.

## 4. Sharing and international transfers

We share data only as needed with the providers listed in the Service Providers and Subprocessors page, with professional advisers under confidentiality, in a corporate transaction subject to appropriate protections, or with authorities when legally required. Cloud infrastructure and payment processing may involve processing outside Brazil. We use provider contracts and legally recognized safeguards appropriate to the transfer.

## 5. Retention and deletion

Retention depends on plan, content type, legal duties, security needs, and account status. The current periods and recovery windows are described in the Data Retention Policy. Backups and fraud, billing, tax, security, and legal records may remain for a limited period after deletion when required or reasonably necessary.

## 6. Security

We use measures designed for the nature of the service, including scoped tokens, access controls, origin validation, rate limits, encrypted transport, isolated production resources, and restricted provider access. No online system is completely secure. Contact us promptly if you believe your account or data was compromised.

## 7. Your rights

Subject to applicable law, you may request confirmation and access; correction; information about sharing; portability where regulated; anonymization, blocking, or deletion of unnecessary or unlawfully processed data; deletion of consent-based data subject to legal exceptions; information about consent choices; withdrawal of consent; and review of a decision based solely on automated processing that affects your interests. We may verify your identity before acting. Requests are free and may be sent to **djalmajr@gmail.com**.

## 8. Children, changes, and complaints

Pinar is not directed to children. Do not submit a child's personal data without the authority and safeguards required by law. We will publish material changes and request renewed acceptance when legally or contractually necessary. You may also lodge a complaint with Brazil's National Data Protection Authority (ANPD) or another competent authority.`,
    pt: `## 1. Controlador e escopo

No serviço hospedado do Pinar, o controlador é **Djalma Júnior**, pessoa física no Brasil. Contato de privacidade: **djalmajr@gmail.com**. Esta Política não rege dados de uso exclusivamente local que nunca saem do seu dispositivo; você controla esses dados localmente.

## 2. Dados tratados

Conforme o uso, tratamos: e-mail da conta e registros de autenticação; evidências de aceite de políticas; identificadores de cobrança e status do plano recebidos do Stripe (não os dados completos do cartão); identificadores do dispositivo e da extensão; endereço IP e logs de requisição, segurança e diagnóstico; projetos, coleções, URLs e títulos de páginas, screenshots, anotações, comentários, seletores e metadados de compartilhamento enviados por você; consumo de armazenamento e créditos de IA; e prompts, entradas, saídas, uso do modelo e detalhes de erros quando você aciona um recurso de IA.

Evite capturar segredos ou dados pessoais sensíveis desnecessários. Um screenshot pode conter informações suas ou de terceiros, e você é responsável por possuir base adequada para enviá-lo.

## 3. Finalidades e bases legais

Tratamos dados para fornecer contas e recursos contratados; autenticar usuários; armazenar e compartilhar conteúdo sob sua orientação; processar cobrança e direitos de uso; operar recursos de IA; prevenir fraude e abuso; proteger e diagnosticar o serviço; cumprir a lei; exercer ou defender direitos; e comunicar mudanças no serviço ou nas políticas. Na LGPD, as bases aplicáveis podem incluir execução de contrato, cumprimento de obrigação legal, legítimo interesse sujeito a salvaguardas, exercício regular de direitos, prevenção à fraude e consentimento quando solicitado especificamente.

## 4. Compartilhamento e transferências internacionais

Compartilhamos dados somente quando necessário com os provedores listados na página Provedores de Serviço e Suboperadores, com assessores profissionais sujeitos a confidencialidade, em operação societária sujeita a proteções adequadas ou com autoridades quando legalmente exigido. Infraestrutura de nuvem e processamento de pagamentos podem envolver tratamento fora do Brasil. Utilizamos contratos com fornecedores e salvaguardas reconhecidas em lei apropriadas à transferência.

## 5. Retenção e exclusão

A retenção depende do plano, tipo de conteúdo, obrigações legais, necessidades de segurança e estado da conta. Os prazos e janelas de recuperação atuais estão descritos na Política de Retenção de Dados. Backups e registros de fraude, cobrança, tributos, segurança e questões legais podem permanecer por período limitado após a exclusão quando exigido ou razoavelmente necessário.

## 6. Segurança

Adotamos medidas compatíveis com a natureza do serviço, incluindo tokens com escopo, controles de acesso, validação de origem, limites de requisição, transporte criptografado, recursos de produção isolados e acesso restrito de fornecedores. Nenhum sistema on-line é totalmente seguro. Contate-nos prontamente se acreditar que sua conta ou seus dados foram comprometidos.

## 7. Seus direitos

Conforme a lei aplicável, você pode solicitar confirmação e acesso; correção; informação sobre compartilhamento; portabilidade quando regulamentada; anonimização, bloqueio ou eliminação de dados desnecessários ou tratados irregularmente; eliminação de dados tratados com consentimento, ressalvadas exceções legais; informação sobre escolhas de consentimento; revogação do consentimento; e revisão de decisão tomada unicamente por tratamento automatizado que afete seus interesses. Podemos verificar sua identidade antes de atender ao pedido. As solicitações são gratuitas e podem ser enviadas para **djalmajr@gmail.com**.

## 8. Crianças, alterações e reclamações

O Pinar não é dirigido a crianças. Não envie dados pessoais de crianças sem a autoridade e as salvaguardas exigidas por lei. Publicaremos alterações materiais e solicitaremos novo aceite quando necessário legal ou contratualmente. Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD) ou a outra autoridade competente.`,
  },
  "acceptable-use": {
    en: `## 1. Purpose

This Policy protects users, third parties, and the shared infrastructure. It applies to hosted content, public viewers, extension traffic, APIs, AI features, and attempts to access the service.

## 2. Prohibited conduct

You may not use Pinar to:

- violate law, court orders, sanctions, or third-party rights;
- capture, expose, stalk, harass, threaten, exploit, or dox another person;
- upload malware, credentials, payment-card data, authentication secrets, or unnecessary sensitive personal data;
- infringe copyright, privacy, confidentiality, trademark, or contractual restrictions;
- conduct phishing, fraud, spam, deceptive impersonation, or unauthorized surveillance;
- probe, scan, disrupt, overload, scrape, reverse engineer hosted controls, bypass quotas, or access another user's account or content without authorization;
- automate traffic at a rate or in a manner that harms the service or other users;
- use AI features to create illegal abuse, malware, fraud, targeted harassment, or high-impact decisions without qualified human review; or
- resell, sublicense, or provide a competing hosted Pinar-derived service contrary to the repository license.

## 3. Responsible capture and sharing

Capture only what is necessary. Redact secrets and personal data before upload. Use restricted viewers when content is not intended for the public. A link recipient may copy what they can view, so do not treat a share link as a substitute for authorization or data minimization.

## 4. Quotas and fair use

Storage, AI credits, rate limits, and plan quotas are enforced per account or installation. Do not split accounts, rotate identities, replay requests, or use automation to evade a limit. We may throttle, reject, or temporarily suspend disproportionate usage that creates material cost, security risk, or service degradation.

## 5. Enforcement

We consider severity, intent, recurrence, impact, and legal obligations. Responses may include a warning, removal or restriction of content, throttling, suspension, termination, or referral to authorities. When safe and appropriate, we will give notice and an opportunity to correct the issue. Report abuse to **djalmajr@gmail.com** with the relevant URL and evidence.`,
    pt: `## 1. Finalidade

Esta Política protege usuários, terceiros e a infraestrutura compartilhada. Ela se aplica a conteúdo hospedado, visualizadores públicos, tráfego da extensão, APIs, recursos de IA e tentativas de acesso ao serviço.

## 2. Condutas proibidas

Você não pode usar o Pinar para:

- violar leis, ordens judiciais, sanções ou direitos de terceiros;
- expor, perseguir, assediar, ameaçar, explorar ou divulgar dados pessoais de outra pessoa indevidamente;
- enviar malware, credenciais, dados de cartão, segredos de autenticação ou dados pessoais sensíveis desnecessários;
- infringir direitos autorais, privacidade, confidencialidade, marcas ou restrições contratuais;
- praticar phishing, fraude, spam, personificação enganosa ou vigilância não autorizada;
- sondar, varrer, interromper, sobrecarregar, extrair dados, fazer engenharia reversa de controles hospedados, contornar cotas ou acessar conta ou conteúdo de outro usuário sem autorização;
- automatizar tráfego em volume ou modo que prejudique o serviço ou outros usuários;
- usar recursos de IA para abuso ilegal, malware, fraude, assédio direcionado ou decisões de alto impacto sem revisão humana qualificada; ou
- revender, sublicenciar ou oferecer serviço hospedado concorrente derivado do Pinar em desacordo com a licença do repositório.

## 3. Captura e compartilhamento responsáveis

Capture apenas o necessário. Remova segredos e dados pessoais antes do envio. Use visualizadores restritos quando o conteúdo não for destinado ao público. O destinatário de um link pode copiar o que visualiza; portanto, não trate um link de compartilhamento como substituto de autorização ou minimização de dados.

## 4. Cotas e uso justo

Armazenamento, créditos de IA, limites de requisição e cotas do plano são aplicados por conta ou instalação. Não divida contas, alterne identidades, repita requisições nem use automação para evitar um limite. Podemos limitar, rejeitar ou suspender temporariamente uso desproporcional que gere custo material, risco de segurança ou degradação do serviço.

## 5. Aplicação

Consideramos gravidade, intenção, reincidência, impacto e obrigações legais. As medidas podem incluir aviso, remoção ou restrição de conteúdo, limitação, suspensão, encerramento ou comunicação às autoridades. Quando seguro e apropriado, forneceremos aviso e oportunidade de correção. Denuncie abuso para **djalmajr@gmail.com**, incluindo URL e evidências relevantes.`,
  },
  retention: {
    en: `## 1. Local-only data

Local Pinar data remains on your device until you delete it or uninstall and remove its local data. Pinar does not remotely delete local-only history.

## 2. Hosted content by plan

- **Free:** non-permanent cloud sessions and their screenshots are eligible for automatic deletion after 7 days.
- **Pro:** cloud sessions are retained while the subscription is active. When paid eligibility ends, new uploads may pause. Content above the Free quota enters a 30-day grace period followed by a recovery-only window ending 90 days after paid eligibility ended; after that it is eligible for deletion.
- **Founder and legacy Lifetime:** content is not made deletion-eligible merely because there is no recurring subscription. It remains subject to the purchased quota, user deletion, abuse and legal requirements, account closure, and service discontinuation provisions in the Terms.
- **Storage add-ons:** capacity lasts 12 months from purchase. If expiry leaves usage above the remaining quota, uploads pause; the overage receives a 30-day grace period and remains recoverable until 90 days after expiry, after which over-quota content is eligible for deletion.

Deletion eligibility is not a promise of immediate deletion at the exact boundary. Users should maintain their own backups of important content.

## 3. Account, authentication, and billing records

Web sessions generally expire after 30 days and device sessions after 180 days unless revoked earlier. One-time codes expire within minutes. We retain minimal acceptance, transaction, entitlement, fraud-prevention, tax, accounting, security, and dispute records for as long as reasonably necessary or legally required, even after content or account deletion.

## 4. Backups, logs, and deletion requests

Operational logs are retained for a limited period appropriate to security and diagnosis. Deleted data may persist temporarily in restricted backups until normal rotation. A verified deletion request removes or anonymizes data unless retention is required for law, fraud prevention, security, disputes, or exercise of rights. Contact **djalmajr@gmail.com**.`,
    pt: `## 1. Dados exclusivamente locais

Os dados locais do Pinar permanecem no seu dispositivo até que você os exclua ou desinstale e remova os dados locais. O Pinar não exclui remotamente o histórico exclusivamente local.

## 2. Conteúdo hospedado por plano

- **Free:** sessões não permanentes em nuvem e seus screenshots tornam-se elegíveis para exclusão automática após 7 dias.
- **Pro:** sessões em nuvem são retidas enquanto a assinatura estiver ativa. Quando a elegibilidade paga termina, novos envios podem ser suspensos. O conteúdo acima da cota Free entra em carência de 30 dias e depois em janela exclusiva de recuperação, encerrada 90 dias após o fim da elegibilidade paga; depois disso, torna-se elegível para exclusão.
- **Founder e Lifetime legado:** o conteúdo não se torna elegível para exclusão apenas pela inexistência de assinatura recorrente. Ele permanece sujeito à cota adquirida, exclusão pelo usuário, requisitos legais e de abuso, encerramento da conta e disposições de descontinuação do serviço presentes nos Termos.
- **Adicionais de armazenamento:** a capacidade vale por 12 meses a partir da compra. Se a expiração deixar o uso acima da cota restante, novos envios são suspensos; o excedente recebe carência de 30 dias e permanece recuperável até 90 dias após a expiração, quando conteúdo acima da cota se torna elegível para exclusão.

Elegibilidade para exclusão não significa promessa de exclusão imediata no instante exato do limite. Usuários devem manter seus próprios backups de conteúdo importante.

## 3. Registros de conta, autenticação e cobrança

Sessões web geralmente expiram após 30 dias, e sessões de dispositivos após 180 dias, salvo revogação antecipada. Códigos de uso único expiram em minutos. Mantemos os registros mínimos de aceite, transação, direito de uso, prevenção à fraude, tributos, contabilidade, segurança e disputas pelo período razoavelmente necessário ou legalmente exigido, mesmo após a exclusão de conteúdo ou da conta.

## 4. Backups, logs e pedidos de exclusão

Logs operacionais são mantidos por período limitado compatível com segurança e diagnóstico. Dados excluídos podem permanecer temporariamente em backups restritos até a rotação normal. Um pedido de exclusão verificado remove ou anonimiza dados, salvo retenção necessária por lei, prevenção à fraude, segurança, disputas ou exercício de direitos. Contato: **djalmajr@gmail.com**.`,
  },
  refunds: {
    en: `## 1. Mandatory rights

This Policy does not reduce mandatory consumer rights. In Brazil, a consumer who contracts online may exercise the statutory right of withdrawal within 7 days from the contract or receipt of the service, as applicable. Amounts covered by that right will be refunded through the original payment method.

## 2. Voluntary 14-day policy

In addition to non-waivable legal rights, you may request a refund within 14 calendar days of the initial Founder purchase or the first paid Pro charge. An unused storage or AI-credit add-on may also be refunded within 14 days. This voluntary extension does not automatically apply to later subscription renewals, substantially consumed add-ons, fraudulent activity, chargeback abuse, or accounts terminated for serious Acceptable Use violations; mandatory law still prevails.

## 3. Billing errors and cancellation

Duplicate, incorrect, or unauthorized charges should be reported promptly and will be investigated regardless of the voluntary window. Canceling Pro prevents future renewals but does not itself refund the current period. Access after a refund may be reduced to the entitlements supported by remaining valid purchases, and refunded credits or capacity may be removed.

## 4. How to request

Email **djalmajr@gmail.com** from the account email with the Checkout receipt or transaction reference and a short description. Do not send card numbers. Approved refunds are sent to the original payment method; the time to appear depends on Stripe, the payment network, and your financial institution.`,
    pt: `## 1. Direitos obrigatórios

Esta Política não reduz direitos obrigatórios do consumidor. No Brasil, o consumidor que contrata on-line pode exercer o direito legal de arrependimento em até 7 dias contados da contratação ou do recebimento do serviço, conforme aplicável. Valores abrangidos por esse direito serão devolvidos pelo meio de pagamento original.

## 2. Política voluntária de 14 dias

Além dos direitos legais irrenunciáveis, você pode solicitar reembolso em até 14 dias corridos após a compra inicial do Founder ou a primeira cobrança paga do Pro. Um adicional de armazenamento ou de créditos de IA não utilizado também pode ser reembolsado em até 14 dias. Essa extensão voluntária não se aplica automaticamente a renovações posteriores da assinatura, adicionais substancialmente consumidos, fraude, abuso de chargeback ou contas encerradas por violações graves da Política de Uso Aceitável; a lei obrigatória sempre prevalece.

## 3. Erros de cobrança e cancelamento

Cobranças duplicadas, incorretas ou não autorizadas devem ser informadas prontamente e serão investigadas independentemente da janela voluntária. Cancelar o Pro impede renovações futuras, mas não reembolsa por si só o período atual. Após um reembolso, o acesso pode ser reduzido aos direitos mantidos por outras compras válidas, e créditos ou capacidade reembolsados podem ser removidos.

## 4. Como solicitar

Envie um e-mail para **djalmajr@gmail.com** a partir do e-mail da conta, com o recibo do Checkout ou referência da transação e uma breve descrição. Não envie números de cartão. Reembolsos aprovados são enviados ao meio de pagamento original; o prazo para aparecer depende do Stripe, da rede de pagamento e da sua instituição financeira.`,
  },
  "fair-source": {
    en: `## 1. Source-available, not Open Source

Pinar publishes its source code under a Fair Source model so people can inspect, learn from, modify, and self-host the software within the repository license. Because the current license includes a competition restriction before its Change Date, the current release is **source-available and Fair Source, not OSI-approved Open Source**.

## 2. Repository license controls

The LICENSE file in the applicable source release is the legal authority for copying, modification, distribution, competitive use, the Change Date, and the later Change License. This notice explains the product model but does not replace or expand the license. Trademarks, hosted-service accounts, Stripe products, domains, secrets, and user data are not licensed with the source code.

## 3. Hosted service and Founder

Purchasing Pro or Founder buys hosted-service entitlements under the Terms; it does not buy ownership of the code or an unrestricted commercial license. Founder is a limited commercial offer with stated quotas, not a promise of unlimited or perpetual infrastructure.

## 4. Contributions and questions

Unless a separate contribution agreement says otherwise, contributions are accepted under the repository's contribution terms and applicable license. For commercial licensing, competitive-use questions, or clarification, contact **djalmajr@gmail.com** before relying on an assumption.`,
    pt: `## 1. Código disponível, não Open Source

O Pinar publica seu código-fonte sob um modelo Fair Source para que as pessoas possam inspecionar, aprender, modificar e auto-hospedar o software dentro dos limites da licença do repositório. Como a licença atual contém restrição de concorrência antes da Data de Mudança, a versão atual é **source-available e Fair Source, não Open Source aprovado pela OSI**.

## 2. A licença do repositório prevalece

O arquivo LICENSE da versão aplicável do código é a autoridade jurídica para cópia, modificação, distribuição, uso concorrente, Data de Mudança e licença posterior. Este aviso explica o modelo do produto, mas não substitui nem amplia a licença. Marcas, contas do serviço hospedado, produtos do Stripe, domínios, segredos e dados de usuários não são licenciados junto com o código-fonte.

## 3. Serviço hospedado e Founder

Comprar Pro ou Founder adquire direitos de uso do serviço hospedado conforme os Termos; não adquire a titularidade do código nem uma licença comercial irrestrita. Founder é uma oferta comercial limitada com cotas declaradas, não uma promessa de infraestrutura ilimitada ou perpétua.

## 4. Contribuições e dúvidas

Salvo disposição diferente em acordo específico, contribuições são aceitas segundo os termos de contribuição e a licença aplicável do repositório. Para licenciamento comercial, dúvidas sobre uso concorrente ou esclarecimentos, contate **djalmajr@gmail.com** antes de se basear em uma suposição.`,
  },
  subprocessors: {
    en: `## 1. Scope

Pinar uses the following core providers to operate the hosted service. A provider may act as processor, subprocessor, or independent controller depending on the data and service. This list does not include a website you choose to capture or a third-party link you independently open.

## 2. Current providers

### Cloudflare, Inc. and its affiliates

**Purpose:** application hosting and delivery, Workers execution, D1 database, R2 object storage, Workers AI inference, security controls, logs, and transactional email infrastructure. **Typical processing locations:** global Cloudflare network and the locations described in Cloudflare's contractual documentation. [Cloudflare subprocessors](https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/).

### Stripe, LLC and its affiliates

**Purpose:** Checkout, payment processing, subscription status, fraud prevention, receipts, refunds, and billing records. Pinar does not receive full card details. Stripe may also act as an independent controller for parts of payment processing. [Stripe service providers and subprocessors](https://stripe.com/legal/service-providers).

## 3. Changes

We may replace or add a provider when needed to operate the service. We will update this page before or promptly after a material change and provide additional notice when required by law or contract. Questions or lawful objections may be sent to **djalmajr@gmail.com**.`,
    pt: `## 1. Escopo

O Pinar utiliza os provedores essenciais abaixo para operar o serviço hospedado. Um provedor pode atuar como operador, suboperador ou controlador independente conforme os dados e o serviço. Esta lista não inclui um site que você escolha capturar nem um link de terceiro que você abra por decisão própria.

## 2. Provedores atuais

### Cloudflare, Inc. e afiliadas

**Finalidade:** hospedagem e entrega da aplicação, execução de Workers, banco D1, armazenamento de objetos R2, inferência por Workers AI, controles de segurança, logs e infraestrutura de e-mail transacional. **Locais típicos de tratamento:** rede global da Cloudflare e locais descritos na documentação contratual da empresa. [Suboperadores da Cloudflare](https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/).

### Stripe, LLC e afiliadas

**Finalidade:** Checkout, processamento de pagamentos, status de assinatura, prevenção à fraude, recibos, reembolsos e registros de cobrança. O Pinar não recebe os dados completos do cartão. O Stripe também pode atuar como controlador independente em partes do processamento do pagamento. [Provedores e suboperadores do Stripe](https://stripe.com/legal/service-providers).

## 3. Alterações

Podemos substituir ou adicionar um provedor quando necessário para operar o serviço. Atualizaremos esta página antes ou logo após uma mudança material e forneceremos aviso adicional quando exigido por lei ou contrato. Dúvidas ou objeções legítimas podem ser enviadas para **djalmajr@gmail.com**.`,
  },
};

function legalLanguage(language: SupportedLanguage) {
  return language === "pt" ? "pt" : "en";
}

export function isLegalDocumentId(value: string): value is LegalDocumentId {
  return LegalDocumentIds.some((documentId) => documentId === value);
}

export function legalDocument(id: LegalDocumentId, language: SupportedLanguage): LegalDocument {
  const localizedLanguage = legalLanguage(language);
  return {
    body: documents[id][localizedLanguage],
    id,
    title: titles[id][localizedLanguage],
    version: CURRENT_LEGAL_VERSION,
  };
}

export function legalDocumentTitle(id: LegalDocumentId, language: SupportedLanguage) {
  return titles[id][legalLanguage(language)];
}
