# Usabilidade — Abrir sessão pública não listada

- **Persona:** visitante
- **Data:** 2026-08-18
- **Ambiente:** build local isolado, Chromium
- **Veredito:** ✅ somente a sessão compartilhada fica exposta

## Walkthrough

1. Abri diretamente `/v/viewer-e2e` sem sessão autenticada.
2. Confirmei título **Viewer fixture** e URL original `https://example.test/settings`.
3. O screenshot carregou com dimensões naturais **1200 × 800** e o SVG retornado continha o mesmo texto da página capturada.
4. A sidebar mostrou **2 pins** e os dois comentários conhecidos na ordem esperada.
5. A URL original declarou `target=_blank` e `rel="noopener noreferrer"`; o clique abriu a aba explícita correta.
6. Não havia **Personal**, **Inbox** ou outra árvore privada; apenas a navegação pública e **Sign in**.

## Findings

Nenhuma brecha do produto foi reproduzida. A primeira asserção usou “Annotated screenshot”, enquanto o nome acessível real é “Annotated page screenshot”; o teste foi alinhado ao contrato existente sem alteração do produto.

## Cobertura automatizada

- `tests/e2e/compartilhamento/viewer-pin-preview-raw-zoom.e2e.test.ts`: sessão anônima, metadados, imagem carregada, pins, popup externo e ausência de navegação privada.
- `apps/server/src/server/api.local.test.ts` e `cloud-api.test.ts`: contratos públicos de sessão e shot.
- Resultado final do arquivo: **3/3 E2E aprovados**.
