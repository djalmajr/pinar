---
id: checkout-pro-anual
name: Assinar Pro anual em BRL
reference: apps/server/src/pages/Pricing.tsx; apps/server/src/pages/Success.tsx; apps/server/src/server/cloud-api.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Stripe Sandbox/Test configurado
  - E-mail E2E sem assinatura ativa
---

## User goal

Assinar o Pro anual vendo economia e mensalidade equivalente corretas.

## Steps

1. Na landing, **clicar View plans** → Yearly inicia selecionado.
2. **Conferir R$ 39,90/ano, equivalente mensal e economia** → valores são coerentes.
3. **Clicar Get Pro Yearly** → Checkout mostra R$ 39,90 por ano.
4. **Preencher e-mail e cartão de teste** → dados correspondem à oferta anual.
5. **Confirmar a assinatura de teste** → retorna a Success.
6. **Abrir o app** → conta aparece como Pro.
7. **Conferir créditos mensais** → 200 créditos são mensais mesmo com cobrança anual.
8. **Abrir Manage billing** → portal identifica cobrança anual.

## Expected result

O anual ativa Pro sem transformar créditos mensais em um lote anual.
