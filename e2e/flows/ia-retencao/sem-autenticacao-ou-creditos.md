---
id: ia-sem-autenticacao-ou-creditos
name: Bloquear IA com orientação acionável
reference: apps/server/src/pages/WebViewer.tsx; apps/server/src/server/cloud-api.ts
persona: skeptical
entry: "<link não listado /v/ criado pela fixture>"
preconditions:
  - Sessão pública compartilhada
  - Conta E2E sem créditos
---

## User goal

Entender por que o resumo não está disponível e como recuperar acesso.

## Steps

1. Como visitante, **abrir viewer público e clicar AI summary** → diálogo pede sign-in.
2. **Conferir que nenhum resultado é exposto** → sessão pública não concede crédito anônimo.
3. Entrar em conta sem créditos e **abrir sessão própria** → viewer fica acessível.
4. **Clicar AI summary** → mensagem de créditos insuficientes aparece.
5. **Usar o caminho visível para Plans/billing** → opções de crédito são encontráveis.
6. **Comprar pack Test e repetir** → ação passa sem recriar a sessão.

## Expected result

Autenticação e saldo são exigidos com mensagens distintas e recuperação clara.
