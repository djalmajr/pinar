# Usabilidade — Compartilhar coleção

- **Persona:** visitante de um link não listado
- **Data:** 2026-08-18
- **Ambiente:** build local isolado, Chromium
- **Veredito:** ✅ ordem, navegação, Markdown e associação atual convergem

## Walkthrough

1. Abri uma coleção com três sessões e confirmei nome, contagem e ordem dos cards.
2. Abri o segundo card; o viewer exibiu a sessão correta e o retorno do navegador preservou o agregado.
3. Copiei o Markdown pelo botão da página e li o clipboard real do Chromium.
4. O conteúdo preservou a ordem das três sessões e não incluiu captura de conta estrangeira.
5. Simulei a movimentação da segunda sessão para outra coleção e recarreguei o link.
6. A contagem caiu para duas e somente a associação atual permaneceu visível.

## Findings

Nenhuma brecha de produto foi reproduzida. A atualização de membership foi simulada na superfície pública; isolamento, move e ownership continuam provados também pela integração da API.

## Cobertura automatizada

- `tests/e2e/compartilhamento/aggregate-sharing.e2e.test.ts`: agregado, viewer, back, clipboard e reload após mudança.
- `apps/server/src/server/cloud-api.test.ts`: membership e isolamento por owner.
- `apps/server/src/server/markdown.test.ts`: ordem e links vivos.
