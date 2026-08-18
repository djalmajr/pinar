# Usabilidade — Preview, Markdown bruto e zoom do viewer

- **Persona:** visitante
- **Data:** 2026-08-18
- **Ambiente:** build local isolado, Chromium, WebKit, Firefox, iPhone 14 e Pixel 7
- **Veredito:** ✅ fluxo completo e recuperável

## Walkthrough

1. Abri `/v/viewer-e2e` com uma sessão pública contendo um pin de elemento e um pin de área.
2. No primeiro pin, confirmei comentário, seletor CSS, DOM path e coordenadas na aba **Preview**.
3. Alternei para **Raw** e confirmei que comentário, seletor e DOM path aparecem uma única vez no Markdown bruto.
4. Fechei o diálogo, abri o pin de área e validei tipo, dimensões e posição da seleção.
5. Abri o screenshot, aumentei até o limite de **800%**, arrastei a imagem e usei **Reset**.
6. Reduzi até o limite de **50%**, restaurei **100%** e fechei o zoom.
7. Ocultei e reabri a sidebar de pins; o screenshot permaneceu disponível durante todo o percurso.

## Findings

No mobile, a grade desktop de duas colunas comprimida reduzia o screenshot a uma faixa estreita. O viewer agora empilha screenshot e pins em duas linhas proporcionais no mobile, preservando a divisão lateral a partir de `md`. O cabeçalho também reduz espaçamento e mantém nomes acessíveis completos quando oculta textos visuais secundários.

As duas primeiras execuções desktop também expuseram seletores amplos do teste: uma busca encontrava os blocos `<code>` do Preview e do Raw ao mesmo tempo, e o texto do pin de área era dividido pelo Markdown renderizado. Ambos foram estreitados sem alterar o produto.

## Cobertura automatizada

- `tests/e2e/compartilhamento/viewer-pin-preview-raw-zoom.e2e.test.ts`: cobre sessão pública, clipboard/assistentes, Preview/Raw e zoom responsivo.
- Resultado final: **20/20 cenários aprovados** nos cinco projetos Playwright.
- A fidelidade visual entre o screenshot de fixture e uma captura produzida pela extensão real continua dependente do fluxo de captura no Chrome.
