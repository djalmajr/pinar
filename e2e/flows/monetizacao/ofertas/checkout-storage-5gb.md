---
id: checkout-storage-5gb
name: Comprar 5 GB por 12 meses
reference: apps/server/src/pages/Pricing.tsx; apps/server/src/server/cloud-api.ts; apps/server/src/lib/entitlements.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Conta E2E autenticada
  - Stripe Sandbox/Test configurado
---

## User goal

Adicionar 5 GB temporários sem mudar meu plano principal.

## Steps

1. Em Plans, **localizar +5 GB storage** → preço e validade de 12 meses aparecem.
2. **Clicar Buy add-on no card de 5 GB** → Checkout identifica o pack correto.
3. **Conferir R$ 9,90 e pagamento único** → não há recorrência.
4. **Pagar com cartão de teste** → Success confirma add-on.
5. **Abrir o app e consultar storage** → quota aumenta exatamente 5 GB.
6. **Comprar outro pack igual** → quotas empilham.
7. **Reentregar webhook** → pack não duplica.
8. **Conferir plano** → permanece Free, Pro, Founder ou Lifetime legado original.

## Expected result

Cada compra soma 5 GB por 12 meses de forma idempotente.
