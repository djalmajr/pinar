---
id: workspace-reordenar-arvore
name: Reordenar projetos e coleções
reference: apps/server/src/components/HistorySidebar.tsx; apps/server/src/lib/collection-tree.ts; apps/server/src/server/cloud-api.ts
persona: power-user
entry: "https://stg.pinar.dev/"
preconditions:
  - Três projetos e quatro coleções E2E
---

## User goal

Colocar projetos e pastas na ordem do meu trabalho diário.

## Steps

1. Selecionar o terceiro projeto e usar **Move earlier** duas vezes → ordem muda por uma ação acessível.
2. **Recarregar** → nova ordem de projetos persiste.
3. Na sidebar, **arrastar coleção raiz acima de outra** → posição muda.
4. **Arrastar horizontalmente para aninhar** → projeção mostra novo parent.
5. **Arrastar para a esquerda para desaninhar** → volta à raiz.
6. **Tentar mover Inbox** → item protegido permanece fixo.
7. **Mover uma subárvore** → descendentes acompanham o pai.
8. **Recarregar** → ordem e hierarquia persistem no backend.

## Expected result

Ações de ordem de projeto e drag-and-drop de coleções persistem posições, profundidade e proteção dos itens fixos.
