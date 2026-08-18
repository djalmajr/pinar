---
id: sharing-indisponivel-expirado
name: Explicar recurso ausente ou expirado
reference: apps/server/src/pages/WebViewer.tsx; apps/server/src/pages/AggregateViewer.tsx; apps/server/src/server/cloud-api.ts
persona: skeptical
entry: "<link não listado ausente ou expirado>"
preconditions:
  - Links E2E para sessão inexistente, sessão Free expirada e agregado vazio
---

## User goal

Entender por que um link recebido não mostra mais conteúdo e o que fazer em seguida.

## Steps

1. **Abrir sessão inexistente** → viewer mostra Not found, não skeleton infinito.
2. **Usar Back to history quando disponível** → navegação leva ao gate apropriado.
3. **Abrir sessão Free expirada** → conteúdo não é servido publicamente.
4. **Abrir `.md` correspondente** → resposta não vaza conteúdo expirado.
5. **Abrir coleção que ficou vazia** → agregado explica ausência de sessões.
6. **Abrir id de outra conta não compartilhado** → resposta não enumera owner.

## Expected result

Ausência e expiração falham de forma segura, clara e sem vazamento.
