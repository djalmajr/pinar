---
id: checkout-founder
name: Comprar a oferta limitada Pinar Founder
reference: apps/server/src/pages/Pricing.tsx; apps/server/src/server/cloud-api.ts; apps/server/src/lib/founder-capacity.ts; apps/server/src/lib/entitlements.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Stripe Sandbox/Test configurado com Prices Founder próprios do ambiente
  - Venda Founder habilitada com capacidade positiva
  - E-mail E2E sem compra Founder
---

## User goal

Pagar uma vez pela oferta limitada Founder, entendendo cotas e políticas sem
interpretá-la como promessa de serviço perpétuo.

## Steps

1. Em Plans, **localizar Pinar Founder** → preço regional, pagamento único, 5 GB e 500 créditos iniciais são explícitos.
2. **Conferir o texto da oferta** → não há “Lifetime”, “forever” ou promessa de operação perpétua.
3. **Tentar avançar sem aceite** → os CTAs pagos permanecem desabilitados e as políticas versionadas ficam visíveis.
4. **Aceitar Termos, Privacidade e Uso Aceitável vigentes** → o CTA é habilitado e o bundle versionado é enviado ao backend.
5. **Clicar Get Pinar Founder** → o backend valida o aceite, reserva uma vaga e abre Checkout em modo payment.
6. **Conferir o total no Stripe** → oferta e moeda correspondem ao ambiente; o aceite já está carimbado na sessão pelo Pinar.
7. **Pagar com cartão de teste** → retorna à Success e confirma a mesma reserva.
8. **Abrir o app** → menu da conta mostra `founder`.
9. **Conferir entitlements** → 5 GB e 500 créditos iniciais são concedidos uma única vez, sem recarga mensal.
10. **Atualizar Success e reentregar webhook** → conta, vaga e créditos não duplicam.
11. **Consumir a última vaga em outra conta** → visitantes seguintes veem a coorte encerrada e não recebem CTA.
12. **Abrir billing** → não há cancelamento de assinatura inexistente; recibos e histórico continuam acessíveis.

## Expected result

Founder é uma compra única limitada, concede exatamente uma vaga, 5 GB e 500
créditos idempotentes, exige aceite legal e fecha com segurança ao atingir a
capacidade configurada.
