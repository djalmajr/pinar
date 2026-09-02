# Story 1: Atalho padrão para alternar a toolbar

**Origin:** `planning/capture-batch/epics/01-shortcuts-and-batch-capture/00-overview.md`

## Traceability
- Prototype routes/screens: —
- Business rules: —
- Artigo de ajuda afetado: `shortcuts-and-navigation` (categoria `getting-started`)

## Context

- **Problema:** para esconder a toolbar o usuário precisa clicar no ícone da extensão. `Escape` não serve, porque cancela a sessão inteira.
- **Objetivo:** dar tecla padrão ao toggle que já existe e expor rebinding nativo.
- **Valor:** resolve a dor imediata com mudança mínima e entrega "cada um define seu atalho" sem construir tela de configuração.
- **Restrição:** não criar comando novo para toggle. O clique no ícone já alterna, e o Chrome expõe essa ação como `_execute_action`.

## Files

| Caminho | Ação | Motivo |
|---|---|---|
| `extension/manifest.json` | editar | adicionar `commands._execute_action.suggested_key` |
| `extension/manifest.test.js` | criar | fixar a forma do bloco `commands` e impedir comando de toggle duplicado |
| `apps/server/src/lib/help-locales/{en,pt,es,fr,de,zh,ja}.ts` | editar | documentar o atalho e seus limites no artigo `shortcuts-and-navigation` |

## Detail

### AS-IS

`background.js:95-100` re-injeta `CONTENT_INJECTION_FILES` no clique do ícone; `content.js:2-5` detecta `globalThis.__pinarToggle` e alterna em vez de reinjetar. Não há bloco `commands`, então não existe tecla padrão.

### TO-BE

```json
"commands": {
  "_execute_action": {
    "suggested_key": { "default": "Alt+Shift+P" }
  }
}
```

O usuário redefine em `chrome://extensions/shortcuts`.

### Escopo

Somente a tecla padrão do toggle e sua documentação. Nenhuma mudança em `content.js`, nas teclas do overlay ou no fluxo de captura.

### Approach

#### Story-time decisions

| Decisão | Escolha | Motivo |
|---|---|---|
| Comando dedicado vs `_execute_action` | `_execute_action` | o toggle já existe no clique do ícone; comando novo duplicaria a ação |
| `suggested_key` com entrada `mac` separada | só `default` | `Alt+Shift+P` é válido nas duas plataformas; duplicar não agrega |
| Notação da tecla no texto de ajuda | texto puro, como `Command/Ctrl+Enter` | mantém a convenção já usada no artigo |
| Onde documentar | bullet novo em "During capture" + frase no parágrafo de "Overlay, icon, and DOM walk details" | bullet entra na lista primária de atalhos; a limitação fica junto do texto que já fala do ícone |

### Risks

| Risco | Mitigação |
|---|---|
| `Alt+Shift` alterna layout de teclado em alguns setups Windows | é apenas o default; o rebinding nativo resolve caso a caso |
| Alterar bullets quebra a paridade entre locales | mesma inserção nos 7 arquivos, no mesmo índice, validada pelos testes existentes |

## Test-first plan

- **Comportamento a provar:** o manifest declara tecla padrão para a ação e nenhum comando duplica o toggle.
- **Primeiro teste que falha:** `extension/manifest.test.js` afirmando `commands._execute_action.suggested_key.default` — falha hoje porque não existe bloco `commands`.
- **Nível:** unidade sobre o artefato de configuração, sem browser.
- **Testes de baixo valor a evitar:** simular `chrome.commands` ou a UI de rebinding do Chrome; é plataforma, não código nosso.
- **Rede existente:** a paridade dos catálogos de ajuda já é coberta por `help-content.test.ts`, incluindo contagem de bullets e de code spans por locale.

## Tasks

- [x] Adicionar o bloco `commands` com `_execute_action` ao `manifest.json`.
- [x] Criar `extension/manifest.test.js`: `_execute_action` tem `suggested_key`; nenhuma chave de `commands` casa com `/toggle|toolbar/i`; no máximo 4 comandos com tecla sugerida.
- [x] Documentar o atalho no artigo `shortcuts-and-navigation` nos 7 locales, mantendo a paridade estrutural.
- [x] Rodar `bun run build:ext`.
- [ ] Recarregar a extensão descompactada no Chrome (ação manual do usuário).

## Verification

```sh
node --test extension/manifest.test.js
bun --filter @pinar/server test
bun run test
bun run build:ext
```

**Evidência manual:**
- `chrome://extensions/shortcuts` mostra a ação com `Alt+Shift+P` e permite redefinir.
- Com pins na página: atalho esconde a toolbar, atalho de novo mostra, pins intactos.
- `Escape` segue cancelando a sessão.
