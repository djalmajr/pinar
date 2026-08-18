---
id: sharing-projeto
name: Compartilhar agregado de projeto
reference: apps/server/src/pages/AggregateViewer.tsx; apps/server/src/routes/p/$id.tsx; apps/server/src/server/markdown.ts
persona: visitante
entry: "<link não listado /p/ criado pela fixture>"
preconditions:
  - Projeto E2E com duas coleções e sessões ordenadas
---

## User goal

Revisar todas as capturas de um projeto por um único link.

## Steps

1. **Abrir o link de projeto** → nome e contagem total aparecem.
2. **Conferir duas seções de coleção** → ordem corresponde ao workspace.
3. **Conferir cards de sessão** → título, URL e contagem de pins são autênticos.
4. **Clicar Open em uma sessão** → viewer correto abre.
5. **Voltar pelo navegador** → agregado preserva contexto.
6. **Clicar Copy Markdown** → feedback Copied aparece.
7. **Colar o conteúdo** → coleções e sessões mantêm ordem e links vivos.
8. **Conferir coleção vazia** → estado vazio é explicado sem sumir do projeto.

## Expected result

O agregado preserva hierarquia, ordem e links sem expor outros projetos.
