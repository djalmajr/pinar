---
id: assinatura-reativar
name: Desfazer cancelamento agendado
reference: apps/server/src/components/AppShell.tsx; apps/server/src/server/cloud-api.ts; apps/server/src/server/stripe-subscription-state.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Assinatura Pro Test com cancelamento ao fim do período
---

## User goal

Retomar a renovação antes do fim do período sem criar segunda assinatura.

## Steps

1. No workspace, **abrir Manage billing** → portal mostra cancelamento agendado.
2. **Escolher reativar assinatura** → portal confirma renovação normal.
3. **Voltar ao Pinar** → plano continua Pro.
4. **Conferir Stripe customer** → mesma subscription foi atualizada.
5. **Avançar Test Clock à renovação** → cobrança Test renova a assinatura.
6. **Reabrir o app** → conta permanece Pro.
7. **Conferir créditos** → uma única reposição mensal ocorreu.
8. **Tentar iniciar novo Checkout Pro** → produto evita assinatura duplicada ou mantém estado coerente.

## Expected result

Reativação cancela o encerramento da mesma assinatura e preserva entitlements.
