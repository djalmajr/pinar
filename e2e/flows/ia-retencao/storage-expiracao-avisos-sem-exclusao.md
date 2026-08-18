---
id: storage-expiracao-avisos-sem-exclusao
name: Avisar em 30, 7 e 1 dias e nunca apagar automaticamente
reference: apps/server/src/server/cloud-api.ts; apps/server/src/lib/entitlements.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Conta E2E com pack de storage e uso acima da quota base
  - Relógio controlável até a expiração
  - E-mail E2E legível
---

## User goal

Planejar a expiração do storage sem descobrir tarde demais ou perder conteúdo.

## Steps

1. A 31 dias da expiração, **conferir caixa postal** → nenhum aviso antecipado indevido.
2. A 30 dias, **executar cron e ler e-mail** → primeiro aviso identifica pack/data.
3. **Reexecutar cron no mesmo marco** → aviso não duplica.
4. Repetir a **7 dias** → segundo aviso único é enviado.
5. Repetir a **1 dia** → aviso final único é enviado.
6. Após expiração, **abrir sessões existentes** → conteúdo permanece intacto.
7. **Tentar upload acima da quota vigente** → novo conteúdo é bloqueado.
8. **Comprar/renovar storage Test** → upload volta a funcionar.
9. **Conferir histórico** → nenhuma rotina apagou automaticamente sessões ou shots.

## Expected result

Avisos são pontuais e idempotentes; expiração pausa uploads sem excluir conteúdo.
