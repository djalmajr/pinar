# Acesso de agentes ao Pinar Cloud

O Cloud oferece chaves pessoais para contas Pro. Elas permitem que um agente leia os links Markdown privados presentes no prompt copiado e, pelo MCP, execute operações autorizadas. O servidor local não emite essas chaves: o endpoint MCP local (`http://127.0.0.1:<port>/api/mcp`) é servido em loopback, sem login nem chave de API, e origens de navegador hostis continuam sendo negadas.

Crie uma chave em **Configurações → Acesso de agentes**. A chave é exibida uma única vez. Guarde-a no gerenciador de credenciais do cliente; não a cole no prompt, em URLs, em arquivos do repositório ou em logs. A tela permite revogar a chave e mostra seu escopo, permissão, expiração e último uso.

| Permissão | O que permite |
| --- | --- |
| Leitura | Consultar Markdown e imagens privados dentro do escopo escolhido: conta, projeto, coleção, sessão ou lote. É a única permissão que pode ser criada com escopo de recurso. |
| Gerenciar | Consultar e modificar projetos, coleções, lotes e sessões via MCP. Criada apenas com escopo da conta. |
| Compartilhar | Publicar e revogar links de compartilhamento via MCP. Não permite ler comentários privados. Criada apenas com escopo da conta. |
| Completa | Combina leitura, gestão e compartilhamento via MCP. Criada apenas com escopo da conta. |

Cada solicitação reavalia a assinatura Pro, a expiração e revogação da chave e as permissões atuais sobre o recurso. Uma chave revogada não recorre à sessão do navegador.

Para ler um link privado como `https://pinar.dev/v/<captureId>.md`, envie `Authorization: Bearer <chave>` na solicitação HTTPS. O mesmo vale para Markdown de projeto, coleção e lote e para imagens privadas. Os links copiados continuam sem segredo embutido.

## Endpoint MCP

Clientes MCP com suporte a um endpoint HTTP e headers configuráveis podem usar `https://pinar.dev/api/mcp` com o mesmo header `Authorization`. O servidor roda o mesmo servidor MCP TanStack do helper local, com as seguintes regras de transporte:

- somente `POST` é aceito (`GET`/`DELETE` respondem `405` com `Allow: POST`);
- o corpo deve ser `application/json` (outro `Content-Type` responde `415`);
- lotes JSON-RPC (array de mensagens) respondem `400`;
- todas as respostas levam `Cache-Control: private, no-store`.

No protocolo legado `2025-11-25`, o handshake é obrigatório: `tools/list` ou `tools/call` enviados sem `initialize` anterior respondem `400` (`Server not initialized`), e o `Accept` deve incluir os dois tipos `application/json` e `text/event-stream` (somente `application/json` responde `406`). O cliente preserva o header `mcp-session-id` retornado pelo `initialize` e o reenvia nas chamadas seguintes. No protocolo moderno `2026-07-28` não há `initialize` nem `mcp-session-id`: o cliente usa `server/discover` (header `mcp-method`) e as chamadas seguem sem sessão legada.

As sessões HTTP do legado `2025-11-25` são **em memória**, amarradas ao processo (isolate do Worker): não sobrevivem a um reinício do servidor — uma sessão aberta responde `404` (`Session not found`), e o cliente deve reconectar e refazer o `initialize`. A disponibilidade entre isolates em produção não foi verificada.

O servidor atende duas gerações do protocolo, negociadas pelo header `mcp-protocol-version`: `2025-11-25` (legado; modo padrão do SDK `@modelcontextprotocol/client` 2.2.0) e `2026-07-28` (moderno; pedido pela `versionNegotiation` do cliente, em modo `auto` ou fixado na revisão). Chamadas no modo moderno não dependem da sessão legada:

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const url = new URL("https://pinar.dev/api/mcp");

// Legado 2025-11-25 (padrão do SDK 2.2.0)
const legacy = new Client({ name: "agente", version: "1.0.0" }, { capabilities: {} });
await legacy.connect(new StreamableHTTPClientTransport(url));

