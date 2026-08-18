---
id: assinatura-sucesso-idempotente
name: Reabrir sucesso sem duplicar concessões
reference: apps/server/src/pages/Success.tsx; apps/server/src/server/cloud-api.ts
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Checkout Test recém-concluído
  - Claim de sucesso preservado pela própria navegação
---

## User goal

Atualizar ou reabrir a confirmação sem receber cobrança ou benefício duplicado.

## Steps

1. Em Plans, **concluir uma oferta Test** → Stripe retorna a Success com session e claim.
2. **Aguardar ativação** → oferta e conta corretas aparecem.
3. **Recarregar Success pelo navegador** → compra continua confirmada.
4. **Abrir a mesma URL de retorno na aba de origem** → claim válido não duplica fulfillment.
5. **Conferir entitlement** → saldo/quota/plano mudou exatamente uma vez.
6. **Reentregar checkout.session.completed** → estado permanece idêntico.
7. **Abrir o app** → sessão de conta continua válida.

## Expected result

Polling, reload e webhook repetido convergem para uma única concessão.
