# Usabilidade — Alternar armazenamento Local e Cloud

- **Persona:** usuário da extensão
- **Data:** 2026-08-18
- **Ambiente:** bundle de produção das opções, Chromium e `chrome.storage.sync` persistente simulado
- **Veredito:** ✅ preferência e identidade isoladas; capturas reais em dois backends ainda pendentes

## Walkthrough

1. Abri o bundle real de `options.html` em **Storage** com **Local Server** selecionado.
2. Confirmei o comando Unix de instalação e o projeto **Account Local**.
3. Selecionei **Remote Server**, salvei e o destino mudou para **Account Cloud**.
4. **Open app** abriu uma nova aba vinculada a `cloud/account`.
5. Recarreguei as opções; Remote e Account Cloud permaneceram selecionados.
6. Voltei para Local, salvei e confirmei **Account Local** e a aba `local/account`.
7. Recarreguei novamente; a escolha Local permaneceu.

## Findings

Nenhuma mistura de destino foi reproduzida na UI ou na persistência. A fronteira simulada retornou árvores deliberadamente distintas por modo e identidade, tornando uma troca incorreta observável pelo teste.

## Cobertura automatizada

- `tests/e2e/extensao/options-storage-account.e2e.test.ts`: radios, comando local, Save, recarga, árvore e Open app por modo.
- Resultado final: caso de Storage aprovado em Chromium.
- Pendente: produzir uma captura real em cada modo com a extensão carregada e confirmar exclusividade no helper local e em staging.
