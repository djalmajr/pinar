# Remover Founder e concentrar a oferta em Free e Pro

## Contexto
Pedido autorizado em 14/09/2026: planejar e implementar na branch atual `feat/ai-features-dja-167-174`, junto às melhorias em andamento. O proprietário informa que não há assinantes. Remover a oferta de acesso sem assinatura; preservar Pro mensal/anual com 5 GB, 200 créditos mensais e adicionais de créditos/armazenamento.

## Rastreabilidade
- Telas: `/pricing`, conta, ajuda e políticas; fixtures da extensão.
- Regras: `apps/server/src/lib/entitlements.ts`, `apps/server/src/server/cloud-api.ts`, `apps/server/src/server/stripe-subscription-state.ts`.
- Referência: `docs/plans/stripe-entitlements-credits-storage.md`.

## Arquivos
| Caminho | Ação e finalidade |
|---|---|
| `packages/shared/src/types/index.ts` | Restringir planos a Free/Pro |
| `apps/server/src/lib/entitlements.ts` | Retirar oferta, aliases e bônus Founder; manter benefícios Pro |
| `apps/server/src/lib/pricing.ts` | Remover preço e disponibilidade Founder do contrato |
| `apps/server/src/server/cloud-api.ts` | Remover reservas e fulfillment Founder; rejeitar ofertas retiradas |
| `apps/server/src/server/stripe-subscription-state.ts` | Acesso pago dependente de assinatura |
| `apps/server/src/server/api.ts` | Remover configuração Founder |
| `apps/server/src/pages/Pricing.tsx` | Exibir Free e Pro |
| `apps/server/src/lib/auth-session.ts` | Rejeitar planos removidos |
| `apps/server/src/lib/account-menu.ts` | Remover normalização Lifetime/Founder |
| `apps/server/src/components/AppAccountMenu.tsx` | Remover rótulo Founder |
| `apps/server/src/lib/legal-documents.ts` | Atualizar oferta descrita nas políticas |
| `apps/server/schema.sql` | Contrato final sem Founder |
| `apps/server/migrations/0017_remove_founder.sql` | Migrar estrutura preservando dados Free/Pro e recursos de IA recentes |
| `apps/server/wrangler.jsonc` | Remover preços e capacidade em todos os ambientes |
| `apps/server/scripts/cloud-local.mjs` | Manter fixtures Free/Pro |
| `apps/extension/src/options/account-tab-states.ts` | Retirar fixture Founder |

Também ajustar traduções, testes e documentos operacionais referenciados por esses arquivos. Preservar migrações antigas, notas de versões e evidências históricas.

## Detalhamento
Estado atual: Founder atravessa catálogo, permissões, reservas, banco e interface. Estado final: somente Free/Pro; pagamento avulso apenas para adicionais. Nenhuma conversão de compra única em assinatura fictícia.

Migração: verificar ausência de contas/compras/créditos Founder antes de remover estruturas; falhar explicitamente se a premissa não for verdadeira. Não excluir clientes ou histórico financeiro silenciosamente. Nenhuma migração remota ou release nesta entrega; a mudança segue na branch atual.

## Plano de testes
Primeiro teste: aliases Founder/Lifetime devem ser recusados em vez de virar checkout Pro. Cobrir API pública sem Founder, webhooks sem concessão de plano para ofertas removidas, Pro com 5 GB/200 créditos, cancelamento e adicionais. Validar migração sobre banco anterior com dados e novas features de IA. Evitar testes que apenas verificam texto de implementação.

## Tarefas
- [x] Mapear impacto e estado da branch.
- [x] Registrar teste que falha para ofertas removidas; falhou antes e passou após a implementação.
- [x] Remover lógica, configuração e interface Founder.
- [x] Criar e verificar migração incremental.
- [x] Ajustar traduções, fixtures, testes e documentação atual.
- [x] Rodar testes, typecheck e builds pertinentes; resultados abaixo.
- [x] Reinstalar tray/helper e verificar `/api/health`; reconstruir extensão.
- [ ] Recarregar a extensão instalada no Brave: acesso ao gerenciador bloqueado pela política da ferramenta; exige ação manual do usuário.
- [x] Revisar diff e registrar evidências finais.

