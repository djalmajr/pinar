# Plano — Fair Source e Pinar Founder

## Contexto

O Pinar continuará com código público sob Fair Source e substituirá a oferta
pública Lifetime por Pinar Founder. A migração precisa preservar pagamentos,
eventos Stripe e linhas D1 que ainda usem `lifetime`, sem perpetuar promessas
absolutas como “forever” ou “never deleted”. A decisão canônica está registrada
no ai-memory em `decisions/fair-source-founder-model.md`.

O worktree já contém mudanças de outro fluxo em arquivos de servidor, UI e
testes. Cada fase abaixo limita a edição a no máximo cinco arquivos e deve
reler o diff antes de tocar em um arquivo modificado.

## Contratos

- Planos de conta: `free`, `pro`, `founder` e `lifetime` legado.
- Ofertas novas: `founder`, `pro_month`, `pro_year` e add-ons existentes.
- `lifetime_founder` permanece aceito somente em metadata/checkouts legados.
- Founder: 5 GB base e 500 créditos iniciais, sem recarga mensal.
- Capacidade Founder configurável; vagas vendidas e reservadas são verificadas
  no backend antes de criar Checkout.
- Ao encerrar a coorte, UI exibe estado encerrado, API retorna
  `founder_sold_out` e os preços Stripe são arquivados apenas por ação externa
  explicitamente autorizada.
- O modo local permanece utilizável sem aceite dos termos do serviço remoto.
- Termos e políticas têm versão; o Checkout pago exige aceite e a instalação
  remota registra a versão aceita.
- Português e inglês são as versões jurídicas publicadas inicialmente.

## Fases

### 1. Fundação de domínio

- `packages/shared/src/types/index.ts`
- `apps/server/src/lib/entitlements.ts`
- `apps/server/src/lib/entitlements.test.ts`
- `apps/server/src/lib/founder-capacity.ts`
- `apps/server/src/lib/founder-capacity.test.ts`

Adicionar `founder`, manter compatibilidade Lifetime e definir a máquina pura
de disponibilidade/reserva da coorte. Verificar com testes unitários e mutações
observáveis de limite, expiração e concorrência lógica.

### 2. Persistência compatível

- `apps/server/migrations/0005_founder_and_legal_acceptance.sql`
- `apps/server/migrations/0001_initial.test.ts`
- `apps/server/schema.sql`
- `apps/server/src/server/founder-capacity-store.ts`
- `apps/server/src/server/founder-capacity-store.test.ts`

Migrar checks sem perder `lifetime`, adicionar reservas/vendas Founder e aceite
legal versionado. A migração deve ser provada partindo do schema anterior e do
schema vazio canônico.

### 3. Checkout e fulfillment

- `apps/server/src/server/api.ts`
- `apps/server/src/server/cloud-api.ts`
- `apps/server/src/server/cloud-api.test.ts`
- `apps/server/src/server/stripe-subscription-state.ts`
- `scripts/stripe-test-catalog-smoke.mjs`

Reservar vaga, criar Checkout com aceite de termos, confirmar ou liberar a
reserva idempotentemente e preservar eventos `lifetime_founder`. Não modificar
Stripe live. O preço arquivado é defesa adicional, não fonte de verdade.

### 4. Catálogo e configuração

- `apps/server/src/lib/pricing.ts`
- `apps/server/src/lib/pricing.test.ts`
- `apps/server/wrangler.jsonc`
- `apps/server/src/pages/Pricing.tsx`
- `apps/server/src/lib/i18n.tsx`

Expor Founder, quantidade/estado configurável e remover promessas absolutas.
Não definir o limite de produção enquanto o valor inicial não for aprovado.

### 5. Documentos e navegação

- `apps/server/src/pages/LegalDocument.tsx`
- `apps/server/src/lib/legal-documents.ts`
- `apps/server/src/lib/legal-documents.test.ts`
- `apps/server/src/components/ServerFooter.tsx`
- rotas jurídicas, em lotes subsequentes de até cinco arquivos

Publicar Termos, Privacidade, Uso Aceitável, Retenção, Reembolsos, Fair Source
e Suboperadores com versão e data efetiva. A identidade legal permanece um
campo bloqueante para publicação final, nunca um placeholder silencioso.

### 6. Licença e documentação

- `LICENSE`
- `README.md`
- `CONTRIBUTING.md`
- `TRADEMARKS.md`
- `docs/product/pricing-entitlements.md`

Adotar o template canônico FSL-1.1-MIT após revisão jurídica e explicar com
precisão Fair Source, marca, serviço gerenciado e fronteira de contribuição.

### 7. Fluxos e regressões

- substituir `checkout-lifetime` por `checkout-founder` mantendo um cenário
  técnico de compatibilidade Lifetime;
- cobrir coorte aberta, última vaga, esgotamento, reserva abandonada, replay de
  webhook e preço arquivado como ação operacional;
- cobrir aceite jurídico, links do rodapé, retenção Pro/Founder e ausência de
  promessa “forever/open source” nas superfícies públicas;
- atualizar matriz de cobertura e relatórios históricos sem reescrever
  evidências antigas.

## Verificação

- `git diff --check`
- testes unitários de cada fase
- `bun run test`
- `bun run typecheck`
- `bun run build`
- `node scripts/audit-e2e-flow-coverage.mjs --write --strict`
- `bunx playwright test --project=chromium`
- smoke local completo
- smoke em staging somente após autorização de deploy

## Ações externas separadas

Não estão autorizados por este plano: alterar Stripe live, arquivar preços,
configurar URL de Termos no Dashboard, aplicar migração remota, fazer deploy,
commit, push ou publicar documentos com identidade jurídica incompleta.
