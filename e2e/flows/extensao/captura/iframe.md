---
id: captura-iframe
name: Capturar contexto dentro de iframe
reference: extension/content.js; extension/background.js; extension/session.js
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Página de fixture contém iframe same-origin anotável e iframe inacessível
  - Extensão carregada no Chrome
---

## User goal

Anotar conteúdo incorporado sem perder o contexto da página principal.

## Steps

1. Na fixture, **ativar a extensão** → overlays alcançam top frame e iframe permitido.
2. **Selecionar elemento dentro do iframe permitido** → composer fica associado ao frame correto.
3. **Salvar comentário** → pin aparece dentro do iframe.
4. **Adicionar pin no top frame** → ambos convivem na mesma sessão.
5. **Copiar a sessão** → captura reúne as duas referências sem abortar.
6. **Conferir bundle** → cada pin mantém frame, seletor e caminho próprios.
7. **Abrir viewer** → ambos aparecem na ordem criada.
8. **Repetir com iframe inacessível presente** → frame bloqueado não impede os demais pins.

## Expected result

Frames acessíveis são anotados e frames bloqueados degradam sem perder a sessão.
