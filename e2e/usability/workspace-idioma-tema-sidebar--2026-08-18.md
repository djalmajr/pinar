# Usabilidade — Idioma, tema e sidebar do workspace

- **Persona:** accessibility
- **Data:** 2026-08-18
- **Ambiente:** build local isolado, Chromium desktop e mobile
- **Veredito:** ✅ preferências e navegação essenciais preservadas

## Walkthrough

1. Mudei o workspace de English para Português e confirmei a tradução do estado vazio.
2. Ativei tema escuro, recarreguei e confirmei idioma e `data-theme=dark` persistidos.
3. No desktop, colapsei a sidebar de aproximadamente 250 px para menos de 60 px.
4. O gatilho do painel de usuário permaneceu visível no rodapé; abri **Assinar o Pro** no menu Free seguindo o padrão `sidebar-08`.
5. Expandi novamente e a largura útil voltou para mais de 190 px.
6. Em 390 × 844, abri a sidebar, confirmei Inbox e painel do usuário, fechei menu + sidebar com Escape e recuperei o conteúdo do workspace.
7. Arrastei o resizer até os limites reais de 448 px e 192 px; ambos foram respeitados sem cobrir o conteúdo.
8. Abri uma sessão, confirmei Português e tema escuro no viewer, voltei ao workspace e recarreguei sem perder as preferências.

## Findings

| # | Severity | Step | What happened | Disposition |
|---|---|---|---|---|
| 1 | test | 2 | O primeiro teste apagava `localStorage` em todo reload e simulava uma falsa perda de idioma. | Fixture corrigido para limpar uma vez por aba; produto persistiu corretamente. |
| 2 | test | 3 | O gesto de ponteiro atingiu os limites configurados de 12rem e 28rem. | Protegido por E2E com tolerância de 1 px. |
| 3 | test | 7 | Viewer → voltar → reload preservou `lang=pt` e `data-theme=dark`. | Protegido por fixture com sessão autêntica. |
| 4 | test | 9 | A regressão do painel procurava o rodapé antes de abrir o drawer móvel e gerava seis falsos negativos. | Helper passou a abrir **Collections** somente quando a sidebar móvel ainda não está montada; 15/15 cenários passaram nos cinco projetos. |

## Cobertura automatizada

- `tests/e2e/workspace/empty-state.e2e.test.ts`: idioma, tema, reload, collapse/expand, painel Free e sidebar mobile.
- `tests/e2e/workspace/account-menu.e2e.test.ts`: painel pago, Free e logout no desktop e no drawer móvel; 15/15 em Chromium, WebKit, Firefox, iPhone e Android.
- `tests/e2e/workspace/layout-preferences.e2e.test.ts`: limites do resizer e sessão → voltar → reload.
- Pendente em staging: comparação visual após deploy autorizado.
