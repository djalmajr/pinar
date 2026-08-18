# Usabilidade — Compartilhar projeto

- **Persona:** visitante de um link não listado
- **Data:** 2026-08-18
- **Ambiente:** build local isolado, Chromium
- **Veredito:** ✅ hierarquia, cards, links, Markdown e coleção vazia convergem

## Walkthrough

1. Abri um projeto com duas coleções e confirmei nome e contagem total.
2. As seções **Review** e **Empty follow-up** mantiveram a ordem do workspace.
3. Os cards preservaram título, URL e contagens de um e dois pins.
4. Abri a segunda sessão, voltei pelo navegador e reencontrei a hierarquia intacta.
5. Copiei o Markdown pelo botão da página; coleções, sessões e links `/v/` permaneceram ordenados.
6. A coleção vazia continuou explícita no projeto com **No sessions in this collection.**

## Findings

Nenhuma brecha de produto foi reproduzida. Destinos externos não foram acessados e nenhum dado de outro projeto apareceu na fixture pública.

## Cobertura automatizada

- `tests/e2e/compartilhamento/aggregate-sharing.e2e.test.ts`: hierarquia e interação pública completa.
- `apps/server/src/server/cloud-api.test.ts`: isolamento e construção do agregado.
- `apps/server/src/server/markdown.test.ts`: ordem manual de coleções, sessões e pins.
