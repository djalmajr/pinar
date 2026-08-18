---
id: captura-primeiro-elemento
name: Anotar um elemento e copiar o bundle
reference: extension/content.js; extension/background.js; extension/format.js
persona: usuario-extensao
entry: "https://stg.pinar.dev/"
preconditions:
  - Extensão carregada e habilitada no Chrome
  - Servidor local ou cloud de staging disponível
---

## User goal

Apontar um elemento específico e entregar contexto utilizável a uma IA.

## Steps

1. Na landing, **clicar o ícone da extensão** → toolbar e camada de seleção aparecem.
2. **Clicar em um card de funcionalidade** → composer se ancora ao elemento.
3. **Digitar comentário E2E e pressionar Enter** → pin numerado aparece.
4. **Usar Cmd/Ctrl+Enter** → captura é processada e feedback Copied aparece.
5. **Colar o clipboard em campo neutro** → contém comentário, seletor, DOM path e coordenadas.
6. **Abrir o viewer pelo link copiado** → screenshot e pin correspondem ao elemento real.
7. **Abrir o workspace** → sessão aparece no destino selecionado.
8. **Conferir página original** → overlay foi encerrado após cópia bem-sucedida.

## Expected result

Uma ação curta produz bundle, viewer e sessão coerentes com o elemento anotado.
