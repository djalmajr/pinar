---
id: checkout-pro-mensal
name: Assinar Pro mensal em BRL
reference: apps/server/src/pages/Pricing.tsx; apps/server/src/pages/Success.tsx; apps/server/src/server/cloud-api.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Stripe Sandbox/Test configurado
  - E-mail E2E sem assinatura ativa
---

## User goal

Assinar o Pro com cobrança mensal e receber benefícios imediatamente.

## Steps

1. Na landing, **clicar View plans** → preços regionais BRL aparecem.
2. **Selecionar Monthly** → card mostra Pro Monthly e R$ 4,90/mês.
3. **Clicar Get Pro Monthly** → Checkout Sandbox exibe Pinar Pro e total mensal correspondente.
4. **Preencher e-mail e cartão de teste de sucesso** → Subscribe fica disponível.
5. **Confirmar a assinatura de teste** → Stripe redireciona para Success.
6. **Aguardar ativação** → página mostra conta e plano Pro.
7. **Clicar Open app** → workspace autenticado abre.
8. **Conferir retenção, 5 GB e créditos** → entitlement corresponde ao Pro.

## Expected result

Uma única assinatura mensal ativa a conta Pro com preço e entitlement corretos.
