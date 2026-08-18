---
id: storage-quotas-e-replacement
name: Aplicar 250 MB e 5 GB e permitir substituição segura
reference: apps/server/src/server/cloud-api.ts; apps/server/src/lib/entitlements.ts
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Instalação Free e conta Pro E2E
  - Payloads de screenshot com tamanhos controlados
---

## User goal

Entender o limite atual e substituir uma captura sem ser bloqueado indevidamente.

## Steps

1. Como Free, **enviar capturas até perto de 250 MB** → uploads válidos concluem.
2. **Enviar nova captura que ultrapassa a quota** → upload é bloqueado antes de persistir.
3. **Substituir uma sessão existente por arquivo de mesmo/menor tamanho** → operação é permitida.
4. **Conferir uso** → bytes correspondem aos objetos vivos.
5. Como Pro, **repetir perto de 5 GB** → quota base maior é aplicada.
6. **Comprar pack Test** → quota aumenta pelo grant.
7. **Tentar id estrangeiro/replacement de outra conta** → ownership é rejeitado.
8. **Excluir uma sessão autorizada** → uso disponível aumenta.
9. **Repetir upload antes bloqueado** → agora conclui.

## Expected result

Quotas usam projeção de bytes, consideram replacement e respeitam ownership.
