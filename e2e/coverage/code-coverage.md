# Cobertura de código — Pinar

Medição local de 2026-08-18. As camadas usam runners diferentes e, por isso, os percentuais não devem ser somados nem tratados como uma única cobertura global.

| Camada | Comando | Testes | Funções | Linhas | Branches |
|---|---|---:|---:|---:|---:|
| CLI | `bun run test:coverage:cli` | 34 | 74,45% | 73,09% | 76,38% |
| Extensão e módulos importados | `bun run test:coverage:extension` | 65 | 75,00% | 86,46% | — |
| Servidor e módulos importados | `bun run test:coverage:server` | 126 | 92,63% | 91,91% | — |

## Leitura correta

- O servidor inclui módulos compartilhados e partes da persistência local importadas por suas integrações.
- `account-menu`, `api-data`, `entitlements`, `pin-markdown`, `pricing`, `session-filters`, `session-order`, `stripe-subscription-state`, `success-state`, instaladores, Markdown, PNG, contrato de projetos e os utilitários compartilhados exercitados chegaram a 100% de linhas nessa medição.
- Os dez módulos runtime da extensão listados pela cobertura (`crop`, `destination`, `format`, `full-page`, `i18n`, `identity`, `legal-consent`, `pin-colors`, `session` e `extension-response`) chegaram a 100% de linhas; o percentual agregado inclui módulos compartilhados carregados pelo bundle, mas não executados nessa família de testes.
- A CLI contém implementações alternativas SQLite/JSON e caminhos de instalação específicos de sistema operacional; alguns ramos não podem ser exercitados no mesmo runtime.
- `ensure`, `paths` e `shots` chegaram a 100% de linhas na CLI; a métrica agregada continua limitada principalmente pelos caminhos alternativos de persistência e instalação.
- A extensão ainda depende de APIs reais do Chrome para captura visível, clipboard, iframe e `chrome.storage`; esses limites aparecem como fluxos `partial` no catálogo, não como cobertura automatizada concluída.
- `bun test --coverage` sem filtros não é um comando válido para este monorepo porque tenta carregar os arquivos Playwright pelo runner Bun. Use os três comandos acima.

## Cobertura comportamental complementar

- Catálogo: 62 fluxos e 68 superfícies mapeadas.
- Estado atual: 25 `automated`, 33 `partial`, 0 `missing` e 4 `env-gated`.
- Matriz Playwright final: **210/210** cenários aprovados em Chromium, WebKit, Firefox, iPhone e Android após rebuild do servidor local e da extensão.
- Painel de usuário `sidebar-08`: 15/15 cenários em Chromium, WebKit, Firefox, iPhone e Android.
- Os fluxos móveis antes intermitentes foram repetidos isoladamente: coleção aninhada 3/3 no iPhone e, depois do endurecimento final do helper, 5/5 no Pixel 7; reordenação 6/6 em três repetições por plataforma móvel.
- Os percentuais desta página não incluem cobertura de execução instrumentada dos E2E Playwright; a relação fluxo → teste → superfície permanece em `e2e/coverage/automated-tests.md`.
