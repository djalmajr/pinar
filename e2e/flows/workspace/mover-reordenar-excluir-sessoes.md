---
id: workspace-mover-reordenar-excluir-sessoes
name: Organizar e remover sessões
reference: apps/server/src/pages/HistoryDashboard.tsx; apps/server/src/server/cloud-api.ts
persona: power-user
entry: "https://stg.pinar.dev/"
preconditions:
  - Duas coleções E2E com três sessões
---

## User goal

Mover e ordenar capturas e excluir somente a sessão escolhida.

## Steps

1. Na coleção A, **abrir ações da primeira sessão** → destinos disponíveis aparecem.
2. **Mover para coleção B** → sessão sai de A e aparece em B.
3. Em B, usar **Move earlier / Move later** nas ações da sessão → ordem visual muda de forma acessível.
4. **Recarregar B** → ordem persiste.
5. **Abrir View da sessão movida** → dados continuam completos.
6. **Voltar e copiar Markdown** → conteúdo corresponde à sessão.
7. **Abrir Delete na segunda sessão** → diálogo nomeia impacto.
8. **Cancelar** → sessão permanece.
9. **Excluir e confirmar** → somente sessão escolhida some.
10. **Abrir link público antigo** → recurso removido não expõe conteúdo.

## Expected result

Movimento e ordem persistem; exclusão é confirmada, precisa e revoga acesso público.
