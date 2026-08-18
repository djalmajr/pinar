---
id: viewer-copiar-markdown-assistentes
name: Copiar Markdown e abrir assistentes
reference: apps/server/src/pages/WebViewer.tsx; apps/server/src/server/markdown.ts
persona: usuario-extensao
entry: "<link não listado /v/ criado pela fixture>"
preconditions:
  - Sessão E2E compartilhada
---

## User goal

Enviar a captura a uma IA com um prompt e Markdown confiáveis.

## Steps

1. No viewer, **clicar Copy page** → botão confirma Copied.
2. **Colar em campo neutro** → Markdown contém link, página e pins reais.
3. **Abrir More actions → View Markdown** → endpoint `.md` responde texto.
4. **Comparar valores principais** → título, URL e comentários coincidem.
5. **Clicar Open ChatGPT** → nova aba recebe prompt com URL Markdown.
6. **Clicar Open Claude** → nova aba recebe prompt equivalente.
7. **Voltar ao viewer** → estado e sessão permanecem acessíveis.

## Expected result

Clipboard, `.md` e prompts externos apontam para a mesma captura.
