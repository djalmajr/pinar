---
id: assinatura-evento-duplicado-fora-ordem
name: Preservar o estado mais novo após reenvio
reference: apps/server/src/server/cloud-api.ts; apps/server/src/server/stripe-subscription-state.ts
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Conta Pro Test com eventos Stripe controláveis
---

## User goal

Confiar que reenvios e atrasos do provedor não mudem meu plano para um estado antigo.

## Steps

1. Com Pro ativo, **abrir Account menu** → plano atual é Pro.
2. **Emitir evento de cancelamento mais novo** → app passa ao estado terminal esperado.
3. **Reentregar o mesmo evento** → estado e grants não mudam novamente.
4. **Entregar depois um evento active mais antigo** → estado terminal é preservado.
5. Em nova assinatura, **entregar cancelamento da assinatura antiga** → assinatura atual não é demovida.
6. **Reabrir o app após cada evento** → UI reflete a ordem válida.
7. **Conferir histórico de eventos** → cada event id foi processado uma vez.

## Expected result

Ordenação e idempotência preservam sempre o estado mais recente da assinatura correta.
