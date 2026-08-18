---
id: checkout-3ds
name: Concluir autenticação 3DS de teste
reference: apps/server/src/pages/Pricing.tsx; apps/server/src/pages/Success.tsx; apps/server/src/server/cloud-api.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Stripe Sandbox/Test configurado
  - Cartão Stripe Test que exige 3DS
---

## User goal

Concluir uma compra que exige autenticação adicional sem perder o contexto.

## Steps

1. Em Plans, **iniciar Pro anual** → Checkout mostra a oferta anual.
2. **Preencher cartão 3DS de teste** → confirmação abre o desafio.
3. No desafio, **aprovar a autenticação** → volta ao Checkout em processamento.
4. **Aguardar redirecionamento** → Success abre somente após confirmação.
5. **Conferir oferta e e-mail** → dados correspondem à compra iniciada.
6. **Abrir o app** → plano Pro está ativo.
7. **Recarregar Success** → ativação continua idempotente.
8. **Abrir billing** → assinatura anual existe uma única vez.

## Expected result

O desafio 3DS preserva a oferta e ativa exatamente uma assinatura após sucesso.