// Moderno 2026-07-28 (configuração verificada com o SDK)
const modern = new Client({ name: "agente", version: "1.0.0" }, {
  capabilities: {},
  versionNegotiation: { mode: "auto" }, // ou { mode: { pin: "2026-07-28" } }
});
await modern.connect(new StreamableHTTPClientTransport(url));
```

Exemplo de handshake legado (`2025-11-25`) com `curl` (exemplo de configuração — os valores de status abaixo foram verificados em fixtures isoladas e com o helper compilado localmente):

```sh
# 1) initialize (legado) — capture o header mcp-session-id da resposta
curl -sS -D - https://pinar.dev/api/mcp \
  -H "Authorization: Bearer ${PINAR_AGENT_KEY}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# 2) tools/list com o mcp-session-id do passo 1
curl -sS https://pinar.dev/api/mcp \
  -H "Authorization: Bearer ${PINAR_AGENT_KEY}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: ${MCP_SESSION_ID}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Carregue a chave apenas no gerenciador de credenciais (aqui, variável de ambiente) e refira-a pelo nome; não cole o valor da chave em comandos, arquivos do repositório ou logs.

Notas para desenvolvedores (transporte legado): o corpo da requisição tem teto de 256 KiB (acima disso, `413`) e o resultado de uma ferramenta tem teto de 1 MiB (acima disso, o envelope devolve um erro limitado: `Tool result is too large; narrow the request or query individual sessions`). Sessões do legado `2025-11-25` são em memória por processo/isolate e são varridas de forma preguiçosa cerca de 30 minutos após o último uso — a varredura roda somente quando chega a próxima requisição, e `DELETE` responde `405`, então o cliente não consegue encerrar a sessão explicitamente. Chamadas legadas concorrentes na mesma sessão podem rodar contra o contexto de handlers da requisição mais recente (não há isolamento por chamada dentro de uma sessão legada); quando o isolamento importar, prefira o protocolo moderno `2026-07-28`, serialize as chamadas legadas ou use uma conexão separada por sessão. Nenhum comportamento entre isolates em produção ou no Cloud ao vivo foi verificado; nenhuma verificação remota/em produção (nem deploy) foi autorizada para esta documentação.

## Ferramentas (39)

As 39 ferramentas são prefixadas `pinar` e refletem as 36 do local mais `pinar.key_scope`, `pinar.publish_share` e `pinar.revoke_share`. Listagens aceitam `limit` (1–100, padrão 100) e `offset` (0–10000, padrão 0) e devolvem metadados sem screenshots nem conteúdo dos pins; Markdown devolve o texto armazenado, com teto agregado (máx. 200 sessões ou 512 KiB de pins por agregado — acima disso, leia sessão por sessão). Identificadores de recurso têm no máximo 128 caracteres e aceitam apenas `[A-Za-z0-9_-]` — exceto `pinId`, que aceita também o formato legado `<sessionId>:p<n>` devolvido por `list_pins` em sessões antigas (os demais ids permanecem estritos); nomes de projeto/coleção/lote têm no máximo 200; `query`, campos de `locator` e destinos livres têm no máximo 256; corpos de comentário e título/descrição da página têm no máximo 2000.

