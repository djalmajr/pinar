---
id: workspace-destino-invalido-fallback
name: Voltar com segurança para Personal e Inbox
reference: extension/destination.js; apps/server/src/server/cloud-api.ts; apps/cli/src/history.mjs
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Extensão aponta para coleção que será removida ou pertence a outro principal
---

## User goal

Não perder uma captura quando meu destino salvo deixou de existir.

## Steps

1. Na extensão, **selecionar coleção E2E como destino** → preferência é salva.
2. No workspace, **excluir essa coleção** → sessões existentes são preservadas.
3. Na página anotada, **criar nova captura sem reabrir opções** → upload resolve destino.
4. **Abrir workspace** → nova sessão está em Personal/Inbox.
5. **Reabrir opções da extensão** → destino exibido foi corrigido.
6. Repetir com id de coleção estrangeira, **criar captura** → não atravessa conta/instalação.
7. **Conferir conta estrangeira** → nenhum dado novo aparece.

## Expected result

Destino inválido sempre cai no Inbox do próprio principal, sem perda ou vazamento.
