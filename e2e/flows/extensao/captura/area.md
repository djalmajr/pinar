---
id: captura-area
name: Anotar uma região livre
reference: extension/content.js; extension/crop.js; extension/coordinates.js
persona: usuario-extensao
entry: "https://stg.pinar.dev/"
preconditions:
  - Extensão carregada no Chrome
---

## User goal

Marcar uma área que não corresponde a um único elemento DOM.

## Steps

1. Na landing, **ativar a extensão** → camada de seleção aparece.
2. **Arrastar sobre parte do herói** → retângulo de área e composer aparecem.
3. **Escrever comentário e salvar** → pin de área fica visível.
4. **Redimensionar/rolar a página** → marca permanece alinhada à região.
5. **Copiar a sessão** → crop inclui a área completa e seu contorno.
6. **Abrir o viewer** → card identifica seleção de área, não elemento.
7. **Conferir Markdown** → coordenadas e tipo de área são preservados.

## Expected result

A seleção livre mantém geometria, comentário e tipo em screenshot e viewer.
