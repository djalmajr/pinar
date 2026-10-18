---
id: assinatura-abrir-portal
name: Abrir o portal de cobrança pela conta
reference: apps/server/src/components/AppShell.tsx; apps/server/src/server/cloud-api.ts
persona: usuario-pago
entry: "http://127.0.0.1:3000/"
preconditions:
  - Indisponível desde 2026-10-18: exige Stripe Test hospedado, e o único ambiente com ele (staging) foi desativado; o Cloud local usa credenciais Stripe inertes
  - Conta Pro E2E autenticada com Stripe customer
  - Billing Portal Test configurado
---

## User goal

Gerenciar cobrança pelo caminho visível dentro do workspace.

## Steps

1. Na landing autenticada, **clicar Open dashboard** → workspace abre.
2. **Abrir Account menu no rodapé da sidebar** → identidade e e-mail são exibidos.
3. **Clicar Billing** → servidor cria sessão curta do portal.
4. No portal Stripe, **conferir produto e periodicidade** → correspondem à assinatura.
5. **Usar o retorno ao Pinar** → volta ao app sem perder sessão.
6. **Abrir novamente Billing** → nova sessão válida é criada sem expor URL antiga.

## Expected result

Somente conta autenticada com customer acessa seu próprio portal.
