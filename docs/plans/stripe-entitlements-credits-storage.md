# Stripe, créditos de IA e armazenamento

## Contexto

O catálogo de produção já existe na conta Stripe do Pinar, mas o servidor ainda usa IDs e valores antigos, trata todo pagamento único como Lifetime e não possui ledger idempotente, cotas ou validade dos add-ons.

Esta entrega conecta o catálogo aprovado ao app sem fazer deploy ou aplicar migrações remotamente. A primeira funcionalidade de IA e o modelo usado continuam como uma decisão de produto separada; aqui fica pronta a medição de créditos que ela consumirá.

## Contratos

- Ofertas: `pro_month`, `pro_year`, `lifetime_founder`, `ai_credits_1000`, `storage_5gb_12m` e `storage_20gb_12m`.
- Preços fixos: Pro US$ 2,99/mês ou US$ 19/ano; Lifetime US$ 39; add-ons US$ 2,99, US$ 2,99 e US$ 7,99. No Brasil: R$ 4,90/mês ou R$ 39,90/ano; Lifetime R$ 129,90; add-ons R$ 9,90, R$ 9,90 e R$ 29,90.
- Free: 250 MB de nuvem e 5 créditos iniciais por instalação.
- Pro: 5 GB e 200 créditos por mês, sem acúmulo; a recarga mensal independe do intervalo de cobrança.
- Lifetime: 5 GB e 500 créditos iniciais, sem recarga mensal.
- Pacote de IA: 1.000 créditos válidos por 12 meses.
- Armazenamento: +5 GB ou +20 GB por 12 meses; pacotes acumulam.
- Ao exceder a cota vigente, novos uploads são bloqueados antes da escrita no R2. O estado de expiração informa carência e recuperação, sem exclusão automática nesta entrega.
- Checkout e fulfillment usam identificadores idempotentes; webhooks inválidos ou eventos sem ID não alteram estado.

## Arquivos

### Catálogo e apresentação

- `apps/server/src/lib/pricing.ts`
- `apps/server/src/lib/pricing.test.ts`
- `apps/server/src/lib/entitlements.ts`
- `apps/server/src/lib/entitlements.test.ts`
- `apps/server/src/pages/Pricing.tsx`
- `apps/server/src/pages/Success.tsx`
- `apps/server/src/lib/i18n.tsx`
- `apps/server/wrangler.jsonc`

### Persistência e regras

- `apps/server/schema.sql`
- `apps/server/migrations/0001_initial.sql`
- `apps/server/migrations/0001_initial.test.ts`
- `apps/server/src/server/cloud-api.ts`
- `apps/server/src/server/cloud-api.test.ts`
- `apps/server/src/server/api.local.test.ts`
- `apps/server/src/worker-entry.ts`
- `README.md`

## Etapas

1. Substituir o cálculo cambial pelos valores finais explícitos e expor os três add-ons na API pública.
2. Atualizar os IDs de Price e permitir Checkout por oferta, com metadata e `Idempotency-Key`.
3. Adicionar tabelas de eventos Stripe, grants de créditos e grants de armazenamento, além da âncora de recarga mensal.
4. Tornar `checkout.session.completed` idempotente e diferenciar plano vitalício de add-ons; manter assinaturas sincronizadas por webhook.
5. Conceder créditos iniciais/mensais/comprados e calcular saldo por validade; a futura chamada server-side de IA consumirá os créditos incluídos antes dos comprados.
6. Calcular uso e cota, expor `/api/account/entitlements` e bloquear upload acima da cota antes do R2.
7. Atualizar a tela de preços/sucesso e cobrir os contratos com testes.

## Verificação

- `git diff --check`
- `bun run test`
- `WRANGLER_LOG_PATH=/private/tmp/pinar-wrangler-typecheck.log bun run typecheck`
- Inspeção do diff para confirmar ausência de segredos, deploy, migração remota, commit ou push não solicitados.
