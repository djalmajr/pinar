# Visibilidade de créditos de IA na conta

## Contexto

O rodapé da sidebar já concentra identidade, plano, saldo de créditos, uso de armazenamento e o acesso real ao Customer Portal. O backend também já persiste `ai_credit_refill_at` e aplica a reposição mensal de 200 créditos para assinaturas Pro ativas, mas o contrato de `/api/account/entitlements` não expõe essa data. O mesmo contrato já calcula o próximo vencimento de créditos e de add-ons de armazenamento, porém o menu só mostra o vencimento dos créditos.

A mudança preservará `/api/account/entitlements` como fonte única e manterá o menu existente, sem criar uma nova tela de conta.

Após a revisão visual, o escopo também distingue o helper local da aplicação hospedada: o helper continua estritamente local/Free; a interface remota passa a ser validada em um runtime Cloudflare local com D1/R2 isolados e, separadamente, no ambiente `stg.pinar.dev`.

## Arquivos

- `apps/server/src/server/cloud-api.test.ts:1764` — provar a data de próxima reposição no ciclo anual Pro, antes e depois da renovação mensal.
- `apps/server/src/server/cloud-api.ts:3579` — devolver `aiCredits.nextRefillAt` depois de reconciliar a reposição mensal; `null` para planos sem reposição.
- `apps/server/src/lib/account-menu.test.ts:31` — validar o contrato de datas e rejeitar payloads inválidos.
- `apps/server/src/lib/account-menu.ts:10` — incorporar próxima reposição e próximo vencimento de armazenamento ao resumo tipado.
- `apps/server/src/lib/i18n.tsx:38` — adicionar textos localizados para reposição mensal e vencimento de armazenamento, preservando ordem alfabética das chaves.
- `apps/server/src/components/AppAccountMenu.tsx:133` — mostrar saldo, próxima reposição mensal e vencimentos aplicáveis no painel de uso.
- `tests/e2e/workspace/account-menu.e2e.test.ts:21` — validar visualmente o estado Pro, as datas e a ação Billing já existente.
- `apps/server/scripts/cloud-local.mjs` — aplicar migrações e semear contas pagas no D1 local, autenticadas pelo fluxo real de código da extensão.
- `playwright.cloud.config.ts` e `tests/e2e/cloud/account-menu-cloud.e2e.test.ts` — executar o Worker local com bindings isolados e provar o contrato real sem mocks.
- `docs/local-cloud-development.md` — registrar a separação entre helper local, runtime cloud local e staging.

## Detalhes

- Exibir “Próxima reposição mensal” somente quando o backend fornecer `nextRefillAt`, isto é, para uma assinatura Pro ativa com ciclo de créditos vigente.
- Continuar mostrando o vencimento mais próximo de créditos quando houver grant expirável.
- Mostrar o vencimento mais próximo de armazenamento somente quando houver add-on ativo com expiração.
- Formatar todas as datas em UTC para evitar o deslocamento de um dia em fusos como `America/Maceio`.
- Manter Founder/Lifetime sem promessa de reposição mensal.
- Manter `Billing` ligado ao `POST /api/stripe/portal`; o E2E Pro comprovará que os dados de assinatura e a ação convivem no mesmo menu.
- Manter o badge do plano no cabeçalho de identidade, alinhado no canto superior direito, sem repetir um bloco “Plano” na área de uso.
- Usar ícones semânticos para reposição e vencimentos, sem bullets coloridos que dependam de interpretação implícita.
- Não simular Pro em `api.local.ts`; o runtime cloud local usa o mesmo Worker, as mesmas migrações e o mesmo contrato de autenticação da versão hospedada.
- Manter D1/R2 locais sem `remote: true`; staging permanece o gate do ciclo Stripe/Email real e não é alterado sem deploy autorizado.

## Tarefas

- [x] Red: ampliar a regressão do ciclo anual Pro para exigir `nextRefillAt`.
- [x] Red: ampliar o parser e o E2E para exigir reposição e vencimentos.
- [x] Green: estender o contrato do endpoint sem duplicar estado.
- [x] Green: renderizar as datas aplicáveis com textos localizados.
- [x] Refactor: manter o parser estrito e a composição do menu legível.
- [x] Executar mutation check manual das novas asserções removendo temporariamente cada campo produzido.
- [x] Executar testes focados, typecheck, suíte completa e `git diff --check`.
- [x] Executar o E2E de `account-menu` no fluxo Pro/Billing.
- [x] Capturar o handoff no ai-memory com resultado factual e pendências.
- [x] Reorganizar o menu conforme as anotações visuais: badge na identidade, cards separados e ícones semânticos.
- [x] Corrigir a fixture visual de armazenamento para diferenciar uso de quota e manter add-on/expiração consistentes.
- [x] Implementar o runtime cloud local isolado com migrações, fixture Pro e login pelo código da extensão.
- [x] Executar o E2E de integração do runtime cloud local.
- [x] Inspecionar `stg.pinar.dev` no Browser e registrar o limite entre estado implantado e alterações locais.
- [x] Atualizar o handoff no ai-memory após a validação final desta rodada.

## Verificação

- `bun test apps/server/src/lib/account-menu.test.ts apps/server/src/server/cloud-api.test.ts`
- `bun --filter @pinar/server typecheck`
- `bun test apps/server/src`
- `bun run typecheck`
- `bun test`
- `bun run build:local && bun run build:ext && bunx playwright test tests/e2e/workspace/account-menu.e2e.test.ts`
- `bun test apps/server/scripts/cloud-local.test.mjs`
- `bun run test:e2e:cloud`
- `git diff --check`

O projeto não declara um script de lint separado; a formatação e os diagnósticos disponíveis serão cobertos pelo typecheck, pelos testes e por `git diff --check`, e essa ausência será registrada no fechamento.
