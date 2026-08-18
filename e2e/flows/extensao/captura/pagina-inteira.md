---
id: captura-pagina-inteira
name: Produzir screenshot além do viewport
reference: extension/full-page.js; extension/background.js; extension/crop.js
persona: power-user
entry: "https://stg.pinar.dev/pricing"
preconditions:
  - Extensão carregada no Chrome
  - Página maior que um viewport
---

## User goal

Capturar pins distantes verticalmente em uma única evidência coerente.

## Steps

1. No topo de Plans, **ativar extensão e marcar o card Pro** → primeiro pin é salvo.
2. **Rolar até adicionais e marcar +20 GB** → segundo pin fica fora do viewport inicial.
3. **Copiar a sessão** → extensão planeja frames necessários.
4. **Aguardar captura e restauração** → scroll volta ao ponto esperado.
5. **Abrir screenshot gerado** → ambos os pins e áreas aparecem.
6. **Conferir junções** → não há faixas duplicadas ou lacunas.
7. **Conferir posição dos badges** → coordenadas foram deslocadas para a origem do crop.
8. **Abrir viewer** → screenshot completo permanece navegável e ampliável.

## Expected result

Captura full-page reúne alvos distantes sem corromper geometria ou scroll.
