---
id: assinatura-renovar-creditos
name: Renovar e repor 200 créditos sem rollover
reference: apps/server/src/server/cloud-api.ts; apps/server/src/lib/entitlements.ts
persona: power-user
entry: "https://stg.pinar.dev/"
preconditions:
  - Assinatura Pro Test ativa com Test Clock
  - Parte dos créditos mensais já consumida
---

## User goal

Receber a quota mensal de IA na data correta sem acumular saldo não utilizado.

## Steps

1. No viewer autenticado, **gerar resumos até consumir parte do saldo mensal** → saldo diminui.
2. **Registrar o saldo antes da renovação** → origem mensal é distinguível de packs comprados.
3. **Avançar Test Clock um mês** → ciclo de billing avança.
4. **Abrir o app após webhook/cron** → saldo mensal volta a 200.
5. **Conferir pack comprado separado** → créditos avulsos restantes continuam válidos.
6. **Reexecutar reconciliação no mesmo mês** → não concede outro lote.
7. **Avançar assinatura anual um mês** → também repõe 200, sem esperar um ano.

## Expected result

Cada conta Pro recebe 200 créditos mensais sem rollover e sem duplicação.
