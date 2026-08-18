---
id: ia-falha-reembolso
name: Reembolsar crédito quando a inferência falha
reference: apps/server/src/server/cloud-api.ts; apps/server/src/pages/WebViewer.tsx
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Conta E2E autenticada com crédito
  - Binding AI configurável para falhar na fixture
---

## User goal

Não perder crédito quando o provedor de IA falha antes de entregar resultado.

## Steps

1. **Registrar saldo inicial e abrir sessão própria** → viewer está pronto.
2. **Induzir falha da inferência e clicar AI summary** → mensagem de indisponibilidade aparece.
3. **Conferir saldo após compensação** → voltou ao valor inicial.
4. **Repetir o mesmo request enquanto refund está pendente** → estado explícito evita débito duplicado.
5. **Executar recuperação de reservas stale** → ledger termina refunded.
6. **Restaurar IA e tentar novo request id** → resumo conclui.
7. **Conferir saldo final** → somente a tentativa bem-sucedida foi cobrada.

## Expected result

Toda falha sem resultado é compensada exatamente uma vez e fica auditável.
