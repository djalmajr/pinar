---
id: auth-multiplos-dispositivos
name: Usar a mesma conta em dispositivos independentes
reference: extension/background.js; extension/identity.js; apps/server/src/server/cloud-api.ts
persona: power-user
entry: "chrome-extension://<extension-id>/dist/options.html"
preconditions:
  - Conta paga E2E existente
  - Duas identidades de instalação isoladas
---

## User goal

Usar a conta em dois dispositivos sem que sair de um derrube o outro.

## Steps

1. No dispositivo A, **entrar por e-mail na extensão** → token de dispositivo é emitido.
2. No dispositivo B, **repetir o login** → segundo token independente é emitido.
3. No A, **capturar uma sessão cloud** → aparece no workspace da conta.
4. No B, **atualizar destino e abrir o app** → mesma árvore e sessão aparecem.
5. No A, **sair da extensão** → A volta a uma instalação Free nova/isolada.
6. No B, **criar outra captura** → continua autenticado e funcional.
7. Na web, **sair da sessão de 30 dias** → token do B continua válido.
8. **Revogar somente B** → A e web permanecem nos respectivos estados atuais.

## Expected result

Tokens web e de dispositivo têm ciclos independentes e escopo correto.
