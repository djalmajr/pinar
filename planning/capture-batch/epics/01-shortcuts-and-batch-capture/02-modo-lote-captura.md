# Story 2: Modo lote na captura

**Origin:** `planning/capture-batch/epics/01-shortcuts-and-batch-capture/00-overview.md`

## Traceability
- Prototype routes/screens: —
- Business rules: —
- Artigos de ajuda afetados: `organize-projects`, `send-to-agent`

## Context

- **Problema:** anotar um fluxo que atravessa várias páginas produz sessões soltas, entregues ao agente uma a uma.
- **Objetivo:** acumular capturas de páginas diferentes em uma coleção, com estado visível e finalização explícita.
- **Valor:** o agente recebe o fluxo inteiro em uma entrega, com o contexto de cada página preservado.
- **Restrições:**
  - Uma sessão por página. Achatar páginas em um registro quebraria reopen, relocate, review por página e o vínculo screenshot ↔ locators.
  - `captureId` e `pinId` chegam intactos ao servidor.
  - O lote não é entidade nova: é a coleção que `Session.collectionId` já referencia.

## Files

| Caminho | Ação | Motivo |
|---|---|---|
| `extension/background.js` | editar | estado do lote, trava de destino, comando `finish-batch`, acumulação em `capture` |
| `extension/content.js` | editar | contador na toolbar e semântica de `Mod+Enter` sob lote |
| `extension/manifest.json` | editar | registrar o comando `finish-batch` |
| `extension/batch.js` | criar | estado puro do lote (abrir, adicionar, finalizar, cancelar) isolado do Chrome |
| `extension/batch.test.js` | criar | testar transições, idempotência e falha parcial sem tocar em APIs do browser |
| `apps/server/src/lib/help-locales/*.ts` | editar | documentar o modo lote nos 7 idiomas |

## Detail

### AS-IS

`storeDestination` (`background.js:700`) já persiste `CaptureDestination` entre capturas, mas nada disso é visível como lote. Cada `Mod+Enter` dispara `type === "capture"` (`background.js:309`) e encerra. O servidor já aceita agrupamento: `saveSession({ collectionId })`, `resolveDestination(collectionId?)`, `moveSession`, `reorderSessions`.

### TO-BE

- Estado do lote em `chrome.storage.session`, com `{ collectionId, projectId, items: [{ captureId, url, addedAt }], startedAt }`.
- Abrir lote trava o destino: capturas seguintes usam o mesmo `collectionId` sem repicking.
- Com lote ativo, `Mod+Enter` grava a sessão e **mantém** o lote aberto, incrementando o contador.
- Finalizar o lote encerra o estado e entrega `/c/{collectionId}.md`, que já existe.
- Sem lote ativo, o fluxo atual não muda em nada.

### Escopo

Extensão e documentação. Nenhuma mudança de schema no servidor — apenas uso das rotas existentes.

### Acceptance criteria

- [ ] Ligar/desligar o modo lote; estado sobrevive à navegação e à hibernação do service worker.
- [ ] Com lote ativo, `Mod+Enter` adiciona e o contador incrementa.
- [ ] Sem lote, `Mod+Enter` mantém exatamente o comportamento atual.
- [ ] Todas as páginas do lote compartilham `collectionId`.
- [ ] `captureId` e `pinId` idênticos aos gerados na página.
- [ ] Falha em um item deixa o item pendente e re-tentável, sem descartar o lote.
- [ ] Comando `finish-batch` registrado, com finalização também por clique.
- [ ] `Escape` continua cancelando apenas a captura corrente, nunca o lote.

### Dependencies

Story 1 (bloco `commands` já existente no manifest).

## Tasks

- [ ] Extrair `extension/batch.js` com funções puras: `openBatch`, `addCapture`, `markFailed`, `finishBatch`, `cancelBatch`.
- [ ] Cobrir `batch.js` com testes: adicionar duas páginas, item duplicado é idempotente por `captureId`, item falho fica pendente, finalizar limpa o estado.
- [ ] Persistir o estado em `chrome.storage.session` e reidratar no início do worker.
- [ ] Travar o destino ao abrir o lote e reusá-lo em `resolveDestination`.
- [ ] Ramificar `type === "capture"` para acumular quando houver lote ativo.
- [ ] Exibir contador e estado na toolbar (`content.js`), sem alterar as teclas existentes.
- [ ] Registrar `finish-batch` em `commands` com `suggested_key`.
- [ ] Documentar o modo lote nos 7 locales, preservando paridade estrutural.

## Verification

```sh
node --test extension/batch.test.js
bun run test
bun run build:ext
```

**Evidência manual:**
- Abrir lote, anotar 3 páginas distintas, finalizar. Conferir 3 sessões na mesma coleção, cada uma com seu screenshot e seus pins.
- Conferir `captureId` de cada sessão contra o gerado na página.
- Forçar falha de upload em um item e confirmar que os demais sobrevivem.
- Sem lote ativo, repetir uma captura simples e confirmar comportamento inalterado.
