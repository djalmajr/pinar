---
id: extensao-conta-app-billing-logout
name: Abrir app, billing e sair pela extensão
reference: apps/extension/src/options/OptionsApp.tsx; extension/background.js
persona: usuario-pago
entry: "chrome-extension://<extension-id>/dist/options.html"
preconditions:
  - Extensão autenticada em conta Pro Test
---

## User goal

Gerenciar os acessos principais da conta sem sair das opções da extensão.

## Steps

1. Em Account, **conferir e-mail e badge do plano** → pertencem à conta autenticada.
2. **Clicar Open app** → nova aba abre o workspace da mesma conta.
3. Voltar às opções, **clicar Manage subscription** → portal do customer correto abre.
4. **Retornar às opções** → estado da conta permanece.
5. **Clicar Sign out** → badge volta a Free installation.
6. **Conferir Storage** → destino agora pertence à nova instalação, não à conta.
7. **Clicar Open app** → fluxo usa código/instalação Free.
8. **Entrar novamente por e-mail** → conta e árvore retornam sem duplicação.

## Expected result

Os três atalhos agem sobre a conta certa e logout limpa somente o token do dispositivo.
