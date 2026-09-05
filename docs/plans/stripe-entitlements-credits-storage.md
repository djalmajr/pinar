# Stripe, Founder, créditos de IA e armazenamento

## Contexto

O Pinar usa um catálogo fixo em BRL e USD, fulfillment idempotente e ledgers separados para créditos de IA, armazenamento e capacidade Founder. Esta documentação descreve o contrato atual do código; não autoriza deploy, migração remota nem alteração do catálogo Stripe de produção.

O nome público do pagamento único é **Pinar Founder**. Metadata de checkout `lifetime_founder` e o intervalo legado `"lifetime"` são mapeados para Founder; não existe plano, Price ou env `lifetime` separado.

## Contratos

- Ofertas públicas: `pro_month`, `pro_year`, `founder`, `ai_credits_1000`, `storage_5gb_12m` e `storage_20gb_12m`.
- Checkout ainda aceita `lifetime_founder` como alias de `founder`; a apresentação ao cliente usa só Founder.
- Preços fixos: Pro US$ 2,99/mês ou US$ 19/ano; Founder US$ 39; add-ons US$ 2,99, US$ 2,99 e US$ 7,99. No Brasil: R$ 4,90/mês ou R$ 39,90/ano; Founder R$ 129,90; add-ons R$ 9,90, R$ 9,90 e R$ 29,90.
- Free: 250 MB de nuvem e 5 créditos iniciais por instalação.
- Pro: 5 GB e 200 créditos por mês, sem acúmulo; a recarga mensal independe do intervalo de cobrança.
- Founder: 5 GB e 500 créditos iniciais, sem recarga mensal e sem promessa de operação perpétua do serviço hospedado.
- Pacote de IA: 1.000 créditos válidos por 12 meses.
- Armazenamento: +5 GB ou +20 GB por 12 meses; pacotes acumulam.
- Free mantém sessões remotas por 7 dias. Pro preserva as sessões enquanto a cobrança está ativa; após término efetivo, inicia uma janela de recuperação de 90 dias. Uma reativação válida remove a expiração pendente.
- Ao exceder a cota vigente, novos uploads são bloqueados antes da escrita no R2. A expiração de um add-on informa carência e recuperação; ela não aciona exclusão automática nesta entrega.
- Checkout e fulfillment usam identificadores idempotentes; webhooks inválidos ou eventos sem ID não alteram estado. O destino deve entregar `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.updated` e `customer.subscription.deleted`; expiração ou falha assíncrona libera uma reserva Founder vinculada.
- Checkout pago e cadastro Free remoto exigem aceite da versão corrente dos Termos, Privacidade e Uso Aceitável, com evidência persistida.

## Capacidade Founder

Founder começa fechado por segurança em cada ambiente. Uma venda nova só pode ser reservada quando todos os requisitos existem:

- `FOUNDER_SALES_ENABLED=true`;
- `FOUNDER_CAPACITY_LIMIT` é um inteiro positivo decidido pelo proprietário (primeira tranche: `100` em local/staging);
- Price IDs Founder em BRL e USD estão configurados para o ambiente;
- há capacidade disponível depois de contar compras confirmadas e reservas ainda válidas.

Quando o limite é alcançado, a API recusa novas reservas e a interface apresenta Founder como esgotado. O Price correspondente pode continuar arquivado ou ativo no Stripe para histórico e reembolso; disponibilidade comercial é controlada pelo backend, não pela remoção do Price. O valor `100` é a primeira tranche operacional, configurável por ambiente, e não uma promessa pública nem um teto definitivo embutido no código. Produção permanece fechada até autorização separada.

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
4. Tornar `checkout.session.completed` idempotente e diferenciar Founder de add-ons; manter assinaturas sincronizadas por webhook.
5. Conceder créditos iniciais/mensais/comprados e calcular saldo por validade; a futura chamada server-side de IA consumirá os créditos incluídos antes dos comprados.
6. Calcular uso e cota, expor `/api/account/entitlements` e bloquear upload acima da cota antes do R2.
7. Atualizar a tela de preços/sucesso e cobrir os contratos com testes.
8. Publicar políticas versionadas e persistir o aceite legal em Checkout e no cadastro Free remoto.

## Verificação

- `git diff --check`
- `bun run test`
- `WRANGLER_LOG_PATH=/private/tmp/pinar-wrangler-typecheck.log bun run typecheck`
- Inspeção do diff para confirmar ausência de segredos, deploy, migração remota, commit ou push não solicitados.
