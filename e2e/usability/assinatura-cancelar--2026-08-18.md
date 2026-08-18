# Usabilidade — Agendar cancelamento da assinatura anual

- **Persona:** usuario-pago
- **Data:** 2026-08-18
- **Entrada:** https://stg.pinar.dev/app
- **Ambiente:** Pinar staging + Stripe Sandbox
- **Veredito:** ✅ cancelamento agendado sem perda antecipada do Pro

## Walkthrough

1. Parti da conta `djalmajr@gmail.com`, plano Pro, e abri **Manage billing**.
2. O portal mostrou a assinatura anual de R$ 39,90, cartão Test final 4242 e próxima cobrança em 18/08/2027.
3. Iniciei o cancelamento; a confirmação informou que o serviço permaneceria disponível até 18/08/2027.
4. Confirmei com motivo **Other reason**. O portal passou a mostrar **Cancels Aug 18, 2027** e ofereceu **Don't cancel subscription**.
5. Voltei ao Pinar. A sessão continuou válida e o menu da conta permaneceu em `pro`.
6. No Stripe Dashboard, a mesma subscription `sub_1U5d9UJGVFdtzSCOnKm3Yi9x` continuou `Active` com encerramento em 18/08/2027.
7. O destino `pinar-server-test` entregou dois `customer.subscription.updated` ao Worker com `200 {"received":true}`: o primeiro agendou o encerramento; o segundo registrou o feedback.

## Payload observado

- Evento de agendamento: `evt_1U5dbFJGVFdtzSCOiTARHSFw`.
- Evento de feedback: `evt_1U5dbFJGVFdtzSCOxE9JOHAT`.
- Em billing flexível, o cancelamento ao fim do período veio como `status=active`, `cancel_at=1818557602`, `cancel_at_period_end=false` e `canceled_at=1787023324`.
- O segundo evento ocorreu um segundo depois e alterou apenas `cancellation_details.feedback` para `other`.
- Portanto, o Pinar deve manter Pro enquanto o status for `active`; o downgrade só é terminal quando o Stripe emitir `customer.subscription.deleted` ou `status=canceled`.

## Findings

| # | Severity | Step | What happened | Disposition |
|---|---|---|---|---|
| 1 | info | 7 | Um único cancelamento pelo portal gerou dois eventos consecutivos. | Tratar ambos idempotentemente e sem grants extras; coberto por integração local. |
| 2 | env | 6 | O Sandbox mostra auto-cancelamento em 16/11/2026. | É política de retenção de assinaturas Test após 90 dias, não o cancelamento solicitado e não afeta produção. |
| 3 | pending | 8 | O término real e a preservação de dados acima da quota ainda não foram exercitados no Browser. | Usar uma assinatura/simulação Test dedicada e validar `customer.subscription.deleted`, Free e bloqueio apenas de novos uploads. |

## Key screens

- `screenshots/2026-08-17/assinatura-cancelar--01-confirmacao-final.png`
- `screenshots/2026-08-17/assinatura-cancelar--02-agendado.png`
- `screenshots/2026-08-17/assinatura-cancelar--03-pinar-ainda-pro.png`

## Cobertura automatizada

- `apps/server/src/server/cloud-api.test.ts`: reproduz os dois eventos reais de cancelamento flexível, mantém Pro e conserva um único saldo mensal de 200 créditos.
- `apps/server/src/server/cloud-api.test.ts`: cobre o evento terminal assinado, login preservado, evento antigo/mesmo segundo e subscription anterior.
- Manual-only pendente: avançar uma simulação dedicada ao término, confirmar downgrade na UI e validar dados existentes acima da quota.
