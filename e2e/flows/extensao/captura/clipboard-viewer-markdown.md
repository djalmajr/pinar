---
id: captura-clipboard-viewer-markdown
name: Copiar texto, HTML, imagem e viewer coerentes
reference: extension/format.js; extension/offscreen.js; extension/background.js
persona: usuario-extensao
entry: "https://stg.pinar.dev/"
preconditions:
  - Extensão configurada para incluir viewer e conteúdo do viewer
---

## User goal

Colar feedback rico em diferentes editores sem divergência entre formatos.

## Steps

1. **Criar pin com texto multilinha e caracteres especiais** → comentário é preservado.
2. **Copiar com Include viewer ativo** → clipboard recebe plain text e HTML.
3. Em editor plain text, **colar** → Markdown contém página, pin e link do viewer.
4. Em editor rich text, **colar** → imagem e estrutura HTML aparecem sem scripts.
5. **Abrir o link do viewer** → dados correspondem ao conteúdo colado.
6. **Abrir `.md` do viewer** → Markdown remoto usa os mesmos valores.
7. Com Copy viewer content ativo, **copiar novamente** → conteúdo remoto é incorporado.
8. **Simular indisponibilidade temporária do `.md`** → fallback mantém detalhe local e link quando possível.
9. **Conferir caracteres** → HTML escapado não altera o comentário original.

## Expected result

Todos os formatos do clipboard descrevem a mesma captura autêntica e segura.
