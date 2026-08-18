---
id: workspace-buscar-filtrar-alternar-visao
name: Buscar, filtrar pins e alternar grade ou tabela
reference: apps/server/src/pages/HistoryDashboard.tsx; apps/server/src/server/cloud-api.ts
persona: usuario-extensao
entry: "https://stg.pinar.dev/"
preconditions:
  - Sessões E2E com títulos, URLs, comentários e quantidades de pins distintas
---

## User goal

Encontrar rapidamente uma captura antiga pelo dado que lembro.

## Steps

1. No workspace, **digitar parte do título na busca** → somente sessão correspondente aparece.
2. **Buscar trecho da URL** → resultado muda para a página correta.
3. **Buscar trecho do comentário de pin** → sessão correspondente aparece.
4. **Limpar busca** → todas as sessões retornam.
5. **Abrir filtro Pins e selecionar uma quantidade** → lista respeita o filtro.
6. **Combinar busca e filtro** → interseção é aplicada.
7. **Limpar filtro pelo menu** → badge/contador volta ao estado vazio.
8. **Alternar para Table view** → mesmos dados aparecem em tabela.
9. **Voltar a Grid view** → seleção atual e contagens permanecem.

## Expected result

Busca cobre título, URL e comentários; filtros e views não alteram os dados.
