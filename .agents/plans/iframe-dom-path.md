# Caminho DOM através de iframes

## Contexto

Pins criados dentro de um iframe registram apenas o caminho do elemento no documento interno. O Markdown resultante não informa como atravessar os iframes desde o documento principal.

## Arquivos

- `tests/e2e/extensao/multiple-pins.e2e.test.ts`
- `extension/frame-path.js`
- `extension/frame-path.test.js`
- `extension/content.js`
- `extension/background.js`

## Detalhes

- Representar cada limite de iframe com o marcador técnico `::frame::`.
- Preservar o comportamento atual nas páginas sem iframe.
- Resolver recursivamente a cadeia para suportar iframes aninhados e de outra origem.
- Manter o seletor CSS como seletor local do documento alvo; somente o caminho DOM passa a carregar a cadeia completa.

## Tarefas

- [x] Red: adicionar uma regressão E2E que cria um pin dentro de um iframe e exige o caminho externo + interno.
- [x] Green: coletar os caminhos dos elementos `iframe` em cada documento ancestral.
- [x] Refactor: extrair a composição do caminho para uma função pura coberta por teste unitário.
- [x] Verificar extensão, tipos, lint aplicável e suíte relacionada.

## Verificação

- O teste falha antes da implementação porque o caminho começa em `body` do iframe interno.
- O teste passa com um caminho no formato `<iframe externo> ::frame:: <elemento interno>`.
- Um pin no documento principal continua sem o marcador `::frame::`.
