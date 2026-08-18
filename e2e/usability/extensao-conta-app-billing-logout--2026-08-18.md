# Usabilidade — Conta, app, billing e logout na extensão

- **Persona:** usuário Pro
- **Data:** 2026-08-18
- **Ambiente:** bundle de produção das opções, Chromium e `chrome.runtime` controlado
- **Veredito:** ✅ atalhos e transições coerentes; serviços hospedados reais ainda pendentes

## Walkthrough

1. Em **Account**, confirmei `djalmajr@gmail.com` e o badge **pro**.
2. **Open app** abriu uma aba da identidade `local/account`.
3. **Manage Billing** abriu uma aba separada do customer Pro e o estado da conta permaneceu.
4. **Sign out** mudou o badge para **Free**.
5. Em Storage, a árvore mudou de **Account Local** para **Installation Local**.
6. **Open app** passou a abrir `local/installation`.
7. Solicitei código para `djalmajr@gmail.com`, validei `123456` na fronteira controlada e recuperei a conta Pro.
8. A árvore voltou a **Account Local**, sem um segundo projeto.

## Finding corrigido

O CTA Free exibia preço USD fixo (`$19/yr`; nas traduções, variantes equivalentes), embora a página de preços tenha regionalização BRL/USD. Uma asserção exata para **Upgrade to Pro** falhou antes da correção. O preço foi removido das sete traduções; o link continua apontando para `https://pinar.dev/pricing`, fonte regional correta.

## Cobertura automatizada

- `tests/e2e/extensao/options-storage-account.e2e.test.ts`: identidade, plano, popups de app/billing, logout, árvore da instalação e retorno por e-mail.
- Resultado final: caso de Account aprovado em Chromium após regressão vermelho → verde.
- Pendente: Customer Portal Stripe real, OTP recebido por e-mail e revogação do token de dispositivo numa extensão realmente instalada.
