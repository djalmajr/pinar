---
id: checkout-cancelado
name: Abandonar Checkout sem cobrança
reference: apps/server/src/pages/Pricing.tsx; apps/server/src/server/cloud-api.ts
persona: skeptical
entry: "http://127.0.0.1:3000/"
preconditions:
  - Indisponível desde 2026-10-18: exige Stripe Test hospedado, e o único ambiente com ele (staging) foi desativado; o Cloud local usa credenciais Stripe inertes
  - Stripe Sandbox/Test configurado
  - Conta sem a oferta selecionada
---

## User goal

Desistir da compra e voltar ao Pinar sem cobrança ou benefício indevido.

## Steps

1. Em Plans, **iniciar qualquer oferta** → Checkout Sandbox abre.
2. **Conferir a oferta sem preencher pagamento** → total é visível.
3. **Clicar Back to Pinar** → retorna à página de preços.
4. **Conferir que não há mensagem de sucesso** → nenhuma ativação é sugerida.
5. **Abrir o workspace** → plano, créditos e storage não mudaram.
6. **Iniciar novamente a oferta** → uma nova tentativa continua disponível.

## Expected result

Abandono retorna com segurança e não materializa pagamento nem entitlement.
