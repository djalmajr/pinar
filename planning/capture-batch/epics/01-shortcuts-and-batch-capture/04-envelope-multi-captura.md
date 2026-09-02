# Story 4: Envelope multi-captura no paste

**Origin:** `planning/capture-batch/epics/01-shortcuts-and-batch-capture/00-overview.md`

**Status:** condicional — só executar se a Story 2 mostrar que `/c/{id}.md` não basta.

## Traceability
- Prototype routes/screens: —
- Business rules: `AGENTS.md` — `captureId` e `pinId` não são reescritos
- Artigo de ajuda afetado: `handoff-formats`

## Context

- **Problema:** o bloco `pinar-visual-context` descreve uma captura só. Um lote não cabe nele.
- **Objetivo:** permitir colar o lote inteiro preservando os N `captureId` originais.
- **Valor:** entrega única ao agente sem depender de abrir a URL do agregado.
- **Restrição:** Cursor, Codex, Claude e Grok consomem o formato atual; a mudança precisa ser versionada e retrocompatível.

## Files

| Caminho | Ação | Motivo |
|---|---|---|
| `packages/shared/src/visual-context/index.ts` | editar | envelope multi-captura versionado, mantendo `parseVisualCapture` |
| `packages/shared/src/visual-context/fixtures.ts` | editar | fixture de lote |
| `packages/shared/src/visual-context/*.test.ts` | editar | round-trip, retrocompatibilidade, degradação |
| `packages/shared/src/handoff/index.ts` | editar | montar o Markdown do lote |
| `extension/format.js` | editar | serializar o lote na cópia |
| `apps/server/src/lib/help-locales/*.ts` | editar | documentar o formato nos 7 idiomas |

## Detail

### AS-IS

`VisualCapture` exige exatamente um `captureId`, uma `page` e um `screenshot`. `captureIdFrom` lança `missing_capture_id` na ausência dele, e `decodeVisualCaptureJson` já tolera array — mas interpretando os itens como **pins**, não como capturas.

Essa tolerância é a armadilha: um array de capturas seria silenciosamente lido como pins malformados.

### TO-BE

- Envelope explícito com `schemaVersion` e `captures: VisualCapture[]`.
- `parseVisualCapture` inalterado para entrada single-capture.
- Parser novo detecta o envelope pela presença de `captures`, nunca por array solto.
- Fallback previsível para consumidor antigo: primeira captura, mais aviso de truncamento.

### Escopo

Formato e serialização. Sem mudança de storage.

### Acceptance criteria

- [ ] Envelope versionado, com os N `captureId` e `pinId` preservados byte a byte.
- [ ] Entrada single-capture continua passando pelo caminho atual, sem regressão.
- [ ] Array solto continua sendo interpretado como pins, como hoje.
- [ ] Consumidor antigo recebe degradação previsível e sinalizada.
- [ ] `handoff-formats` documenta as duas formas nos 7 idiomas.

### Dependencies

Story 2. Não iniciar antes de medir a fricção real com `/c/{id}.md`.

## Tasks

- [ ] Definir o envelope e fixar `schemaVersion`.
- [ ] Implementar detecção por chave `captures`, sem alterar a heurística de array.
- [ ] Escrever fixture de lote com 3 capturas e ids conhecidos.
- [ ] Testar round-trip, retrocompatibilidade e degradação.
- [ ] Atualizar a serialização da extensão.
- [ ] Documentar nos 7 locales.

## Verification

```sh
bun test packages/shared/src/visual-context
bun run test
```

**Evidência manual:**
- Colar um lote de 3 páginas em um agente e conferir os 3 `captureId` no bundle.
- Colar o mesmo lote em um consumidor que só entende o formato antigo e confirmar a degradação anunciada.
