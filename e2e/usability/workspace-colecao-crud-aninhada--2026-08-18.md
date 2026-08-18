# Usabilidade — CRUD de coleção aninhada

- **Data:** 2026-08-18
- **Ambiente:** build local, Chromium, WebKit, Firefox, iPhone 14 e Pixel 7; API stateful isolada
- **Veredito:** ✅ hierarquia, proteção e preservação convergem

Criei **Parent**, usei suas ações para criar **Child** já aninhada, renomeei para **Child review** e anexei uma sessão de fixture. Recolher Parent ocultou Child e expandir restaurou a árvore. O menu do Inbox protegido não ofereceu **Remove**. Excluir Parent promoveu Child à raiz; excluir Child moveu a sessão para `Personal / Inbox`, onde permaneceu após reload.

O primeiro controle de recolher/expandir dependia de acertar o ícone dentro do botão da coleção e não possuía nome nem operação por teclado. Ele foi separado do botão de seleção, recebeu nomes localizados **Collapse/Expand {coleção}**, `aria-expanded` e foco visível. O E2E agora recolhe e expande por teclado sem selecionar a coleção nem fechar o drawer móvel.

O fluxo passou **5/5** na matriz final e novamente **5/5** após o último ajuste visual. A sincronização do teste espera o fechamento observável dos diálogos após o `fetchTree` e reabre de forma limitada o Sheet quando a árvore o substitui. Além das três repetições anteriores no iPhone, cinco repetições consecutivas no Pixel 7 passaram após tornar as ações de menu atômicas.

Rejeição de ciclos, projeções de indent/outdent e subárvores estão cobertas por `collection-tree.test.ts`; o gesto de drag real permanece no fluxo independente `workspace-reordenar-arvore`.
