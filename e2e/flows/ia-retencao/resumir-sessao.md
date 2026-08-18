---
id: ia-resumir-sessao
name: Gerar resumo e debitar um crédito
reference: apps/server/src/pages/WebViewer.tsx; apps/server/src/server/cloud-api.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Conta E2E autenticada com créditos
  - Sessão própria com comentários conhecidos
---

## User goal

Transformar uma captura em resumo de IA e saber o custo da ação.

## Steps

1. No workspace, **abrir a sessão própria** → viewer mostra dados autênticos.
2. **Clicar AI summary** → diálogo abre em carregamento.
3. **Aguardar resposta** → resumo e highlights refletem os comentários da sessão.
4. **Conferir saldo restante** → diminuiu pelo custo declarado.
5. **Fechar e abrir novamente AI summary** → resultado em memória reaparece sem novo pedido.
6. **Recarregar e repetir com mesmo request id da fixture** → backend devolve replay idempotente.
7. **Consultar entitlement** → ledger e saldo concordam.
8. **Conferir telemetria** → modelo, tokens, neurons e custo estimado foram registrados.

## Expected result

Resumo usa sessão própria, debita uma vez e apresenta resultado estruturado.