| Recurso | Ferramenta | Parâmetros | Devolve | Permissão e escopo |
| --- | --- | --- | --- | --- |
| Chave | `pinar.key_scope` | — | `{permission, resourceType, resourceId}` da chave | qualquer chave válida |
| Projeto | `pinar.list_projects` | `limit?`, `offset?` | `{projects, limit, offset}` | Leitura; lista apenas o visível ao escopo |
| Projeto | `pinar.get_project_markdown` | `projectId` | Markdown do projeto | Leitura; escopo cobre o projeto |
| Projeto | `pinar.create_project` | `name` | `{project}` | Gerenciar; escopo da conta |
| Projeto | `pinar.rename_project` | `projectId`, `name` | `{project}` | Gerenciar; escopo da conta |
| Projeto | `pinar.reorder_projects` | `ids` (máx. 100) | `{projects}`; listas parciais são aceitas — a completude é responsabilidade do chamador | Gerenciar; escopo da conta |
| Projeto | `pinar.delete_project` | `projectId` | `{ok, projectId}`; coleções do projeto são removidas (incluindo os colaboradores/convites de cada coleção) e as sessões migram para o destino padrão | Gerenciar; escopo da conta; o projeto pessoal protegido é rejeitado |
| Coleção | `pinar.list_collections` | `projectId`, `limit?`, `offset?` | `{collections, limit, offset}` | Leitura; escopo cobre o projeto e as coleções |
| Coleção | `pinar.get_collection_markdown` | `collectionId` | Markdown da coleção | Leitura; escopo cobre a coleção |
| Coleção | `pinar.create_collection` | `projectId`, `name`, `parentId?` | `{collection}`; pai omitido ou `null` coloca na raiz | Gerenciar; escopo da conta |
| Coleção | `pinar.rename_collection` | `collectionId`, `name` | `{collection}` | Gerenciar; escopo da conta |
| Coleção | `pinar.reorder_collections` | `projectId`, `items` (`{id, parentId: string \| null}`, máx. 100) | `{collections}`; a hierarquia completa do projeto é verificada pelo servidor | Gerenciar; escopo da conta; mantém o Inbox protegido na raiz |
| Coleção | `pinar.delete_collection` | `collectionId` | `{ok, collectionId}`; filhas são promovidas, as sessões migram para o destino padrão e os colaboradores/convites da coleção são removidos | Gerenciar; escopo da conta; o Inbox protegido é rejeitado |
| Lote | `pinar.list_batches` | `limit?`, `offset?` | `{batches, limit, offset}` | Leitura; escopo da conta ou do lote |
| Lote | `pinar.get_batch_markdown` | `batchId` | Markdown de handoff do lote | Leitura; escopo cobre o lote |
| Lote | `pinar.create_batch` | `label` | `{batch}` | Gerenciar; escopo da conta |
| Lote | `pinar.rename_batch` | `batchId`, `label` | `{batch}` | Gerenciar; escopo da conta |
| Lote | `pinar.finish_batch` | `batchId` | `{batch, ok}` (marcado como finalizado; sessões permanecem no lote) | Gerenciar; escopo da conta |
| Lote | `pinar.delete_batch` | `batchId` | `{ok, batchId}`; sessões permanecem, desvinculadas do lote | Gerenciar; escopo da conta |
| Sessão | `pinar.list_sessions` | `batchId?`, `collectionId?`, `query?` (≤256), `limit?`, `offset?` | `{sessions, limit, offset}` (resumos, sem conteúdo de pins) | Leitura; escopo cobre o filtro |
| Sessão | `pinar.get_session_markdown` | `sessionId` | Markdown da sessão | Leitura; escopo cobre a sessão |
| Sessão | `pinar.create_session` | `page` (`title`, `url` obrigatórios; `description?`, até 2000 chars), `collectionId?`, `batchId?` | `{session}` (somente metadados; sem screenshot) | Gerenciar; escopo da conta |
| Sessão | `pinar.update_session` | `sessionId`, `page?`, `reproduction?` (objeto versão 1: `steps[]` — passos válidos com `at` e `kind` click/input/key/navigate/scroll/wait e `locator`, `thumbnail`, `title`, `url`, `value` opcionais; passos inválidos são descartados e o excedente de 60 é truncado; `null` remove) | `{session}`; rejeitado (`reproduction is invalid`) se a versão não for 1 ou se nenhum passo for válido | Gerenciar; escopo cobre a sessão |
| Sessão | `pinar.delete_session` | `sessionId` | `{ok, sessionId}`; remove a sessão, seus pins, comentários e revisões, e o arquivo do shot | Gerenciar; escopo cobre a sessão |
| Sessão | `pinar.move_session` | `sessionId`, `collectionId` | `{session}` | Gerenciar; escopo da conta |
| Sessão | `pinar.reorder_sessions` | `collectionId`, `ids` (máx. 100) | `{sessions}`; listas parciais são aceitas — a completude é responsabilidade do chamador | Gerenciar; escopo da conta |
| Pin | `pinar.list_pins` | `sessionId`, `limit?`, `offset?` | `{pins, limit, offset}` (comentário, locator, status de revisão) | Leitura; escopo cobre a sessão |
| Pin | `pinar.get_pin` | `sessionId`, `pinId` | `{ok, pin}` | Leitura; escopo cobre a sessão |
| Pin | `pinar.create_pin` | `sessionId`, `comment`, `locator?` (`{cssSelector?, domPath?, innerText?}`, cada campo ≤256) | `{ok, pin, sessionId}` (sem screenshot nem geometria medida) | Gerenciar; escopo cobre a sessão |
| Pin | `pinar.delete_pin` | `sessionId`, `pinId` | `{ok, pinId, sessionId}` | Gerenciar; escopo cobre a sessão |
| Comentário | `pinar.list_pin_comments` | `sessionId`, `pinId` | `{comments, ok}` | Leitura; escopo cobre a sessão |
| Comentário | `pinar.add_pin_comment` | `sessionId`, `pinId`, `body` | `{comment, ok}`; o autor é derivado da chave e não pode ser falsificado | Gerenciar; escopo cobre a sessão |
| Comentário | `pinar.edit_pin_comment` | `sessionId`, `pinId`, `commentId`, `body` | `{comment, ok}`; só comentários criados pela própria chave | Gerenciar; escopo cobre a sessão |
| Comentário | `pinar.edit_pin_note` | `sessionId`, `pinId`, `comment` (≤2000) | `{ok, pin}`; substitui o texto da nota original do pin; id, número e posição do pin são preservados | Gerenciar; escopo cobre a sessão |
| Comentário | `pinar.delete_pin_comment` | `sessionId`, `pinId`, `commentId` | `{ok, commentId}`; só comentários criados pela própria chave | Gerenciar; escopo cobre a sessão |
| Revisão | `pinar.conclude_pin` | `sessionId`, `pinId` | `{ok, changed, review}`; a chave é registrada como agente | Gerenciar; escopo cobre a sessão |
| Revisão | `pinar.reopen_pin` | `sessionId`, `pinId` | `{ok, changed, review}`; a chave é registrada como agente | Gerenciar; escopo cobre a sessão |
| Compartilhamento | `pinar.publish_share` | `resourceType` (`project`/`collection`/`session`/`batch`), `resourceId`, `expiresAt?` (no futuro, no máximo 1 ano) | `{token, expiresAt, resourceType, resourceId}` | Compartilhar; escopo da conta; recurso próprio |
| Compartilhamento | `pinar.revoke_share` | `resourceType`, `resourceId` | `{ok, resourceType, resourceId}` | Compartilhar; escopo da conta; recurso próprio |

