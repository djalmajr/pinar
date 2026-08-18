# Usabilidade — Detectar e alternar idioma e tema nas páginas públicas

- **Persona:** accessibility
- **Data:** 2026-08-17
- **Entrada:** https://stg.pinar.dev/
- **Veredito:** ✅ completável

## Walkthrough

1. O perfil do Browser já tinha English salvo de uma ação anterior; por isso esta rodada não afirma o estado de primeira visita.
2. Abri **Language** e selecionei Português; cabeçalho, herói, cards e rodapé mudaram juntos.
3. Voltei a English pelo mesmo menu.
4. Alterei o tema pelo botão do cabeçalho e mantive contraste legível.
5. Naveguei para **Plans** e idioma/tema permaneceram aplicados.
6. Recarreguei a página; o tema salvo continuou ativo.
7. Voltei a **Home** pela navegação pública.

## Findings (priorizados)

Nenhum finding na alternância/persistência. A autodetecção de primeira visita
permanece pendente de perfil Browser limpo e recebe regressão Playwright dedicada.

## Key screens

- `screenshots/2026-08-17/publico-alternar-idioma-tema--01-portugues.png`
- `screenshots/2026-08-17/publico-alternar-idioma-tema--02-tema.png`
- `screenshots/2026-08-17/publico-alternar-idioma-tema--03-reload.png`

## Cobertura automatizada

- Automatizado: locale novo `pt-BR` inicia em português e escolha manual em English persiste.
- Manual-only: contraste percebido e ausência de flash de tema incorreto.
