---
id: workspace-projeto-crud
name: Criar, renomear, compartilhar e excluir projeto
reference: apps/server/src/pages/HistoryDashboard.tsx; apps/server/src/components/HistorySidebar.tsx; apps/server/src/server/cloud-api.ts
persona: usuario-extensao
entry: "https://stg.pinar.dev/"
preconditions:
  - Workspace autenticado
---

## User goal

Organizar capturas em um projeto próprio e removê-lo sem perder sessões.

## Steps

1. No workspace, **abrir o seletor de projeto e clicar New project** → editor aparece.
2. **Escolher nome e ícone e salvar** → projeto aparece selecionado.
3. **Criar uma coleção/destino no projeto e capturar nela** → sessão pertence ao novo projeto; somente `Personal` possui o `Inbox` protegido.
4. **Abrir ações e renomear** → sidebar e cabeçalho atualizam.
5. **Alterar ícone** → glyph persistido aparece após reload.
6. **Clicar Share project** → link `/p/` é copiado/aberto.
7. **Abrir o agregado** → nome, coleções e sessão autênticos aparecem.
8. **Solicitar Delete project** → confirmação explica preservação/movimento.
9. **Confirmar** → projeto some e sessão é promovida para destino seguro.
10. **Recarregar** → projeto não volta e sessão continua acessível.

## Expected result

CRUD e compartilhamento persistem; exclusão do contêiner não destrói sessões.
