---
id: workspace-colecao-crud-aninhada
name: Criar, aninhar, renomear e excluir coleção
reference: apps/server/src/pages/HistoryDashboard.tsx; apps/server/src/components/HistorySidebar.tsx; apps/server/src/lib/collection-tree.ts
persona: power-user
entry: "https://stg.pinar.dev/"
preconditions:
  - Projeto E2E selecionado
---

## User goal

Organizar sessões em uma hierarquia de coleções sem quebrar Inbox.

## Steps

1. **Clicar New collection, nomear Parent e salvar** → coleção raiz aparece.
2. Em ações de Parent, **criar Child como subcoleção** → indentação mostra relação pai/filho.
3. **Conferir Parent/Child na árvore** → relação aninhada aparece sem depender da ordem de criação.
4. **Renomear Child** → nome persiste sem perder parent.
5. **Criar sessão em Child** → contagem e filtro refletem a sessão.
6. **Recolher Parent** → Child fica oculto; expandir restaura.
7. **Validar a projeção de Parent para dentro de Child** → ciclo é rejeitado pelo contrato de árvore; os gestos de drag pertencem ao fluxo dedicado de reordenação.
8. **Tentar excluir Inbox** → ação destrutiva não está disponível.
9. **Excluir Parent** → Child é promovida conforme contrato.
10. **Excluir Child** → sessão é preservada no fallback.
11. **Recarregar** → árvore e sessão permanecem consistentes.

## Expected result

Hierarquia evita ciclos, protege Inbox e preserva sessões ao excluir contêineres.
