---
id: checkout-creditos-ia
name: Comprar 1.000 créditos de IA
reference: apps/server/src/pages/Pricing.tsx; apps/server/src/server/cloud-api.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Conta E2E autenticada
  - Stripe Sandbox/Test configurado
---

## User goal

Adicionar créditos avulsos e confirmar saldo e validade sem mudar meu plano.

## Steps

1. Em Plans, **localizar 1,000 AI credits** → R$ 9,90 e validade de 12 meses aparecem.
2. **Clicar Buy add-on no card correto** → Checkout identifica créditos de IA.
3. **Conferir total e pagamento único** → nenhuma assinatura é criada.
4. **Pagar com cartão de teste** → retorna à Success como add-on.
5. **Abrir uma sessão e gerar resumo** → saldo inclui 1.000 créditos comprados.
6. **Conferir ordem de consumo** → créditos mensais são usados antes do pack.
7. **Reentregar webhook** → concessão não duplica.
8. **Manter plano original** → compra não altera Free/Pro/Founder/Lifetime legado.

## Expected result

O pack adiciona exatamente 1.000 créditos por 12 meses e preserva o plano.
