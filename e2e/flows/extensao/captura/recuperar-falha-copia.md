---
id: captura-recuperar-falha-copia
name: Manter pins editáveis após falha de clipboard ou upload
reference: extension/background.js; extension/content.js; extension/session.js
persona: skeptical
entry: "https://stg.pinar.dev/"
preconditions:
  - Extensão carregada
  - Fixtures capazes de falhar offscreen clipboard e upload
---

## User goal

Recuperar uma captura que falhou sem refazer todos os comentários.

## Steps

1. **Criar pins em top frame e iframe** → sessão está pronta para copiar.
2. **Induzir falha do clipboard offscreen** → fallback da página é tentado.
3. Se ambos falharem, **observar mensagem de erro** → overlays e pins reaparecem editáveis.
4. **Corrigir a condição e copiar novamente** → sessão conclui sem duplicar pins.
5. **Induzir falha do upload cloud** → cópia local detalhada continua disponível.
6. **Restaurar rede e repetir** → viewer é criado uma vez.
7. **Conferir workspace** → somente uma sessão final aparece.
8. **Conferir clipboard** → nunca contém link quebrado fingindo sucesso.

## Expected result

Falhas preservam trabalho e o retry produz uma única sessão válida.
