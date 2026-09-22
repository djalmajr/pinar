---
id: workspace-patrocinio-somente-free
name: Exibir patrocínio para Free e ocultar para qualquer plano pago
reference: apps/server/src/components/ServerFooter.tsx; apps/server/src/lib/auth-session.ts
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Contas de teste Free e Pro anual disponíveis
---

## User goal

Receber um pedido de apoio somente enquanto uso gratuitamente o produto.

## Steps

1. Como visitante, **abrir a landing e localizar o rodapé** → bloco de patrocínio está visível.
2. Como conta Free, **abrir o workspace e rolar ao final** → bloco continua visível.
3. Como Pro anual, **abrir o mesmo ponto do workspace** → a seção inteira está ausente.
4. Na conta paga, **inspecionar viewer e páginas públicas autenticadas** → nenhuma variante de agradecimento ocupa o lugar do card.
5. **Voltar a uma sessão Free** → o bloco reaparece com os dois canais de apoio.

## Expected result

Visitante e Free veem o convite de patrocínio; Pro anual
não veem título, descrição, borda nem botões dessa seção.
