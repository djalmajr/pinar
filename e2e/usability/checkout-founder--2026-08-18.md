# Evidência — checkout Founder em staging

- **Data:** 2026-08-18
- **Ambiente:** `https://stg.pinar.dev`, Worker `pinar-stg`
- **Versão Cloudflare:** `dee2a325-4d2a-44b0-a9e3-f46cad1e3fba`
- **Stripe:** conta Pinar em modo Test/Sandbox
- **Resultado:** pagamento Test confirmado, conta Founder ativada e webhook entregue com HTTP 200

## Caminho observado

1. A página de preços mostrou `Pinar Founder`, R$129,90, pagamento único,
   5 GB e 500 créditos iniciais, sem texto Lifetime/forever.
2. Antes do aceite, todos os CTAs pagos estavam desabilitados.
3. A interface exibiu links para Termos, Privacidade e Uso Aceitável e a versão
   jurídica `2026-08-18`.
4. Após marcar o aceite, o CTA Founder foi habilitado e o backend criou uma
   reserva atômica no D1 `pinar-stg`.
5. O Stripe Checkout abriu em Sandbox com produto `Pinar Founder`, descrição
   nova, moeda BRL e total de R$129,90.
6. O Checkout foi concluído com cartão e conta de teste autorizados.
7. O retorno em `/success` mostrou `Payment confirmed`, plano Founder ativo e
   sessão autenticada para a mesma conta.
8. `Open app` abriu `/app` autenticado. O painel mostrou a identidade da conta,
   Billing e Sign out; o bloco de patrocínio não apareceu para a conta paga.
9. O Workbench do Stripe registrou `checkout.session.completed` entregue ao
   Worker com HTTP 200.

## Estado persistido confirmado

A consulta somente leitura no D1 `pinar-stg` confirmou:

- usuário com `plan=founder`, `ever_paid=1` e `billing_status=active`;
- uma compra Founder confirmada e zero reservas Founder ativas;
- grant `founder_initial` de 500 créditos, sem expiração e sem consumo;
- aceite de Termos, Privacidade e Uso Aceitável na versão `2026-08-18`, com
  origem `checkout` e instante persistido;
- cota base de 5 GB derivada do plano Founder.

A conta já possuía um grant Pro de 200 créditos de um teste anterior, válido
até 2026-09-18. Ele foi preservado até a própria expiração; o grant Founder de
500 foi criado separadamente, sem sobrescrever crédito válido.

## Brechas encontradas e proteção contra regressão

O primeiro checkout dependia de `consent_collection[terms_of_service]` do
Stripe, que exige uma URL pública de Termos configurada na conta inteira. Essa
configuração compartilhada não foi alterada porque o escopo autorizado era
somente Test/staging.

O aceite passou a ser coletado explicitamente pelo Pinar. O servidor rejeita
bundles ausentes ou obsoletos, carimba fonte e horário na metadata da Checkout
Session e só efetiva a compra quando encontra evidência jurídica válida. O E2E
`tests/e2e/publico/pricing.e2e.test.ts` cobre bloqueio, desbloqueio e payload;
os testes de integração cobrem rejeição, metadata, fulfillment e persistência.

O destino Stripe Test inicialmente não enviava `checkout.session.expired`, de
modo que expirar a primeira sessão no Stripe não liberou a reserva no D1. Após
verificar o estado `expired` no Stripe, essa única reserva órfã foi liberada
manualmente. O endpoint passou a escutar os seis eventos exigidos pelo contrato:

- `checkout.session.completed`;
- `checkout.session.expired`;
- `checkout.session.async_payment_succeeded`;
- `checkout.session.async_payment_failed`;
- `customer.subscription.updated`;
- `customer.subscription.deleted`.

Uma segunda sessão Founder foi expirada depois da correção; o evento chegou com
HTTP 200 e liberou a vaga automaticamente. A consulta final do D1 mostrou zero
reservas Test ativas. O servidor também passou a liberar uma vaga vinculada em
`checkout.session.async_payment_failed`, protegido por teste de integração.

## Catálogo Stripe Test

- Produto: `Pinar Founder`.
- Prices: `Pinar Founder — international` e `Pinar Founder — Brazil`.
- Lookup keys: `pinar_founder_usd_v1` e `pinar_founder_brl_v1`.
- IDs e valores foram preservados; produção não foi alterada.

## Automação hospedada e limite do passe

O fluxo opt-in `tests/e2e/monetizacao/stripe-hosted-founder.e2e.test.ts`,
orquestrado por `scripts/run-stripe-hosted-e2e.mjs`, foi criado para cobrir preços,
aceite, formulário Stripe Test, Success, sessão Founder, 500 créditos, 5 GB e
ausência de patrocínio. O runner recusa qualquer alvo diferente de
`https://stg.pinar.dev`, exige `--consume-founder-slot` e só envia os headers
do Cloudflare Access ao domínio protegido — nunca ao Stripe.

A primeira execução automatizada foi interrompida pelo Cloudflare Access antes
de alcançar o Pinar ou o Stripe, portanto não consumiu vaga Founder. A execução
integral exige um Service Token dedicado ao staging nas variáveis locais
`CF_ACCESS_CLIENT_ID` e `CF_ACCESS_CLIENT_SECRET`; o runner falha cedo quando
elas não existem. A falha assíncrona segue validada deterministicamente pela
integração local, não por uma cobrança real.