Regras de escopo: permissão e escopo são dimensões separadas. Na criação, a tela oferece escopo de recurso (projeto, coleção, sessão ou lote) apenas para chaves de **leitura**; Gerenciar, Compartilhar e Completa são criadas com escopo da conta. Em execução, cada ferramenta aplica o próprio gate: **leitura** exige a permissão Leitura (ou Gerenciar/Completa) e um escopo que cubra o recurso — a conta inteira, o próprio recurso, ou um recurso contido (projeto→coleções e sessões, coleção→sessões, lote→sessões); **mutações de sessão** (pins, comentários, revisão, atualizar/deletar a sessão) exigem a permissão Gerenciar (ou Completa) e um escopo que cubra a sessão; operações de **organização** (projetos, coleções, lotes, mover/reordenar sessões, criar sessões, deletar contêineres) e **compartilhamento** exigem escopo da conta. Ferramenta chamada sem a permissão responde erro de permissão; recurso fora do escopo responde como não encontrado.

Sessões e pins criados por agente são somente metadados: `pinar.create_session` guarda `page` sem screenshot e `pinar.create_pin` guarda o `locator` textual opcional, sem geometria medida. A extensão é a escritora separada do rascunho ativo no navegador: o MCP não reidrata nem sincroniza o rascunho em andamento, e um salvamento posterior explícito da extensão substitui a sessão armazenada com o mesmo id.
