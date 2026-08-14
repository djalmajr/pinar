# Pinar

Anota elementos ou áreas numa página Chrome e **copia** o pacote (comentário, caminho no DOM, coordenadas, screenshot) para a área de transferência. Cola em qualquer lugar — Grok, Claude, Codex, Slack, notas.

```
Chrome (Pinar + pins + ⌘↵)
        │  clipboard (text/plain + text/html com imagens)
        ▼
Qualquer composer / editor
```

## Instalação

Um comando baixa o helper para `~/.pinar`, coloca o launcher em `~/.pinar/bin` e registra os hooks dos agentes. Precisa de **Node ou Bun**.

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/djalmajr/pinar/main/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/djalmajr/pinar/main/install.ps1 | iex
```

O instalador:

1. Sincroniza `~/.pinar` (Windows: `%USERPROFILE%\.pinar`) com o runtime atual: recria `bin/`, `lib/`, `hooks/` e `extension/`, e apaga leftover antigo (`src/`, `AGENTS.md`, testes, pastas velhas)
2. Deixa o launcher em `~/.pinar/bin/pinar` (Windows: `pinar.cmd`)
3. Coloca `~/.pinar/bin` no PATH
4. Faz merge dos hooks globais (não apaga hooks que você já tem)
5. Preserva `shots/`

Abra um terminal novo depois da instalação. Depois, no Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `~/.pinar/extension` (Windows: `%USERPROFILE%\.pinar\extension`).

Ref específico: `PINAR_REF=v0.1.0` (Unix) ou `$env:PINAR_REF = "v0.1.0"` (PowerShell) antes do one-liner.

A partir de um clone:

```sh
./bin/pinar install          # macOS / Linux
.\bin\pinar.cmd install      # Windows
```

## Uso

1. Carregue a extensão (pasta `extension/` do clone, ou `~/.pinar/extension` após o install)
2. Abra a página
3. Clique no ícone da extensão
4. Clique num elemento ou arraste uma área, escreva o comentário, **Enter** para adicionar
5. **⌘↵ / Ctrl+Enter** para copiar (a toolbar mostra *Copied* e fecha)

- **Enter** adiciona o pin
- **Shift+Enter** quebra linha
- **Esc** no composer fecha só o prompt; sem prompt, limpa todos os pins
- O ícone da extensão só mostra ou esconde a overlay — não apaga pins

Os recortes PNG vão para `~/.pinar/shots` (Windows: `%USERPROFILE%\.pinar\shots`). A extensão não consegue escrever nessa pasta sozinha — o helper local sobe no início da sessão. Ele tenta `127.0.0.1:17373` e, se a porta estiver ocupada por outro processo, sobe na próxima livre até `17382`. A extensão procura `GET /health` com `{"service":"pinar"}` nesse intervalo. Se `17373` já for o Pinar, o comando sai na hora e não abre segunda instância. `PINAR_PORT` força uma porta só.

```sh
pinar                 # se ~/.pinar/bin está no PATH
# ou, no clone:
node src/cli.mjs
bun src/cli.mjs
./hooks/ensure.sh
.\hooks\ensure.cmd    # Windows
```

Sem o helper, o recorte cai em `Downloads/pinar/` como fallback.

## Hooks de sessão

Cada agente tem o próprio formato. **`npx skills add` / skills.sh não instala hooks** — só copia `SKILL.md`.

O one-liner acima é o caminho certo para qualquer máquina. Os arquivos neste repo também valem quando a sessão abre **neste projeto**:

| Agente | Arquivo | Evento |
| --- | --- | --- |
| Grok | `.grok/hooks/session-start.json` | `SessionStart` |
| Claude | `.claude/settings.json` | `SessionStart` |
| Codex | `.codex/hooks.json` | `SessionStart` (`commandWindows` no Windows) |
| Antigravity | `.agents/hooks.json` | `PreInvocation` (não existe SessionStart) |
| Pi | `.pi/extensions/pinar.ts` | `session_start` |
| OMP | `.omp/extensions/pinar.ts` | `session_start` |

YAML extra em `.pi/hook/hooks.yaml` e `.omp/hook/hooks.yaml` só roda se o pacote `pi-yaml-hooks` estiver instalado.

Projeto local exige trust na primeira vez: Grok `/hooks-trust`, Codex `/hooks`. Antigravity pode preferir o `hooks.json` do workspace ao global — se os hooks globais sumirem neste repo, apague `.agents/hooks.json` e use só o install global.

Só re-registrar hooks, sem baixar de novo:

```sh
pinar install-hooks
# ou: ./bin/pinar install-hooks
# Windows: .\bin\pinar.cmd install-hooks
```

O `AGENTS.md` descreve como um agente deve tratar o texto colado. Se o copy tiver `Screenshot: /caminho/arquivo.png`, abra esse arquivo — é um recorte só, com todos os pins.

```sh
npm test
```
