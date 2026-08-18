---
id: auth-codigo-extensao-invalido-expirado
name: Rejeitar código temporário inválido, usado ou expirado
reference: apps/server/src/pages/SignIn.tsx; apps/server/src/server/cloud-api.ts
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Cookies de sessão do Pinar ausentes
  - Um código válido e um código expirado de instalações E2E
---

## User goal

Entender por que um código temporário não abriu o app sem comprometer a conta.

## Steps

1. Na landing, **clicar em Sign in** → aba Extension fica selecionada.
2. **Preencher um código malformado** → Open app permanece desabilitado.
3. **Preencher oito caracteres inexistentes e enviar** → erro genérico não enumera instalação.
4. **Preencher um código expirado** → erro informa que um novo código é necessário.
5. **Usar um código válido e tentar reutilizá-lo** → segunda troca é rejeitada.
6. **Voltar à extensão e gerar outro código** → recuperação permanece disponível.

## Expected result

Códigos inválidos, expirados e usados falham sem revelar dados; um novo código resolve.
