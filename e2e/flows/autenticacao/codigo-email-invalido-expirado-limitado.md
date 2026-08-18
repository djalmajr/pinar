---
id: auth-codigo-email-invalido-expirado-limitado
name: Proteger OTP contra erro, expiração e abuso
reference: apps/server/src/pages/SignIn.tsx; apps/server/src/server/cloud-api.ts
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Conta paga E2E existente
  - Relógio/fixtures capazes de produzir desafios expirados
---

## User goal

Recuperar o acesso quando digito um código errado sem facilitar tentativas abusivas.

## Steps

1. Em Sign in → Account, **pedir código para e-mail inexistente** → resposta é igual à de conta existente.
2. **Pedir código para conta válida** → formulário de verificação aparece.
3. **Digitar código incorreto** → mensagem amigável mantém a possibilidade de corrigir.
4. **Errar até o limite permitido** → desafio é bloqueado sem autenticar.
5. **Tentar um sexto pedido dentro da janela** → rate limit é aplicado.
6. Com fixture expirada, **digitar o código antes válido** → expiração é rejeitada.
7. **Clicar em Change email e pedir novo código** → novo desafio substitui o anterior.
8. **Confirmar o novo código** → acesso é concedido uma única vez.

## Expected result

O fluxo não enumera contas, limita abuso e oferece recuperação explícita.
