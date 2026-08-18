---
id: retencao-free-e-paga
name: Aplicar retenção Free, Pro cancelado, Founder e Lifetime legado
reference: apps/server/src/server/cloud-api.ts; apps/server/src/lib/entitlements.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Sessões E2E equivalentes em instalação Free, conta Pro, Founder e Lifetime legado
  - Relógio controlável além de sete e noventa dias
---

## User goal

Confirmar que a retenção anunciada é aplicada sem apagar o que comprei para preservar.

## Steps

1. Antes de sete dias, **abrir as quatro sessões e seus links públicos** → todas estão disponíveis.
2. **Avançar o relógio além da retenção Free e executar cleanup** → regras são aplicadas.
3. **Abrir a sessão Free** → não aparece no histórico nem nos agregados vivos.
4. **Abrir o link Free antigo** → conteúdo não é servido.
5. **Cancelar o Pro e avançar menos de 90 dias** → sessão e link permanecem recuperáveis.
6. **Reativar Pro com evento Stripe mais novo** → a expiração é removida.
7. **Cancelar novamente e avançar além de 90 dias** → sessão e link deixam de ser servidos.
8. **Abrir sessões Founder e Lifetime legado** → permanecem disponíveis, dentro das políticas.
9. **Conferir coleções Free vazias** → contêineres permanecem para organização.
10. **Conferir R2/DB pela interface observável** → não há referência pública órfã.

## Expected result

Free expira após sete dias; Pro cancelado tem 90 dias de recuperação; reativação
válida remove a expiração; Founder e Lifetime legado não expiram por ausência de
assinatura.
