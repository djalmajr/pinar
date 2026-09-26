# Acesso de agentes ao Pinar Cloud

O Cloud oferece chaves pessoais para contas Pro. Elas permitem que um agente leia os links Markdown privados presentes no prompt copiado e, pelo MCP, execute operações autorizadas. O servidor local não emite essas chaves nem expõe o endpoint MCP.

Crie uma chave em **Configurações → Acesso de agentes**. A chave é exibida uma única vez. Guarde-a no gerenciador de credenciais do cliente; não a cole no prompt, em URLs, em arquivos do repositório ou em logs. A tela permite revogar a chave e mostra seu escopo, permissão, expiração e último uso.

| Permissão | O que permite |
| --- | --- |
| Leitura | Consultar Markdown e imagens privados dentro do escopo escolhido: conta, projeto, coleção, sessão ou lote. |
| Gerenciar | Consultar e modificar projetos, coleções e sessões da conta via MCP. Exige escopo da conta. |
| Compartilhar | Publicar e revogar links de compartilhamento via MCP. Não permite ler comentários privados. Exige escopo da conta. |
| Completa | Combina leitura, gestão e compartilhamento via MCP. Exige escopo da conta. |

Cada solicitação reavalia a assinatura Pro, a expiração e revogação da chave e as permissões atuais sobre o recurso. Uma chave revogada não recorre à sessão do navegador.

Para ler um link privado como `https://pinar.dev/v/<captureId>.md`, envie `Authorization: Bearer <chave>` na solicitação HTTPS. O mesmo vale para Markdown de projeto, coleção e lote e para imagens privadas. Os links copiados continuam sem segredo embutido.

Clientes MCP com suporte a um endpoint HTTP e headers configuráveis podem usar `https://pinar.dev/api/mcp` com o mesmo header `Authorization`. O servidor usa MCP Streamable HTTP stateless, versão `2025-11-25`; `GET` e `DELETE` no endpoint não são usados. O catálogo de ferramentas pode ser consultado com `tools/list` e inclui leitura, criação e renomeação, ordenação, movimentação de sessões e publicação/revogação explícita. Operações destrutivas e cobrança não fazem parte do catálogo.

Comece com `pinar.key_scope` para descobrir a permissão e o identificador do recurso desta chave. As ferramentas de listagem aceitam `limit` e `offset`; `pinar.list_sessions` devolve metadados sem o conteúdo dos pins. Use `pinar.get_session_markdown` para ler o contexto completo de uma sessão. Agregados grandes retornam erro e devem ser lidos sessão por sessão.

Exemplo de verificação com a chave carregada em `PINAR_AGENT_KEY`:

```sh
curl -sS https://pinar.dev/api/mcp \
  -H "Authorization: Bearer ${PINAR_AGENT_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

O suporte a OAuth, descoberta e conexão automática de clientes MCP ainda não foi implementado. Configure o header no cliente antes de abrir links privados ou chamar ferramentas. Para um prompt copiado que precisa funcionar imediatamente sem credencial, a extensão também oferece a opção de incluir o Markdown no próprio texto copiado.
