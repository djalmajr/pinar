# Usabilidade — Copiar Markdown e abrir assistentes

- **Persona:** usuário da extensão
- **Data:** 2026-08-18
- **Ambiente:** build local isolado, Chromium, destinos externos interceptados
- **Veredito:** ✅ clipboard, endpoint e prompts convergem

## Walkthrough

1. No viewer, cliquei **Copy Page**; o botão mudou para **Copied**.
2. Colei o clipboard num textarea neutro via atalho do sistema e obtive o Markdown completo da fixture.
3. Em **More page actions**, abri **View as Markdown** numa nova aba.
4. A aba continha título, URL original e os dois comentários idênticos ao clipboard.
5. Abri **Open in ChatGPT**; a URL recebeu `Review this annotated page: <origem>/v/viewer-e2e.md` em `q`.
6. Repeti com **Open in Claude** e obtive o mesmo prompt e URL Markdown.
7. Fechei as abas interceptadas; o viewer manteve título e dois pins.

## Findings

Nenhuma brecha do produto foi reproduzida. Duas falhas de teste vieram de nomes acessíveis mais completos já existentes: **More page actions** e **Open in ChatGPT/Claude**. As asserções foram alinhadas sem mudança de produto.

## Cobertura automatizada

- `tests/e2e/compartilhamento/viewer-pin-preview-raw-zoom.e2e.test.ts`: clipboard real do Chromium, paste, popup Markdown e URLs de assistentes sem rede externa.
- `apps/server/src/server/markdown.test.ts` e `apps/server/src/lib/pin-markdown.test.ts`: conteúdo e escaping do Markdown.
- Resultado final do arquivo: **4/4 E2E aprovados**.
