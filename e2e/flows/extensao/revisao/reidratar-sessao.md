---
id: extensao-reidratar-sessao
name: Reabrir a URL original e reidratar pins
reference: extension/content.js; extension/background.js; extension/session.js; extension/app-bridge.js; apps/server/src/pages/WebViewer.tsx
persona: revisor
entry: "https://stg.pinar.dev/v/:id"
preconditions:
  - Sessão persistida com pins e estados de revisão
  - Extensão Pinar carregada no Chrome
---

## User goal

Revisar uma correção no contexto original, com confiança de localização explícita.

## Steps

1. No viewer ou no workspace, **Revisar na página** → a extensão abre somente a sessão escolhida na URL original.
2. **Conferir cada pin** → estado de revisão e confiança `exact`, `probable`, `ambiguous` ou `unresolved`.
3. **Pins ambíguos** → ficam pendentes e não são posicionados como se fossem exatos.
4. **Reposicionar manualmente** → a âncora histórica (seletor, caminho, geometria original) permanece.
5. **Página indisponível ou origem diferente** → overlays não vazam a sessão; o revisor vê o estado indisponível.
6. **Iframe same-origin** → o pin reidrata no frame correto.

## Expected result

A aba de destino recebe só a sessão autorizada, com confiança visível e âncora histórica preservada.
