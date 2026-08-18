# Usabilidade — CRUD de projeto

- **Data:** 2026-08-18
- **Ambiente:** build local, Chromium, API stateful isolada
- **Veredito:** ✅ criação, edição, compartilhamento e exclusão preservadora

Criei **Client portal** com ícone Rocket, anexei uma captura de fixture na coleção **Review**, renomeei para **Checkout redesign**, troquei para Telescope e confirmei a seleção após reload. **Share** copiou `/p/prj_client_portal`; o agregado exibiu projeto, coleção e sessão autênticos. A exclusão explicou a promoção para `Personal / Inbox`, removeu apenas o contêiner e preservou a sessão após novo reload.

## Finding corrigido

O projeto selecionado voltava para `Personal` em todo reload. A seleção agora é persistida e, quando o projeto é excluído, o fallback válido substitui automaticamente o id antigo.

O catálogo também foi corrigido: projetos comuns não possuem Inbox implícito; somente `Personal / Inbox` é protegido. Capturas de projeto usam uma coleção/destino explícito.

## Cobertura

- `tests/e2e/workspace/project-crud.e2e.test.ts`: fluxo público e privado completo.
- `apps/server/src/server/cloud-api.test.ts`: persistência, isolamento e promoção real da sessão.
