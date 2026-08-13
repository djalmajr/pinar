# Screen Feedback

Spike: anotar elementos ou áreas numa página Chrome e **copiar** o pacote (comentário, caminho no DOM, screenshot) para a área de transferência. Cola em qualquer lugar — Grok, Claude, Codex, Slack, notas. Não depende de um agente nem de MCP.

```
Chrome (Annotate + pins + ⌘↵)
        │  clipboard (text/plain + text/html com imagens)
        ▼
Qualquer composer / editor
```

## O que este spike faz

- Botão da extensão entra em modo **Annotate**
- Clique = pin num elemento (caminho no DOM + seletor + texto + comentário)
- Arraste = pin numa área
- **⌘↵ / Ctrl+Enter** tira screenshot, recorta cada pin e copia o pacote

O que ficou de fora (de propósito): iframes, React Fiber, injeção no composer do agente, polish visual, auth no sidecar.

## 1. MCP (sobe o sidecar sozinho)

O usuário final só liga o servidor MCP no agente. O processo `mcp` abre o HTTP em `127.0.0.1:17373` e grava o inbox em `~/.ai-feedback/`. Se a porta já estiver ocupada, os agentes compartilham o mesmo store.

O stdio aceita os dois framings: **Content-Length** (SDK oficial / Claude / Codex) e **JSON por linha** (Grok TUI). A resposta usa o mesmo framing do `initialize`.

`bun run serve` existe só para debug local, sem um agente.

## 2. Extensão

1. `chrome://extensions` → Developer mode → **Load unpacked** → pasta `extension/`
2. Abra a página (localhost ou qualquer site)
3. Clique no ícone da extensão
4. Clique num elemento ou arraste uma área, escreva o comentário, confirme
5. **⌘↵ / Ctrl+Enter** para copiar (a toolbar mostra *Copied* e fecha)

O Chrome não deixa colocar um botão "Annotate" na chrome nativa. O toolbar flutuante no canto é o equivalente.

## 3. Ligar em qualquer agente

Troque `/ABS` pelo caminho absoluto deste repo.

### Grok TUI

```sh
grok mcp add ai-feedback -- bun /ABS/ai-feedback/src/cli.ts mcp
```

Ou em `~/.grok/config.toml`:

```toml
[mcp_servers.ai-feedback]
command = "bun"
args = ["/ABS/ai-feedback/src/cli.ts", "mcp"]
```

### Claude Code

```sh
claude mcp add ai-feedback -- bun /ABS/ai-feedback/src/cli.ts mcp
```

### Codex

Em `~/.codex/config.toml`:

```toml
[mcp_servers.ai-feedback]
command = "bun"
args = ["/ABS/ai-feedback/src/cli.ts", "mcp"]
```

### Cursor / Windsurf / outros

O mesmo comando stdio: `bun /ABS/ai-feedback/src/cli.ts mcp`.

## 4. Uso no chat

Depois de Send na página:

> aplica o feedback da página

O agente deve chamar `feedback_take`. Há um skill em `skills/ai-feedback/SKILL.md` para Grok/Claude/Codex descobrirem esse fluxo.

Ferramentas MCP:

| Tool | Efeito |
|---|---|
| `feedback_status` | pins no rascunho vs pacote enviado |
| `feedback_peek` | lê o pacote sem consumir |
| `feedback_take` | lê e consome o pacote |

Screenshots ficam em `~/.ai-feedback/shots/` e entram no markdown como caminhos locais (cabe no limite de output do MCP; o agente abre o arquivo).

## Testes

```sh
bun test
bun run typecheck
```

Verificado neste spike:

- `grok mcp doctor ai-feedback` → handshake `2025-11-25`, 3 tools
- `grok -p` chamou `feedback_take` e devolveu o comentário enviado
- Claude Code: servidor registrado em `.mcp.json` (precisa aprovar no `claude`)
