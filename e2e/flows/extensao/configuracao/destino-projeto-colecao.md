---
id: extensao-destino-projeto-colecao
name: Escolher destino de captura
reference: apps/extension/src/options/OptionsApp.tsx; extension/destination.js; apps/server/src/server/cloud-api.ts
persona: usuario-extensao
entry: "chrome-extension://<extension-id>/dist/options.html"
preconditions:
  - Árvore com dois projetos e coleções aninhadas
---

## User goal

Enviar novas capturas diretamente ao projeto e coleção onde serão tratadas.

## Steps

1. Em Storage, **abrir Project** → projetos da árvore atual aparecem.
2. **Selecionar o segundo projeto** → coleção protegida/default desse projeto é escolhida.
3. **Abrir Collection** → hierarquia e indentação das coleções aparecem.
4. **Escolher coleção filha** → toast confirma salvamento.
5. **Fechar e reabrir opções** → destino persiste.
6. **Criar captura** → sessão aparece na coleção filha escolhida.
7. **Excluir/inativar o destino por outra sessão** → extensão resolve fallback seguro.
8. **Criar nova captura** → cai em Personal/Inbox, nunca em coleção estrangeira.

## Expected result

Destino persiste enquanto válido e degrada para contêiner protegido quando necessário.
