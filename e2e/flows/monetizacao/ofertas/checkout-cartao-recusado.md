---
id: checkout-cartao-recusado
name: Receber recusa de cartão sem ativar oferta
reference: apps/server/src/pages/Pricing.tsx; apps/server/src/pages/Success.tsx; apps/server/src/server/cloud-api.ts
persona: skeptical
entry: "http://127.0.0.1:3000/"
preconditions:
  - Indisponível desde 2026-10-18: exige Stripe Test hospedado, e o único ambiente com ele (staging) foi desativado; o Cloud local usa credenciais Stripe inertes
  - Stripe Sandbox/Test configurado
  - Cartão de teste de recusa disponível
---

## User goal

Entender a recusa e tentar outro cartão sem ganhar acesso não pago.

## Steps

1. Em Plans, **iniciar Pro anual** → Checkout abre com a oferta correta.
2. **Preencher e-mail e cartão de recusa Stripe Test** → dados são aceitos para envio.
3. **Confirmar Subscribe** → Checkout exibe recusa legível e permanece na página.
4. **Conferir que Success não abriu** → app não anuncia ativação.
5. **Abrir o workspace em outra aba pela UI** → conta continua no plano anterior.
6. **Trocar para cartão de sucesso** → tentativa pode ser concluída.
7. **Conferir somente uma ativação** → falha anterior não gerou grant.

## Expected result

A recusa não cria plano/grant e permite recuperação no próprio Checkout.
