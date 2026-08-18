---
id: auth-entrar-email-extensao-migrar-free
name: Entrar pela extensão e migrar a árvore Free
reference: apps/extension/src/options/OptionsApp.tsx; extension/background.js; apps/server/src/server/cloud-api.ts
persona: usuario-pago
entry: "chrome-extension://<extension-id>/dist/options.html"
preconditions:
  - Extensão configurada para staging como instalação Free
  - Projeto, coleção, sessão e créditos Free criados pela fixture
  - Conta paga E2E existente
---

## User goal

Vincular a extensão à conta paga sem perder o histórico criado como Free.

## Steps

1. Em Account da extensão, **informar o e-mail pago e pedir código** → confirmação de envio aparece.
2. **Ler o OTP e preencher seis dígitos** → Verify code fica habilitado.
3. **Confirmar o código** → badge e e-mail mudam para a conta paga.
4. Em Storage, **abrir projetos e coleções** → árvore Free está presente na conta.
5. **Abrir o app pela extensão** → workspace web mostra os mesmos contêineres.
6. **Abrir a sessão migrada** → screenshot, pins e ordem foram preservados.
7. **Consultar créditos visíveis pelo primeiro uso de IA** → saldo Free restante migrou uma vez.
8. **Repetir o login da mesma instalação** → dados e créditos não duplicam.
9. **Criar nova captura** → pertence à conta paga, não à instalação antiga.

## Expected result

A migração é atômica, preserva a árvore e não duplica dados nem concessões.
