---
id: auth-entrar-email-conta
name: Entrar na conta paga com código por e-mail
reference: apps/server/src/pages/SignIn.tsx; apps/server/src/server/cloud-api.ts; apps/server/src/components/AppShell.tsx
persona: usuario-pago
entry: "https://stg.pinar.dev/"
preconditions:
  - Conta paga E2E existente
  - Gmail autorizado somente para leitura
  - Cookies de sessão do Pinar ausentes
---

## User goal

Entrar sem senha e confirmar que o workspace corresponde à minha conta paga.

## Steps

1. Na landing, **clicar em Sign in e selecionar Account** → formulário de e-mail aparece.
2. **Preencher o e-mail da conta e clicar em Send code** → resposta neutra confirma envio.
3. Na caixa postal, **ler o e-mail mais recente do Pinar** → código de seis dígitos está dentro da validade.
4. No sign-in, **preencher o código** → Verify code fica habilitado.
5. **Confirmar o código** → abre `/app` com sessão de 30 dias.
6. **Abrir o menu da conta** → e-mail e plano corretos aparecem.
7. **Recarregar o workspace** → sessão permanece sem novo OTP.

## Expected result

O OTP autentica a conta certa, não vaza informação antes da verificação e persiste.
