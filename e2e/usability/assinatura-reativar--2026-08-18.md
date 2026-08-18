# Usabilidade — Reativar a assinatura anual

- **Persona:** usuario-pago
- **Data:** 2026-08-18
- **Entrada:** https://stg.pinar.dev/app
- **Ambiente:** Pinar staging + Stripe Sandbox
- **Veredito:** ✅ mesma assinatura reativada sem nova cobrança nem grant duplicado

## Walkthrough

1. Abri **Manage billing** na conta Pro que exibia cancelamento em 18/08/2027.
2. Escolhi **Don't cancel subscription**. A confirmação informou que a assinatura voltaria a renovar em 18/08/2027.
3. Confirmei **Renew subscription**. O portal removeu o cancelamento, restaurou a próxima cobrança e voltou a oferecer **Cancel subscription**.
4. Voltei ao Pinar. A mesma sessão permaneceu autenticada e o plano continuou `pro`.
5. No Stripe Dashboard, a subscription continuou sendo `sub_1U5d9UJGVFdtzSCOnKm3Yi9x`, `Active`, com próximo invoice de R$ 39,90 em 18/08/2027.
6. O destino `pinar-server-test` recebeu `customer.subscription.updated` do Customer portal e respondeu `200 {"received":true}`.

## Payload observado

- Evento: `evt_1U5di2JGVFdtzSCOfKroEi9z`.
- O objeto permaneceu `status=active` e voltou a `cancel_at=null`, `canceled_at=null`, `cancellation_details.reason=null` e `feedback=null`.
- `previous_attributes` continha o `cancel_at`, `canceled_at`, motivo e feedback anteriores.
- Não houve nova Checkout Session, invoice imediata ou nova subscription.

## Findings

| # | Severity | Step | What happened | Disposition |
|---|---|---|---|---|
| 1 | info | 5 | O Dashboard ainda mostra **Auto-cancels Nov 16, 2026**. | Política separada de retenção do Sandbox em 90 dias; a assinatura de negócio foi reativada corretamente. |
| 2 | minor | 4 | Staging ainda usa o menu antigo no header e exibe o bloco pago de agradecimento. | Correções locais já têm regressões; revalidar somente após deploy autorizado. |
| 3 | pending | 7 | Renovação anual e reposição mensal não possuem prova visível no produto. | Avançar Test Clock dedicado e criar UI de saldo/próxima reposição antes de considerar o fluxo integral. |

## Key screens

- `screenshots/2026-08-17/assinatura-reativar--01-confirmacao.png`
- `screenshots/2026-08-17/assinatura-reativar--02-ativa.png`
- `screenshots/2026-08-17/assinatura-reativar--03-pinar-pro.png`

## Cobertura automatizada

- `apps/server/src/server/cloud-api.test.ts`: reproduz o payload observado de reativação na mesma subscription e prova que plano Pro e saldo mensal de 200 permanecem sem duplicação.
- `apps/server/src/server/cloud-api.test.ts`: cobre reposição mensal sem rollover em assinatura anual.
- Manual-only pendente: renovação real por simulação Test, saldo visível e prevenção de segunda assinatura pela UI.
