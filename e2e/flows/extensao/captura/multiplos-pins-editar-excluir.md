---
id: captura-multiplos-pins-editar-excluir
name: Editar, excluir e ordenar múltiplos pins
reference: extension/content.js; extension/pin-colors.js; extension/session.js
persona: power-user
entry: "https://stg.pinar.dev/"
preconditions:
  - Extensão carregada no Chrome
---

## User goal

Preparar uma revisão com vários comentários e corrigir erros antes de copiar.

## Steps

1. **Ativar a extensão e criar três pins** → números e cores são distintos e estáveis.
2. **Abrir o segundo pin** → comentário existente aparece para edição.
3. **Alterar o comentário e salvar** → card/overlay reflete o novo texto.
4. **Abrir o primeiro pin e excluir** → pin some e os restantes mantêm identidade coerente.
5. **Iniciar um quarto comentário e pressionar Esc** → somente o rascunho é cancelado.
6. **Pressionar Esc sem rascunho** → pins são limpos conforme regra documentada.
7. **Criar novamente dois pins e copiar** → ordem visual corresponde ao bundle.
8. **Abrir viewer** → mesma ordem aparece na sidebar.
9. **Abrir pin 1 e pin 2** → conteúdo pertence à marca correta.
10. **Conferir screenshot** → badges não cobrem indevidamente os alvos.

## Expected result

Edição, exclusão, cancelamento e ordem permanecem consistentes até o viewer.
