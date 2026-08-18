# Usabilidade — reordenar projetos e árvore de coleções

- **Data:** 2026-08-18
- **Ambiente:** build local, Chromium, WebKit, Firefox, iPhone 14 e Pixel 7; API stateful isolada
- **Veredito:** ✅ ordem, hierarquia, subárvore e proteção persistem

O seletor de projetos não oferecia nenhuma superfície para a rota já existente `POST /api/projects/reorder`. Acrescentei **Move earlier / Move later** ao menu de ações do projeto selecionado, movi **Beta** da terceira para a primeira posição e confirmei a ordem após reload.

Na árvore de **Alpha**, exercitei o ponteiro real do `dnd-kit`: movi **Root C** acima de **Root A**, aninhei e desaninhei **Root B** por deslocamento horizontal e movi **Root A** junto com **Child A**. As posições e profundidades permaneceram após reload. A tentativa de arrastar o **Inbox** protegido não emitiu requisição nem alterou sua posição.

As ações de projeto são deliberadamente explícitas e acessíveis por teclado; o drag permanece onde a profundidade horizontal da árvore comunica uma relação pai/filho.

No mobile, o mesmo `KeyboardSensor` é exercitado com **Space**, setas e **Space** novamente. O teste confirma `aria-pressed=true` durante o arraste e sua remoção no drop, em vez de inferir o estado por tempo ou CSS. Foram **6/6** repetições focadas em iPhone/Android e **5/5** na matriz final. O desktop continua cobrindo indentação, desindentação e movimento de subárvore por ponteiro real.
