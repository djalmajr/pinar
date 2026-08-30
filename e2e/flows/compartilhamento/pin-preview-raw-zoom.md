---
id: viewer-pin-preview-raw-zoom
name: Inspecionar pin, Markdown bruto e screenshot
reference: apps/server/src/pages/WebViewer.tsx; apps/server/src/components/ImageZoomStage.tsx; apps/server/src/lib/pin-markdown.ts
persona: visitante
entry: "<link não listado /v/ criado pela fixture>"
preconditions:
  - Sessão E2E com pin de elemento e pin de área
---

## User goal

Examinar exatamente o contexto de cada comentário e ampliar detalhes visuais.

## Steps

1. **Abrir o link da captura** → o viewer local abre como modal com zoom já ativo (100%).
2. No viewer, **clicar o primeiro card de pin** → diálogo abre em Preview.
3. **Conferir comentário, seletor, DOM path e coordenadas** → valores são da captura.
4. **Alternar para Raw** → Markdown bruto contém o mesmo conteúdo uma vez.
5. **Fechar e abrir o pin de área** → tipo Area selection aparece.
6. **Usar Zoom in, Zoom out e Reset** → escala responde com limites.
7. **Arrastar/pan quando ampliado** → imagem continua alcançável.

## Expected result

Preview, Raw e zoom mantêm o mesmo dado; o zoom é o modo padrão do viewer, sem um segundo diálogo de ampliar.
