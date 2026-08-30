# Usabilidade — mover, ordenar e excluir sessões

- **Data:** 2026-08-18
- **Ambiente:** build local, Chromium, WebKit, Firefox, iPhone 14 e Pixel 7; API stateful isolada
- **Veredito:** ✅ fluxo preciso, persistente e sem crash de menu

Movi uma captura de **Collection A** para **Collection B**, ordenei-a duas posições para cima com as ações acessíveis **Move earlier**, recarreguei a página e confirmei a persistência. Em seguida, abri o viewer, copiei o prompt, cancelei uma exclusão e então confirmei a remoção da sessão correta; o link público antigo passou a responder com estado indisponível.

O primeiro exercício revelou uma falha real: os rótulos **Move to collection** e **Order** estavam fora de `DropdownMenuGroup`, o que fazia a Base UI lançar o erro #31 e substituir o workspace por **Something went wrong** ao abrir o menu. A composição foi corrigida e o E2E agora protege o fluxo completo.

Na matriz completa, menus fechados preservados no DOM pelo Base UI expuseram um seletor amplo e ambíguo no iPhone. A regressão foi estreitada ao menu com `data-open`; o produto já apresentava uma única ação visível. O fluxo terminou **5/5** na matriz final.

O fluxo usa ações **Move earlier / Move later** em vez de drag-and-drop para reordenar dentro da coleção. Organizar para pastas também cobre drag da listagem para a árvore e seleção em lote (mover/excluir). O gesto de drag da árvore de coleções permanece no fluxo independente `workspace-reordenar-arvore`.
