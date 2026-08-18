# Usabilidade — OTP inválido, expirado e limitado

- **Persona:** conta pagante tentando recuperar acesso
- **Data:** 2026-08-18
- **Ambiente:** build local isolado, Chromium; entrega de email substituída por fixture
- **Veredito:** ✅ não enumeração, limite e recuperação visíveis

## Walkthrough

1. Conta inexistente e conta elegível chegaram à mesma mensagem neutra de envio.
2. Cinco códigos incorretos e a tentativa seguinte não autenticaram e preservaram feedback corrigível.
3. **Use another email** voltou ao pedido sem carregar o erro anterior.
4. Uma resposta `429` apareceu como **Too many requests** sem autenticação.
5. Um desafio expirado foi rejeitado; um novo pedido seguido do OTP correto abriu `/app`.

## Finding corrigido

O erro do desafio anterior permanecia após **Use another email**. O primeiro E2E reproduziu a regressão; a ação agora limpa OTP e erro, e novas edições também retiram mensagens obsoletas.

## Cobertura automatizada

- `tests/e2e/autenticacao/invalid-expired-codes.e2e.test.ts`: estados observáveis e recuperação.
- `apps/server/src/server/cloud-api.test.ts`: não enumeração, tentativas, expiração, uso único e rate limit reais da API.
- O envio Cloudflare Email permanece no fluxo env-gated de login por email, não neste teste negativo.
