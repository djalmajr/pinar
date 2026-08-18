# Usabilidade — Múltiplos pins, edição, exclusão e ordem

- **Persona:** power-user
- **Data:** 2026-08-18
- **Ambiente:** Chromium local, scripts reais da extensão e fronteira `chrome.runtime` simulada
- **Veredito:** ✅ composição e ordem consistentes; captura real do Chrome ainda pendente

## Walkthrough

1. Injetei `coordinates.js`, `keyboard.js` e `content.js` numa página com quatro alvos distintos.
2. Criei três pins e confirmei numeração **1, 2, 3** e três cores distintas.
3. Abri o segundo pin, editei o comentário e reabri para provar a persistência visual.
4. Excluí o primeiro pin; os dois restantes foram renumerados para **1, 2** mantendo suas cores originais.
5. Abri um quarto rascunho e usei **Esc**; apenas o rascunho desapareceu.
6. Usei **Esc** novamente; os pins foram limpos e a extensão se ocultou.
7. Reativei a extensão, criei dois pins em nova ordem e usei **Ctrl+Enter**.
8. O bundle enviado ao runtime preservou a ordem dos comentários.
9. Normalizei esse mesmo payload no contrato público e confirmei pin 1 e pin 2 no viewer.

## Findings

Nenhuma brecha do produto foi reproduzida. A primeira execução chegou corretamente ao viewer, mas a fixture retornou `kind/anchor`, enquanto a UI pública valida `type/coords`; o mock foi corrigido para representar a normalização realizada pelo servidor.

## Cobertura automatizada

- `tests/e2e/extensao/multiple-pins.e2e.test.ts`: cobre criação, cores, edição, exclusão, duplo Esc, cópia e ordem no viewer.
- Resultado final: **1/1 teste aprovado**.
- `extension/crop.test.js` continua cobrindo colocação e desenho isolados dos marcadores.
- Pendente manual: executar `chrome.tabs.captureVisibleTab` numa extensão realmente carregada e inspecionar se os badges encobrem os alvos na imagem final.
