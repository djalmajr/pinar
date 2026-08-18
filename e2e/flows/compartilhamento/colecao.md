---
id: sharing-colecao
name: Compartilhar agregado de coleção
reference: apps/server/src/pages/AggregateViewer.tsx; apps/server/src/routes/c/$id.tsx; apps/server/src/server/markdown.ts
persona: visitante
entry: "<link não listado /c/ criado pela fixture>"
preconditions:
  - Coleção E2E com três sessões ordenadas
---

## User goal

Revisar somente as capturas selecionadas de uma coleção.

## Steps

1. **Abrir o link de coleção** → nome e contagem aparecem.
2. **Conferir os três cards** → ordem corresponde à coleção no workspace.
3. **Clicar Open no segundo card** → viewer da sessão correta abre.
4. **Voltar pelo navegador** → coleção continua acessível.
5. **Clicar Copy Markdown** → confirmação aparece.
6. **Colar o conteúdo** → somente sessões da coleção estão presentes.
7. **Mover uma sessão para outra coleção no workspace** → agregado deixa de listá-la após reload.
8. **Conferir conta vizinha** → nenhuma sessão estrangeira aparece.

## Expected result

O agregado acompanha a coleção atual e respeita isolamento e ordem.
