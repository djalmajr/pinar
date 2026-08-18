# Usabilidade — Abrir o workspace sem sessão do Pinar

- **Persona:** skeptical
- **Data:** 2026-08-17
- **Entrada:** https://stg.pinar.dev/
- **Veredito:** ⚪ inconclusivo — perfil já possuía sessão Free/installation

## Walkthrough

1. Iniciei pela landing e identifiquei o CTA **Open dashboard**.
2. Cliquei no CTA sem digitar uma rota interna.
3. O Browser abriu `/app` diretamente e exibiu um workspace vazio com zero sessões, coleções e bloco de patrocínio.
4. Como o comportamento prova a existência de contexto Free/installation neste perfil, a precondição “cookies de sessão do Pinar ausentes” não estava satisfeita. Não forcei logout nem apaguei cookies durante o fluxo.

## Findings (priorizados)

Nenhum finding de produto confirmado. O resultado é compatível com uma sessão
Free existente e não pode ser usado para avaliar o redirecionamento anônimo.

## Key screens

- `screenshots/2026-08-17/publico-abrir-workspace-sem-sessao--01-landing.png`
- `screenshots/2026-08-17/publico-abrir-workspace-sem-sessao--02-sessao-free-existente.png`

## Cobertura automatizada

- `apps/server/src/routes/-routes.test.ts` prova o redirecionamento server-side sem principal.
- Manual-only pendente: repetir com perfil Browser realmente novo, separando eventual Cloudflare Access do redirecionamento do produto.
