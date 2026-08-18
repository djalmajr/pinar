---
id: publico-explorar-proposta-planos
name: Explorar proposta, planos e seis ofertas
reference: apps/server/src/pages/Landing.tsx; apps/server/src/pages/Pricing.tsx; apps/server/src/lib/pricing.ts
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Staging acessível no ponto de entrada
  - Nenhum Checkout deve ser confirmado neste fluxo
---

## User goal

Entender o Pinar, comparar mensal e anual e identificar as seis ofertas antes
de decidir comprar.

## Steps

1. Na landing, **ler o herói e os três pilares** → proposta, contexto preservado e entrega para IA são compreensíveis.
2. **Clicar em "View plans"** → abre a página de planos pela navegação pública.
3. **Conferir o preço anual selecionado inicialmente** → Pro anual e Founder mostram BRL e condições distintas.
4. **Clicar em "Monthly"** → Pro muda para cobrança mensal sem alterar o Founder.
5. **Clicar em "Yearly"** → preço e economia anual voltam ao estado inicial.
6. **Percorrer a seção de adicionais** → 1.000 créditos, 5 GB e 20 GB exibem preço e validade de 12 meses.
7. **Voltar pelo link "Home"** → retorna à landing sem URL digitada.

## Expected result

O visitante encontra as seis ofertas, entende periodicidade, validade e retenção
e retorna à landing somente por ações visíveis.
