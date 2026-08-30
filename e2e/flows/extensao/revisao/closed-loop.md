---
id: extensao-closed-loop
name: Validar o closed loop pin → agente → correção → aceite
reference: tests/e2e/extensao/closed-loop.e2e.test.ts; packages/shared/src/loop-metrics/; docs/release-closed-loop.md
persona: revisor
entry: "https://stg.pinar.dev/app"
preconditions:
  - Extensão Pinar carregada no Chrome
  - Sessão local ou cloud autenticada
  - Opt-in de métricas desligado por padrão
---

## User goal

Provar que um pin vai até a correção aceita, com reabertura e sem telemetria de conteúdo.

## Steps

1. **Pin e copiar** → o bundle dos quatro adaptadores de agente permanece semanticamente equivalente.
2. **Retorno do agente** `changed` → o pin fica `correction_ready`.
3. **Aceitar** → só ação humana; o pin fica `accepted`.
4. **Reabrir e nova devolutiva** → o pin volta a `correction_ready`.
5. **Falha de screenshot, helper ou relocalização** → estado explícito e recuperável, sem fingir exact.
6. **Métricas** → permanecem desligadas; com opt-in, só evento, duração, adaptador e confiança.

## Expected result

O funil fecha na instalação suportada. Comentários, URLs, seletores, screenshots e DOM nunca entram na telemetria.
