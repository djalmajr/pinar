---
id: publico-abrir-workspace-sem-sessao
name: Abrir o workspace sem sessão do Pinar
reference: apps/server/src/pages/Landing.tsx; apps/server/src/routes/app.tsx; apps/server/src/pages/SignIn.tsx
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Cloudflare Access do staging já aprovado
  - Cookies de sessão do Pinar ausentes
---

## User goal

Entender como entrar no workspace ao tentar abri-lo sem sessão do produto.

## Steps

1. Na landing, **clicar em "Open dashboard"** → o servidor não expõe o workspace sem sessão.
2. Na tela de entrada, **identificar as abas Extension e Account** → os dois caminhos são visíveis e explicados.
3. **Selecionar Account** → aparece o formulário de código por e-mail sem apagar a opção da extensão.
4. **Usar o link Home do cabeçalho** → retorna à landing sem beco sem saída.

## Expected result

O visitante sem sessão é encaminhado ao sign-in e entende os caminhos Free e pago.
