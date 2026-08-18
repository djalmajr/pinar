# Usabilidade — Código de extensão inválido, expirado ou reutilizado

- **Persona:** visitante cético
- **Data:** 2026-08-18
- **Ambiente:** build local isolado, Chromium
- **Veredito:** ✅ falha genérica e recuperação limpa

## Walkthrough

1. A aba **Extension** abriu selecionada; três caracteres mantiveram **Open app** desabilitado.
2. Um código inexistente de oito caracteres exibiu **Invalid or expired code** sem enumerar instalação.
3. Ao trocar para **Account**, o erro de outro mecanismo desapareceu.
4. Um código expirado exibiu o mesmo erro seguro.
5. Um código válido abriu `/app`; a reutilização foi rejeitada.
6. Um novo código válido restaurou o acesso.

## Finding corrigido

O erro da extensão permanecia visível ao trocar para o login de conta. O primeiro E2E falhou; `SignInPage` agora limpa mensagens ao mudar de aba ou editar novamente o campo.

## Cobertura automatizada

- `tests/e2e/autenticacao/invalid-expired-codes.e2e.test.ts`: validação, erro, uso único, troca de aba e recuperação.
- `apps/server/src/server/cloud-api.test.ts`: origem, formato, expiração e consumo atômico do código.
