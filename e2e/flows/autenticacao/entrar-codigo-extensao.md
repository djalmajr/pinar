---
id: auth-entrar-codigo-extensao
name: Entrar como instalação Free com código temporário
reference: apps/server/src/pages/SignIn.tsx; apps/server/src/server/cloud-api.ts; apps/extension/src/options/OptionsApp.tsx
persona: usuario-free
entry: "https://stg.pinar.dev/"
preconditions:
  - Instalação Free registrada pela extensão contra staging
  - Cookies de sessão web do Pinar ausentes
---

## User goal

Abrir no navegador o mesmo workspace Free que está configurado na extensão.

## Steps

1. Na landing, **clicar em "Sign in"** → abre a aba Extension do sign-in.
2. Na extensão, **abrir Account e clicar em copiar código temporário** → código de oito caracteres aparece e é copiado.
3. No sign-in, **preencher o código** → botão "Open app" fica habilitado.
4. **Clicar em "Open app"** → código é trocado uma única vez por sessão web.
5. No workspace, **conferir Personal e Inbox** → árvore padrão da instalação aparece.
6. **Recarregar o workspace** → sessão continua válida.
7. **Voltar ao sign-in e tentar reutilizar o código** → reutilização é rejeitada.

## Expected result

A instalação abre seu workspace Free com sessão web, e o código temporário não
pode ser reutilizado.
