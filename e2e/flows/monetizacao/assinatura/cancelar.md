---
id: assinatura-cancelar
name: Agendar cancelamento no portal
reference: apps/server/src/components/AppShell.tsx; apps/server/src/server/cloud-api.ts; apps/server/src/server/stripe-subscription-state.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Assinatura Pro Test ativa
---

## User goal

Cancelar renovação sem perder acesso antes do fim do período pago.

## Steps

1. No workspace, **abrir Account menu → Manage billing** → portal abre.
2. **Selecionar a assinatura e iniciar cancelamento** → impacto e data são mostrados.
3. **Confirmar cancelamento ao fim do período** → portal marca cancelamento agendado.
4. **Voltar ao Pinar** → sessão e dados permanecem acessíveis.
5. **Conferir plano antes do término** → continua Pro ativo.
6. **Avançar Test Clock até o fim do período** → Stripe emite estado terminal.
7. **Reabrir o app** → plano vira Free, login continua permitido.
8. **Conferir dados acima da quota** → existentes permanecem, novos uploads são limitados.

## Expected result

Cancelamento respeita período pago e faz downgrade sem apagar dados.
