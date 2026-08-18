---
id: workspace-patrocinio-somente-free
name: Exibir patrocínio para Free e ocultar para qualquer plano pago
reference: apps/server/src/components/ServerFooter.tsx; apps/server/src/lib/auth-session.ts
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Uma instalação Free disponível
  - Contas de teste Pro mensal, Pro anual, Founder e Lifetime legado disponíveis
---

## User goal

Receber um pedido de apoio somente enquanto uso gratuitamente o produto.

## Steps

1. Como visitante, **abrir a landing e localizar o rodapé** → bloco de patrocínio está visível.
2. Como instalação Free, **abrir o workspace e rolar ao final** → bloco continua visível.
3. Como Pro mensal, **abrir o mesmo ponto do workspace** → a seção inteira está ausente.
4. Como Pro anual, **repetir a inspeção** → a seção inteira está ausente.
5. Como Founder, **repetir a inspeção** → a seção inteira está ausente.
6. Como Lifetime legado, **repetir a inspeção** → a seção inteira está ausente.
7. Em cada conta paga, **inspecionar viewer e páginas públicas autenticadas** → nenhuma variante de agradecimento ocupa o lugar do card.
8. **Voltar a uma sessão Free** → o bloco reaparece com os dois canais de apoio.

## Expected result

Visitante e Free veem o convite de patrocínio; Pro mensal, Pro anual, Founder e Lifetime legado
não veem título, descrição, borda nem botões dessa seção.
