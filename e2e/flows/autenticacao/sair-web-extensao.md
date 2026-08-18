---
id: auth-sair-web-extensao
name: Encerrar sessões web e da extensão separadamente
reference: apps/server/src/components/AppShell.tsx; apps/extension/src/options/OptionsApp.tsx; apps/server/src/server/cloud-api.ts
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Conta paga autenticada na web e na extensão
---

## User goal

Sair de um contexto sem perder acesso nos outros dispositivos.

## Steps

1. No workspace, **abrir o menu da conta e clicar Sign out** → volta ao sign-in.
2. **Tentar abrir o dashboard pela landing** → sessão web não autoriza mais o app.
3. Na extensão, **abrir Account** → token de dispositivo ainda está autenticado.
4. **Abrir o app pela extensão** → novo código/sessão web pode ser emitido.
5. Na extensão, **clicar Sign out** → volta ao estado de instalação Free.
6. **Tentar captura cloud da conta** → usa a nova instalação, não a conta anterior.
7. Em outro dispositivo autenticado, **abrir o app** → continua válido.

## Expected result

Logout revoga somente a credencial usada e deixa claros os estados restantes.
