# Usabilidade — Instalar e apoiar

- **Data:** 2026-08-18
- **Ambiente:** build local, Chromium
- **Veredito:** ✅ proposta local, destinos de apoio e instaladores verificáveis

O visitante encontra **Private by default**, e os links Buy Me a Coffee/GitHub Sponsors abrem os domínios exatos em abas isoladas com `noopener noreferrer`. `/install.sh` e `/install.ps1` respondem `200 text/plain`, contêm scripts reconhecíveis e nenhum HTML.

## Finding corrigido

O primeiro E2E fez `/install.sh` encerrar por timeout: o servidor buscava `main` no GitHub a cada acesso. Os scripts agora são incorporados ao build e entregues com cache curto, eliminando a dependência de rede e garantindo paridade com a versão implantada.

## Cobertura

- `tests/e2e/publico/install-support.e2e.test.ts`: semântica pública, destinos e endpoints reais.
- `tests/e2e/publico/pricing.e2e.test.ts`: View plans, Free e Use Free.
- `apps/server/src/server/installers.test.ts`: payload, MIME e cache.
- `apps/cli/src/install.test.js`: comportamento do instalador.
