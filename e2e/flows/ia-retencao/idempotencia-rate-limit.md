---
id: ia-idempotencia-rate-limit
name: Repetir pedido sem novo débito e respeitar limite
reference: apps/server/src/server/cloud-api.ts; apps/server/src/pages/WebViewer.tsx
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Conta E2E autenticada com créditos
  - Sessão própria
---

## User goal

Repetir uma ação após dúvida de rede sem pagar duas vezes nem sobrecarregar o serviço.

## Steps

1. **Gerar resumo com request id conhecido** → resposta conclui e saldo cai uma vez.
2. **Repetir exatamente o mesmo request** → mesma resposta volta sem novo débito.
3. **Disparar outro request enquanto o primeiro está reservado** → estado in progress é informado.
4. **Repetir rapidamente ids novos até o limite** → rate limit bloqueia excesso.
5. **Conferir saldo** → pedidos limitados não consomem crédito.
6. **Aguardar janela e tentar novamente** → serviço volta a aceitar.
7. **Conferir ledger** → um registro por request id, sem saldo negativo.

## Expected result

Retries são idempotentes e rate limit não cobra ações recusadas.
