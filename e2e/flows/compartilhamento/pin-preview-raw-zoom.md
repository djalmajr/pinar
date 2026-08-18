---
id: viewer-pin-preview-raw-zoom
name: Inspecionar pin, Markdown bruto e screenshot
reference: apps/server/src/pages/WebViewer.tsx; apps/server/src/components/ImageZoomDialog.tsx; apps/server/src/lib/pin-markdown.ts
persona: visitante
entry: "<link não listado /v/ criado pela fixture>"
preconditions:
  - Sessão E2E com pin de elemento e pin de área
---

## User goal

Examinar exatamente o contexto de cada comentário e ampliar detalhes visuais.

## Steps

1. No viewer, **clicar o primeiro card de pin** → diálogo abre em Preview.
2. **Conferir comentário, seletor, DOM path e coordenadas** → valores são da captura.
3. **Alternar para Raw** → Markdown bruto contém o mesmo conteúdo uma vez.
4. **Fechar e abrir o pin de área** → tipo Area selection aparece.
5. **Fechar o pin e clicar no screenshot** → zoom abre.
6. **Usar Zoom in, Zoom out e Reset** → escala responde com limites.
7. **Arrastar/pan quando ampliado** → imagem continua alcançável.
8. **Fechar zoom** → retorna ao viewer no mesmo estado.
9. **Ocultar/mostrar sidebar de pins** → screenshot continua utilizável.

## Expected result

Preview, Raw e zoom mantêm o mesmo dado e não prendem o visitante em um modal.
