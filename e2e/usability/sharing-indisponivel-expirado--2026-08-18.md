# Usabilidade — Recurso ausente ou expirado

- **Persona:** visitante cético com um link compartilhado
- **Data:** 2026-08-18
- **Ambiente:** build local isolado, Chromium
- **Veredito:** ✅ falha segura, clara e sem enumeração de conta

## Walkthrough

1. Abri ids de sessão inexistente, expirada e pertencente a outra conta.
2. Os três casos encerraram o loading e mostraram o mesmo estado **Annotation session not found**.
3. O link **Back to dashboard** levou ao workspace apropriado sem loop ou skeleton infinito.
4. Consultei os endpoints `.md` ausente e expirado; ambos responderam `404` com a mesma mensagem genérica e sem título ou owner privado.
5. Abri uma coleção preservada após a expiração de sua última sessão.
6. O agregado mostrou **0 sessions**, **No sessions in this collection.** e nenhum link **Open** residual.

## Findings

Nenhuma brecha de produto foi reproduzida. A cobertura existente de integração já confirma que o cleanup remove a sessão expirada das respostas públicas e mantém os containers vazios; o novo E2E acrescenta os estados observáveis pelo visitante.

## Cobertura automatizada

- `tests/e2e/compartilhamento/unavailable-expired.e2e.test.ts`: três estados de sessão indistinguíveis, retorno ao painel, Markdown `404` sem vazamento e coleção vazia.
- `apps/server/src/server/cloud-api.test.ts`: expiração remove sessões dos agregados e do Markdown público.
- Resultado final: **3/3 E2E aprovados**.
