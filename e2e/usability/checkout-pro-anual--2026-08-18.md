# Usabilidade — Assinar Pro anual em BRL

- **Persona:** usuario-pago
- **Data:** 2026-08-17 a 2026-08-18
- **Entrada:** https://stg.pinar.dev/
- **Veredito:** ⚠️ concluído com erro na Success e saldo sem UI

## Walkthrough

1. Parti da landing, cliquei em **View plans** e confirmei o anual selecionado a R$ 39,90/ano, equivalente a R$ 3,33/mês.
2. Cliquei em **Get Pro Yearly**; o Checkout Stripe Sandbox apresentou oferta, recorrência e total anual corretos.
3. Preenchi `djalmajr@gmail.com` e cartão Stripe Test `4242`; a assinatura foi paga e criou a subscription anual.
4. O retorno chegou a `/success`, mas exibiu simultaneamente **Payment confirmed** e **Checkout session is missing**.
5. Como diagnóstico fora do percurso UX, reapresentei a URL de retorno completa. A conta foi ativada de forma idempotente e `/app` passou a mostrar `djalmajr@gmail.com` com plano `pro`.
6. Abri **Manage billing** pelo menu real. O portal Test mostrou **Pinar Pro**, R$ 39,90 por ano, próxima cobrança em 18/08/2027, cartão final 4242 e invoice paga.
7. Não foi possível conferir 200 créditos mensais: o produto não possui uma superfície visível de saldo.

## Findings (priorizados)

| # | Severity | Step | What happened | Suggested fix |
|---|---|---|---|---|
| 1 | major | 4 | A Success conserva o erro “Checkout session is missing” depois que a ativação já começou e a URL sensível é limpa. | Usar estado exclusivo e aceitar `missing` somente antes da primeira tentativa de ativação. |
| 2 | major | 5 | O staging ainda mostra o bloco de agradecimento/patrocínio para a conta Pro. | Entregar a correção já coberta por `sponsorship.e2e.test.ts`, ocultando a seção inteira para qualquer plano pago. |
| 3 | minor | 7 | O usuário não consegue conferir créditos incluídos ou comprados pela UI. | Expor saldo, próxima reposição e vencimentos no menu/área de conta. |

## Key screens

- `screenshots/2026-08-17/checkout-pro-anual--01-pronto-para-confirmar.png`
- `screenshots/2026-08-17/checkout-pro-anual--02-success-sem-session-id.png`
- `screenshots/2026-08-17/checkout-pro-anual--03-portal-anual.png`
- `screenshots/2026-08-17/checkout-pro-anual--04-conta-pro.png`

## Cobertura automatizada

- `tests/e2e/monetizacao/success.e2e.test.ts`: falhou antes e passou depois da correção local.
- `apps/server/src/lib/success-state.test.ts`: cobre a corrida entre hidratação, limpeza da URL e ativação.
- `apps/server/src/server/cloud-api.test.ts`: preço, claim, idempotência, grants e 200 créditos mensais.
- Manual-only pendente: revalidar a Success e o patrocínio em staging após entrega; conferir créditos quando houver superfície visível.
