# Stripe, Pro, créditos de IA e armazenamento

## Contexto

O Pinar usa um catálogo fixo em BRL e USD, fulfillment idempotente e ledgers separados para créditos de IA e armazenamento. Esta documentação descreve o contrato atual do código.

Os planos são Free e Pro anual. As ofertas mensal, `founder`, `lifetime_founder` e o intervalo `lifetime` foram retirados e são rejeitados. Pagamentos avulsos permanecem apenas para adicionais.

## Contratos

- Ofertas públicas: `pro_year`, `ai_credits_500`, `storage_1gb_12m` e `storage_5gb_12m`.
- Preços fixos: Pro US$ 29/ano; add-ons US$ 2,99, US$ 2,99 e US$ 7,99. No Brasil: R$ 99/ano; add-ons R$ 9,90, R$ 9,90 e R$ 29,90. Assinaturas existentes continuam no preço contratado até uma mudança explícita.
- Free: 250 MB de nuvem; não inclui acesso à IA.
- Pro: 2 GB e 500 créditos de IA concedidos somente na primeira assinatura da conta, sem reposição periódica.
- Pacote de IA: 500 créditos válidos por 12 meses.
- Armazenamento: +1 GB ou +5 GB por 12 meses; pacotes acumulam.
- Free mantém sessões remotas por 30 dias. Pro preserva as sessões enquanto a cobrança está ativa; após término efetivo, inicia uma janela de recuperação de 90 dias. Uma reativação válida remove a expiração pendente.
- Ao exceder a cota vigente, novos uploads são bloqueados antes da escrita no R2. A expiração de um add-on informa carência e recuperação; ela não aciona exclusão automática nesta entrega.
- Checkout e fulfillment usam identificadores idempotentes; webhooks inválidos ou eventos sem ID não alteram estado. O destino deve entregar `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.updated` e `customer.subscription.deleted`.
- Checkout pago e cadastro Free remoto exigem aceite da versão corrente dos Termos, Privacidade e Uso Aceitável, com evidência persistida.

## Remoção do plano de pagamento único

A migração `0017_remove_founder.sql` remove as estruturas exclusivas do Founder e restringe planos a Free/Pro. Ela exige ausência de contas, capturas, créditos, compras e reservas ativas/confirmadas Founder. Caso encontre dados, falha sem convertê-los em assinatura. Fixtures antigas devem ser tratadas explicitamente antes da aplicação no ambiente. Migrações anteriores e notas de release são histórico.

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
3. Adicionar tabelas de eventos Stripe, grants de créditos e grants de armazenamento.
4. Tornar `checkout.session.completed` idempotente e diferenciar assinaturas de add-ons; manter assinaturas sincronizadas por webhook.
5. Conceder créditos iniciais/comprados e calcular saldo por validade; a chamada server-side de IA consome os créditos incluídos antes dos comprados.
6. Calcular uso e cota, expor `/api/account/entitlements` e bloquear upload acima da cota antes do R2.
7. Atualizar a tela de preços/sucesso e cobrir os contratos com testes.
8. Publicar políticas versionadas e persistir o aceite legal em Checkout e no cadastro Free remoto.

## Verificação

- `git diff --check`
- `bun run test`
- `WRANGLER_LOG_PATH=/private/tmp/pinar-wrangler-typecheck.log bun run typecheck`
- Inspeção do diff para confirmar ausência de segredos.
