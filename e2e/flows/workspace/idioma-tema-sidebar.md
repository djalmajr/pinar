---
id: workspace-idioma-tema-sidebar
name: Persistir preferências e layout do workspace
reference: apps/server/src/components/AppShell.tsx; apps/server/src/components/HistorySidebar.tsx; apps/server/src/lib/i18n.tsx
persona: accessibility
entry: "https://stg.pinar.dev/"
preconditions:
  - Workspace autenticado com sessões
---

## User goal

Usar o workspace no idioma, contraste e largura de navegação confortáveis.

## Steps

1. **Abrir Language e selecionar Português** → header, sidebar e dashboard mudam juntos.
2. **Alternar tema** → conteúdo e controles mantêm contraste.
3. **Redimensionar sidebar** → painel respeita largura mínima e máxima.
4. **Abrir o painel do usuário no rodapé** → identidade, plano, saldo de créditos, uso/cota de armazenamento e ações reais aparecem à direita, seguindo o padrão `sidebar-08`.
5. **Colapsar sidebar** → ícones e gatilho do usuário continuam acessíveis.
6. **Expandir novamente** → largura útil é restaurada.
7. **Abrir uma sessão e voltar** → preferências permanecem.
8. **Recarregar workspace** → idioma e tema persistem.
9. Em viewport mobile, **abrir e fechar sidebar** → conteúdo não fica inacessível.

## Expected result

Preferências e navegação respondem sem layout shift impeditivo em desktop e mobile.
