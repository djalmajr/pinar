---
id: extensao-alternar-local-cloud
name: Alternar armazenamento local e cloud
reference: apps/extension/src/options/OptionsApp.tsx; extension/background.js; extension/destination.js
persona: usuario-extensao
entry: "chrome-extension://<extension-id>/dist/options.html"
preconditions:
  - Extensão carregada
  - Helper local e staging disponíveis
---

## User goal

Escolher onde as novas capturas serão armazenadas sem misturar os destinos.

## Steps

1. Em Storage, **selecionar Local e salvar** → comando de instalação e destino local aparecem.
2. **Criar captura** → sessão existe somente no helper local.
3. Voltar às opções, **selecionar Cloud e salvar** → conta/instalação cloud é usada.
4. **Criar outra captura** → sessão aparece somente no staging.
5. **Alternar de volta a Local** → árvore local anterior reaparece.
6. **Abrir app em cada modo** → URL e dados correspondem ao modo atual.
7. **Reabrir opções** → última escolha persiste.

## Expected result

Local e cloud mantêm dados e destinos isolados, com preferência persistente.
