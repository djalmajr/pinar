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

Assinar o Pro anual com preço e benefícios corretos.

## Steps

1. Na landing, **clicar View plans** → o Pro anual é a única opção de assinatura.
2. **Conferir R$ 99/ano, 2 GB e 500 créditos iniciais** → valores e benefícios são coerentes.
3. **Clicar Get Pro Yearly** → Checkout mostra R$ 99 por ano.
4. **Preencher e-mail e cartão de teste** → dados correspondem à oferta anual.
5. **Confirmar a assinatura de teste** → retorna a Success.
6. **Abrir o app** → conta aparece como Pro.
7. **Conferir créditos iniciais** → 500 créditos são concedidos na primeira assinatura da conta, sem recarga mensal.
8. **Abrir Manage billing** → portal identifica cobrança anual.

## Expected result

O anual ativa Pro com o preço novo e preserva as assinaturas existentes no preço contratado.
