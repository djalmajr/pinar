---
id: publico-explorar-proposta-planos
name: Explorar proposta, planos e cinco ofertas
reference: apps/server/src/pages/Landing.tsx; apps/server/src/pages/Pricing.tsx; apps/server/src/lib/pricing.ts
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Staging acessível no ponto de entrada
  - Nenhum Checkout deve ser confirmado neste fluxo
---

## User goal

Entender o Pinar, comparar Free e Pro anual e identificar as cinco ofertas antes
de decidir comprar.

## Steps

1. Na landing, **ler o herói e os três pilares** → proposta, contexto preservado e entrega para IA são compreensíveis.
2. **Clicar em "View plans"** → abre a página de planos pela navegação pública.
3. **Conferir o preço anual selecionado inicialmente** → Pro anual mostra o preço em BRL e a cobrança anual.
4. **Conferir Free e Pro** → retenção, armazenamento e créditos refletem as cotas atuais.
5. **Percorrer a seção de adicionais** → 500 créditos, 1 GB e 5 GB exibem preço e validade de 12 meses.
6. **Voltar pelo link "Home"** → retorna à landing sem URL digitada.

## Expected result

O visitante encontra as cinco ofertas, entende periodicidade, validade e retenção
e retorna à landing somente por ações visíveis.
