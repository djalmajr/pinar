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

Adicionar 5 GB temporários e diferenciar claramente o pack maior.

## Steps

1. Em Plans, **localizar +5 GB storage** → R$ 29,90 e validade aparecem.
2. **Clicar Buy add-on no card de 5 GB** → Checkout identifica o pack maior.
3. **Conferir total e pagamento único** → não confunde com 1 GB.
4. **Pagar com cartão de teste** → Success confirma add-on.
5. **Abrir o app e consultar storage** → quota aumenta exatamente 5 GB.
6. **Combinar com pack de 1 GB** → soma total é 6 GB além da base.
7. **Reentregar webhook** → pack não duplica.
8. **Conferir plano** → permanece inalterado.

## Expected result

O pack maior soma 5 GB por 12 meses e empilha com outros grants.