## Verificação e aceite
- [x] `bun run test` executado: não ficou verde; detalhes abaixo.
- [x] `bun run typecheck`: passou.
- [x] E2E local de planos e patrocínio Free/Pro, incluindo mobile.
- [x] `bun run build:local`, `bun run build:tray`, instalação local e health.
- [x] `bun run build:ext`.
- [ ] Reload explícito da extensão: bloqueado pela política de acesso a URLs internas do navegador.
- [x] Free/Pro e adicionais preservados nos testes da API; Founder e aliases não concedem acesso.

Não há script lint no projeto. `git diff --check` passou.

## Resultado e evidências — 14/09/2026

- 117 testes focados passaram: catálogo, checkout e fulfillment, benefícios, contratos de autenticação/conta, políticas, ajuda, configuração, catálogo E2E, fixtures e migrações. Arquivos: `apps/server/src/lib/{pricing,retired-offers,entitlements,auth-session,account-menu,legal-documents,help-content,e2e-flow-catalog,deployment-config}.test.ts`, `apps/server/src/server/cloud-api.test.ts`, `apps/server/migrations`, `apps/server/scripts/cloud-local.test.mjs`, `apps/extension/src/options/account-tab-states.test.ts`.
- 29 testes das novas funcionalidades de IA passaram com `bun test apps/server/src/server/ai apps/server/tests`.
- `bunx playwright test --config playwright.cloud.config.ts tests/e2e/publico/pricing.e2e.test.ts`: 6/6. A preparação desse runtime aplicou a migração 0017 no D1 **local** com sucesso.
- Exploração adicional usando configuração temporária: patrocínio Free/Pro passou em Chromium desktop e Pixel 7 (4/4), planos passaram novamente e o teste de rodapé legal passou. Os testes antigos do painel com mocks não alcançaram o workspace autenticado; o teste de navegação entre abas legais não mudou a URL; o teste real da conta cloud excedeu o tempo no acesso à conta. Esses cenários não estão certificados por esta entrega.
- `bun run test`: a etapa Node passou 228/228; a etapa seguinte teve 158 aprovados, 2 ignorados e 4 falhas: expectativa desatualizada de ausência de migrações no workflow, dois testes macOS dependentes de `/usr/libexec/PlistBuddy` e um teste de atualização GitHub. Essa interrupção impede a etapa server do comando raiz. Uma execução separada do server também apresentou problemas de limpeza de SQLite no Windows, permissões POSIX e notas de release, fora dos testes focados aprovados. Não foram alterados esses componentes para mascarar falhas.
- Build Worker executado com `CLOUDFLARE_ENV=staging`; artefato validado como `name: pinar-stg`, `targetEnvironment: staging`. Nenhum deploy, tag ou migração remota.
- Capturas reais da página de planos e da política de retenção atualizadas nos sete idiomas. Inspeção visual de PT/EN confirmou Free/Pro e ausência da seção Founder.
- Políticas revisadas com versão `2026-09-14`; novo aceite é exigido pelo mecanismo existente.
- Tray e helper reinstalados em `%LOCALAPPDATA%/Programs/Pinar` e `%USERPROFILE%/.pinar`. O instalador encontrou `EBUSY` ao remover a pasta do aplicativo; os arquivos foram substituídos mantendo a pasta bloqueada. O arquivo de pareamento local foi preservado, sem exibir seu conteúdo.
- Health final: `http://127.0.0.1:17373/api/health` → `{"ok":true,"runtime":"local","service":"pinar","version":"0.3.7-rc.1"}`. SHA-256 do entrypoint instalado e do build iguais: `3920749A4D92E0C77D15FB45BF174F4F579476CE46286FDB57E32CD9E3712DDD`.
- Extensão compilada. A ferramenta rejeitou abrir `brave://extensions/` por política de segurança; não houve tentativa de contorno. Recarregar manualmente a extensão unpacked antes de considerar sua atualização ativa.

Logs completos da execução ficam fora do repositório, em `C:/Users/dj4lm/.codex/visualizations/2026/09/14/01a0a064-1053-7083-8a58-33bd3b347d16/founder-validation/`. A branch permanece `feat/ai-features-dja-167-174`, sem commit, push ou release desta mudança.
