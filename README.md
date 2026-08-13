# Pinar

Anota elementos ou áreas numa página Chrome e **copia** o pacote (comentário, caminho no DOM, coordenadas, screenshot) para a área de transferência. Cola em qualquer lugar — Grok, Claude, Codex, Slack, notas.

```
Chrome (Pinar + pins + ⌘↵)
        │  clipboard (text/plain + text/html com imagens)
        ▼
Qualquer composer / editor
```

## Uso

1. `chrome://extensions` → Developer mode → **Load unpacked** → pasta `extension/`
2. Abra a página
3. Clique no ícone da extensão
4. Clique num elemento ou arraste uma área, escreva o comentário, **Enter** para adicionar
5. **⌘↵ / Ctrl+Enter** para copiar (a toolbar mostra *Copied* e fecha)

- **Enter** adiciona o pin
- **Shift+Enter** quebra linha
- **Esc** no composer fecha só o prompt; sem prompt, limpa todos os pins
- O ícone da extensão só mostra ou esconde a overlay — não apaga pins

O `AGENTS.md` descreve como um agente deve tratar o texto colado.

```sh
bun test
```
