---
id: assinatura-inadimplencia-downgrade
name: Refletir inadimplência e limites Free
reference: apps/server/src/server/cloud-api.ts; apps/server/src/lib/entitlements.ts; apps/server/src/components/AppShell.tsx
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Assinatura Pro Test ativa
  - Próxima renovação configurada para falhar
---

## User goal

Entender o que mudou quando o pagamento falha sem perder meu histórico.

## Steps

1. Antes da falha, **abrir workspace e viewer** → Pro e dados estão acessíveis.
2. **Avançar Test Clock para pagamento recusado** → Stripe muda status da assinatura.
3. **Reabrir o workspace** → sessão continua válida e estado não finge estar ativo.
4. **Abrir Account menu** → plano/status coerentes com enforcement vigente.
5. **Tentar novo upload acima da quota Free** → operação é bloqueada com mensagem.
6. **Abrir sessões existentes** → conteúdo não é apagado.
7. **Corrigir pagamento no portal** → assinatura pode voltar a ativa.
8. **Reabrir app** → entitlements Pro retornam sem duplicar dados.

## Expected result

Inadimplência restringe novas operações conforme regra, preserva dados e permite recuperação.
