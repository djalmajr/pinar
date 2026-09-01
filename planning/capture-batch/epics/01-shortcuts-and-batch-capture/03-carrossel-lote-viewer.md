# Story 3: Carrossel do lote na visualização agregada

**Origin:** `planning/capture-batch/epics/01-shortcuts-and-batch-capture/00-overview.md`

## Traceability
- Prototype routes/screens: `/c/{id}`, `/p/{id}`
- Business rules: —
- Artigo de ajuda afetado: `sharing-links`

## Context

- **Problema:** um lote de 8 páginas vira uma lista vertical longa; revisar exige rolagem e perde a noção de percurso.
- **Objetivo:** apresentar a coleção como galeria navegável item a item.
- **Valor:** revisar um fluxo multi-página com a mesma ergonomia de um carrossel de telas.
- **Restrição:** não regredir a projeção Markdown nem a acessibilidade da listagem atual.

## Files

| Caminho | Ação | Motivo |
|---|---|---|
| `apps/server/src/pages/AggregateViewer.tsx` | editar | alternância entre lista e carrossel, navegação por teclado, indicador de posição |
| `apps/server/src/lib/ui-locales/*.ts` | editar | rótulos de navegação e posição nos 7 idiomas |
| `apps/server/src/pages/AggregateViewer.test.ts` | criar | ordem, limites e alternância de modo |

## Detail

### AS-IS

`AggregateViewer.tsx` busca `/api/public/projects/{id}` ou `/api/public/collections/{id}` sem cookie e renderiza cada sessão como card empilhado, com `Copy Markdown` chamando `/c/{id}.md`.

### TO-BE

- Modo galeria com um item em foco por vez, setas e indicador `n de N`.
- Ordem vinda do servidor, já governada por `reorderSessions`.
- Alternância lista ↔ galeria persistida por preferência local, como `pinar-history-view` já faz no workspace.
- `Copy Markdown` inalterado.

### Escopo

Apresentação. Nenhuma mudança de API, contrato público ou schema.

### Acceptance criteria

- [ ] `/c/{id}` navega item a item por clique e por teclado.
- [ ] Indicador de posição visível e anunciado por leitor de tela.
- [ ] Ordem idêntica à retornada pela API.
- [ ] `Copy Markdown` continua entregando o `.md` completo do agregado.
- [ ] Modo lista permanece disponível e sem regressão.
- [ ] Rótulos traduzidos nos 7 idiomas, com paridade de placeholders.

### Dependencies

Story 2 — sem lotes reais não há o que apresentar como percurso.

## Tasks

- [ ] Introduzir estado de modo (lista/galeria) com persistência local.
- [ ] Implementar navegação com setas e limites nas pontas.
- [ ] Adicionar indicador de posição com `aria-live` adequado.
- [ ] Adicionar chaves de UI nos 7 locales.
- [ ] Testar ordem, limites e alternância.

## Verification

```sh
bun --filter @pinar/server test
bun run typecheck
```

**Evidência manual:**
- Abrir `/c/{id}` de um lote de 3 páginas, navegar pelas setas e conferir a ordem.
- Alternar lista ↔ galeria e recarregar, confirmando a preferência.
- `Copy Markdown` produz o mesmo conteúdo de antes da mudança.
