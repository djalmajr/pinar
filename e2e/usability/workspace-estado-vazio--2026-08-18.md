# Usabilidade — Primeiro estado vazio do workspace

- **Persona:** novice
- **Data:** 2026-08-18
- **Ambiente:** build local isolado, Chromium
- **Veredito:** ✅ orientação e navegação recuperáveis após correção

## Walkthrough

1. Abri `/app` como instalação Free com projeto protegido **Personal**, coleção protegida **Inbox** e zero sessões.
2. O skeleton terminou e apareceu **No annotation sessions found**, explicando que novas capturas vêm da extensão.
3. Confirmei **Personal**, **All sessions** e **Inbox** com contagens zeradas.
4. Alternei de grade para tabela. Antes da correção, o seletor desapareceu e não era possível voltar à grade.
5. Mantive o toolbar também no vazio da tabela e retornei à grade.
6. O estado vazio descreve o uso da extensão, sem CTA de configuração no workspace.

## Findings

| # | Severity | Step | What happened | Fix |
|---|---|---|---|---|
| 1 | major | 4 | Tabela vazia escondia o único seletor de visualização, prendendo o usuário nesse modo. | Mostrar o toolbar quando não há sessões em qualquer modo. |
| 2 | major | 6 | A descrição citava a extensão, mas não havia próximo passo acionável. | CTA para `#load-the-extension` no guia oficial do repositório. |

## Cobertura automatizada

- `tests/e2e/workspace/empty-state.e2e.test.ts`: árvore protegida, fim do loading, grade ↔ tabela e estado vazio sem CTA de extensão.
- O teste falhou primeiro ao aguardar **Grid view** após entrar na tabela e passou depois da correção.
- A comparação visual em staging permanece uma validação pós-deploy, não um gap funcional local.
