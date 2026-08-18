---
id: viewer-abrir-sessao-publica
name: Abrir captura não listada com dados autênticos
reference: apps/server/src/pages/WebViewer.tsx; apps/server/src/routes/v/$id.tsx; apps/server/src/server/cloud-api.ts
persona: visitante
entry: "<link não listado /v/ criado pela fixture>"
preconditions:
  - Sessão E2E compartilhada com título, URL, screenshot e dois pins conhecidos
---

## User goal

Entender uma captura recebida sem conta e sem conhecer o workspace do autor.

## Steps

1. **Abrir o link recebido** → viewer carrega sem sign-in.
2. **Conferir título e URL original** → iguais aos dados capturados.
3. **Conferir screenshot** → corresponde à página anotada.
4. **Ler contagem e cards de pins** → dois comentários autênticos aparecem na ordem.
5. **Abrir a URL original em nova aba** → link externo é explícito.
6. **Inspecionar navegação disponível** → nenhum projeto/coleção privado é enumerado.

## Expected result

O link explica a captura autêntica e expõe somente a sessão não listada.
