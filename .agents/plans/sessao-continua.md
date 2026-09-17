# Sessão contínua de revisão

## Contexto e autorização
Implementar na branch atual, junto da remoção do Founder. O usuário autorizou plano e execução para validação posterior, nos modos local e remoto. A sessão contínua aposenta a ativação manual de batch. Não publicar nem criar uma release.

## Comportamento
O primeiro comentário inicia um rascunho. Cada pin preserva a evidência do momento em que foi criado, sem revisitar páginas ao concluir. Navegações não encerram o rascunho. Concluir e copiar entrega todas as capturas; o histórico apresenta um agrupamento navegável. Capturas antigas e seus identificadores continuam válidos.

## Abordagem e rastreabilidade
Extensão: toolbar, comentários, atalhos e menu da extensão. Aplicação: /app, histórico e visualizador. Contratos existentes /api/shots, /api/history, /api/batches e /b/:id.md atendem local e remoto. O nome interno batch permanece como compatibilidade de armazenamento, sem modo batch na interface. Cada evidência preserva captureId e pinId.

Rascunho persistente na extensão, operações serializadas e destino fixado ao iniciar. Comentários editados conservam sua evidência; remoções removem a captura correspondente. Captura visível validada contra aba/documento, sem navegação automática. Falhas permanecem recuperáveis; finalização não descarta dados nem anuncia sucesso parcial. Uma sessão ativa por perfil; abas só participam quando o usuário usa Pinar nelas.

## Arquivos
- Criar extension/continuous-session.js e extension/continuous-session.test.js: ciclo de vida, persistência e recuperação.
- Alterar extension/background.js, extension/content.js e extension/manifest.json: captura progressiva, navegação e conclusão.
- Alterar packages/shared/src/i18n/index.ts e gerar extension/i18n.js: textos e atalhos.
- Criar apps/server/src/lib/session-groups.ts e testes: agrupamento das capturas.
- Alterar apps/server/src/pages/HistoryDashboard.tsx e locales de UI: registro agrupado e navegação pelas evidências.
- Atualizar documentação de uso e testes de integração pertinentes.

## Plano de testes
Provar com testes comportamentais: duas páginas e vários pins na mesma sessão; reinício recupera rascunho; falha de upload mantém dados; finalizar espera salvamento; edição não troca screenshot; remoção; isolamento de destino; agrupamento sem misturar evidências. Reusar contratos local/remoto e adicionar cobertura onde necessária. Evitar testes que apenas procuram nomes no código.

## Tarefas
- [x] Implementar e testar o rascunho persistente.
- [x] Integrar criação de pins, captura e continuidade entre páginas.
- [x] Substituir controles de batch por revisão/conclusão da sessão.
- [x] Apresentar sessões agrupadas no histórico com múltiplas evidências.
- [x] Atualizar textos e documentação.
- [x] Executar testes, typecheck e builds local/remoto/extensão.
- [x] Reinstalar aplicativo/helper e verificar /api/health e igualdade SHA256 com o build.
- [ ] Recarregar manualmente a extensão descompactada: o navegador bloqueou acesso automatizado ao gerenciador de extensões.

## Evidências de execução
- 162 testes da extensão, 89 de opções/shared e 19 testes direcionados do servidor passaram (270 no total).
- Três testes E2E passaram: extensão MV3 real em destinos local/remoto, persistência, navegação, falha e recuperação de upload; histórico agrupado e visualização das evidências.
- Contratos local/remoto verificam handoff agregado e autorização: acesso anônimo retorna 401 e outra conta retorna 404.
- Typecheck e builds local, extensão, tray Windows e servidor staging passaram. Configuração gerada do Worker conferida: pinar-stg / staging. Sem deploy.
- Aplicativo/helper reinstalados; /api/health respondeu ok=true, service=pinar, runtime=local, versão 0.3.7-rc.1.
- A cópia autenticada usa o novo GET /api/batches/:id/markdown. A rota pública continua exigindo compartilhamento; copiar não publica a sessão.
- Guia manual: docs/continuous-review-validation.md. O remoto precisa receber o servidor atualizado antes da validação integrada. Nenhum commit, push ou deploy realizado.
- Limitação inicial: uma screenshot por pin. Se a screenshot falhar e a página já mudou, recriar o pin na página original e remover a evidência pendente; a sessão não reconstrói um estado perdido pela URL.

## Riscos e validação manual
A captura depende de a aba ainda estar ativa; falhas devem ser explícitas. Estado dinâmico não pode ser reconstruído por URL. A versão inicial prioriza evidência fiel por pin, podendo ter várias imagens da mesma página. Validar duas URLs, modal na mesma URL, scroll, edição/exclusão, troca de abas, recuperação e finalização em local e remoto. Não alterar permissões de publicação nem executar deploy.
