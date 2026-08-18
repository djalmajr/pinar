# Plano — catálogo UX e regressões E2E do Pinar

## Contexto

O Pinar ainda não possui o catálogo `e2e/flows/` nem uma suíte Playwright nativa.
O objetivo é reproduzir o padrão comprovado do Skedly sem alterar aquele projeto:

- fluxos versionados e agrupados por categoria;
- personas reutilizáveis;
- relatórios históricos de usabilidade com evidência visual;
- matriz conservadora que liga cada fluxo a testes automatizados;
- inventário separado de superfícies e lacunas do produto;
- execução real e sequencial em `https://stg.pinar.dev`;
- regressão automatizada criada sempre que a exploração revelar uma brecha determinística.

“Todo o código” será medido por superfície observável, não por linha: rotas, CTAs,
estados, permissões, persistência e efeitos externos ficam ligados a um fluxo e a
uma prova automatizada ou a uma justificativa explícita de verificação manual.
Utilitários sem UI ficam vinculados ao fluxo consumidor e cobertos no nível
unitário/integração apropriado.

## Limites

- Não modificar Kashes nem Skedly; ambos são somente referências.
- Não usar produção, preços live nem cobranças reais.
- Usar Stripe Sandbox/Test e dados identificados por prefixo E2E.
- Não criar endpoint HTTP de backdoor para testes.
- Não alterar nem commitar `.env.local`.
- Não corrigir produto nem fazer novo deploy como consequência implícita de um
  achado; primeiro registrar o finding e a regressão que o reproduz.
- A skill `ux-persona` executará um fluxo por vez e sempre navegará pela UI.

## Catálogo proposto

Entradas abreviadas: `stg` = `https://stg.pinar.dev/`; `ext` = página de opções
da extensão configurada para staging; `share` = link não listado produzido por
uma captura do próprio fluxo.

### Público

| id | nome | persona | entrada | passos |
|---|---|---|---|---:|
| `publico-explorar-proposta-planos` | Explorar proposta, planos e seis ofertas | skeptical | stg | 7 |
| `publico-alternar-idioma-tema` | Alternar idioma e tema nas páginas públicas | accessibility | stg | 6 |
| `publico-abrir-workspace-sem-sessao` | Abrir o workspace sem sessão do Pinar | skeptical | stg | 4 |
| `publico-instalar-e-apoiar` | Encontrar instaladores e canais de patrocínio | novice | stg | 6 |

### Autenticação

| id | nome | persona | entrada | passos |
|---|---|---|---|---:|
| `auth-entrar-codigo-extensao` | Entrar como instalação Free com código temporário | usuario-free | stg | 7 |
| `auth-codigo-extensao-invalido-expirado` | Rejeitar código temporário inválido, usado ou expirado | skeptical | stg | 6 |
| `auth-entrar-email-conta` | Entrar na conta paga com código por e-mail | usuario-pago | stg | 7 |
| `auth-codigo-email-invalido-expirado-limitado` | Proteger OTP contra erro, expiração e abuso | skeptical | stg | 8 |
| `auth-entrar-email-extensao-migrar-free` | Entrar pela extensão e migrar a árvore Free | usuario-pago | ext | 9 |
| `auth-multiplos-dispositivos` | Usar a mesma conta em dispositivos independentes | power-user | ext | 8 |
| `auth-sair-web-extensao` | Encerrar sessões web e da extensão separadamente | usuario-pago | stg | 7 |

### Monetização — ofertas

| id | nome | persona | entrada | passos |
|---|---|---|---|---:|
| `checkout-pro-mensal` | Assinar Pro mensal em BRL | usuario-pago | stg | 8 |
| `checkout-pro-anual` | Assinar Pro anual em BRL | usuario-pago | stg | 8 |
| `checkout-lifetime` | Comprar acesso vitalício | usuario-pago | stg | 8 |
| `checkout-creditos-ia` | Comprar 1.000 créditos de IA | usuario-pago | stg | 8 |
| `checkout-storage-5gb` | Comprar 5 GB por 12 meses | usuario-pago | stg | 8 |
| `checkout-storage-20gb` | Comprar 20 GB por 12 meses | usuario-pago | stg | 8 |
| `checkout-cancelado` | Abandonar Checkout sem cobrança | skeptical | stg | 6 |
| `checkout-cartao-recusado` | Receber recusa de cartão sem ativar oferta | skeptical | stg | 7 |
| `checkout-3ds` | Concluir autenticação 3DS de teste | usuario-pago | stg | 8 |

### Monetização — assinatura e eventos

| id | nome | persona | entrada | passos |
|---|---|---|---|---:|
| `assinatura-sucesso-idempotente` | Reabrir sucesso sem duplicar concessões | skeptical | stg | 7 |
| `assinatura-abrir-portal` | Abrir o portal de cobrança pela conta | usuario-pago | stg | 6 |
| `assinatura-cancelar` | Agendar cancelamento no portal | usuario-pago | stg | 8 |
| `assinatura-reativar` | Desfazer cancelamento agendado | usuario-pago | stg | 8 |
| `assinatura-renovar-creditos` | Renovar e repor 200 créditos sem rollover | power-user | stg | 7 |
| `assinatura-inadimplencia-downgrade` | Refletir inadimplência e limites Free | skeptical | stg | 8 |
| `assinatura-evento-duplicado-fora-ordem` | Preservar o estado mais novo após reenvio | skeptical | stg | 7 |

### Extensão — captura

| id | nome | persona | entrada | passos |
|---|---|---|---|---:|
| `captura-primeiro-elemento` | Anotar um elemento e copiar o bundle | usuario-extensao | stg | 8 |
| `captura-area` | Anotar uma região livre | usuario-extensao | stg | 7 |
| `captura-multiplos-pins-editar-excluir` | Editar, excluir e ordenar múltiplos pins | power-user | stg | 10 |
| `captura-iframe` | Capturar contexto dentro de iframe | skeptical | stg | 8 |
| `captura-pagina-inteira` | Produzir screenshot além do viewport | power-user | stg | 8 |
| `captura-clipboard-viewer-markdown` | Copiar texto, HTML, imagem e viewer coerentes | usuario-extensao | stg | 9 |
| `captura-recuperar-falha-copia` | Manter pins editáveis após falha de clipboard/upload | skeptical | stg | 8 |

### Extensão — configuração

| id | nome | persona | entrada | passos |
|---|---|---|---|---:|
| `extensao-alternar-local-cloud` | Alternar armazenamento local e cloud | usuario-extensao | ext | 7 |
| `extensao-preferencias` | Persistir idioma, tema, histórico e viewer | accessibility | ext | 9 |
| `extensao-destino-projeto-colecao` | Escolher destino de captura | usuario-extensao | ext | 8 |
| `extensao-conta-app-billing-logout` | Abrir app, billing e sair pela extensão | usuario-pago | ext | 8 |

### Workspace

| id | nome | persona | entrada | passos |
|---|---|---|---|---:|
| `workspace-estado-vazio` | Entender o primeiro estado vazio | novice | stg | 5 |
| `workspace-projeto-crud` | Criar, renomear, compartilhar e excluir projeto | usuario-extensao | stg | 10 |
| `workspace-colecao-crud-aninhada` | Criar, aninhar, renomear e excluir coleção | power-user | stg | 11 |
| `workspace-reordenar-arvore` | Reordenar projetos e coleções por drag-and-drop | power-user | stg | 8 |
| `workspace-buscar-filtrar-alternar-visao` | Buscar, filtrar pins e alternar grade/tabela | usuario-extensao | stg | 9 |
| `workspace-mover-reordenar-excluir-sessoes` | Organizar e remover sessões | power-user | stg | 10 |
| `workspace-destino-invalido-fallback` | Voltar com segurança para Personal/Inbox | skeptical | stg | 7 |
| `workspace-idioma-tema-sidebar` | Persistir preferências e layout do workspace | accessibility | stg | 8 |
| `workspace-patrocinio-somente-free` | Exibir patrocínio para Free e ocultar para qualquer plano pago | skeptical | stg | 7 |

### Compartilhamento e viewer

| id | nome | persona | entrada | passos |
|---|---|---|---|---:|
| `viewer-abrir-sessao-publica` | Abrir captura não listada com dados autênticos | visitante | share | 6 |
| `viewer-pin-preview-raw-zoom` | Inspecionar pin, Markdown bruto e screenshot | visitante | share | 9 |
| `viewer-copiar-markdown-assistentes` | Copiar Markdown e abrir assistentes | usuario-extensao | share | 7 |
| `sharing-projeto` | Compartilhar agregado de projeto | visitante | share | 8 |
| `sharing-colecao` | Compartilhar agregado de coleção | visitante | share | 8 |
| `sharing-indisponivel-expirado` | Explicar recurso ausente ou expirado | skeptical | share | 6 |

### IA, retenção e armazenamento

| id | nome | persona | entrada | passos |
|---|---|---|---|---:|
| `ia-resumir-sessao` | Gerar resumo e debitar um crédito | usuario-pago | stg | 8 |
| `ia-sem-autenticacao-ou-creditos` | Bloquear IA com orientação acionável | skeptical | share | 6 |
| `ia-idempotencia-rate-limit` | Repetir pedido sem novo débito e respeitar limite | skeptical | stg | 7 |
| `ia-falha-reembolso` | Reembolsar crédito quando a inferência falha | skeptical | stg | 7 |
| `retencao-free-e-paga` | Expirar Free e preservar Pro/Lifetime | usuario-pago | stg | 8 |
| `storage-quotas-e-replacement` | Aplicar 250 MB/5 GB e permitir substituição segura | skeptical | stg | 9 |
| `storage-expiracao-avisos-sem-exclusao` | Avisar em 30/7/1 dias e nunca apagar automaticamente | usuario-pago | stg | 9 |

Total proposto: **60 fluxos**.

## Personas

- `visitante`: recebe um link não listado e não conhece o Pinar.
- `usuario-free`: usa instalação temporária e retenção Free.
- `usuario-pago`: comprou Pro, anual, vitalício ou adicional.
- `usuario-extensao`: desenvolvedor que captura feedback no Chrome.
- Personas bundled: `novice`, `skeptical`, `accessibility`, `power-user`.

## Arquivos

### Catálogo e rastreabilidade

- `e2e/README.md`
- `e2e/personas/*.md`
- `e2e/flows/<categoria>/**/*.md`
- `e2e/coverage/automated-tests.json`
- `e2e/coverage/automated-tests.md`
- `e2e/coverage/product-gap-inventory.md`
- `e2e/coverage/product-surfaces.json`
- `e2e/usability/*.md` e `e2e/usability/screenshots/<data>/`

### Automação

- `playwright.config.ts`
- `tests/e2e/<categoria>/*.e2e.test.ts`
- `tests/e2e/fixtures/*.ts`
- `scripts/audit-e2e-flow-coverage.mjs`
- `apps/server/src/lib/e2e-flow-catalog.test.ts`
- `package.json` e lockfile para `@playwright/test`

## Fases

1. **Infraestrutura do catálogo:** README, personas, categorias, inventário de
   superfícies e auditor recursivo. Trabalhar em lotes de no máximo cinco
   arquivos e validar o catálogo a cada lote.
2. **Público e autenticação:** executar os 11 fluxos em staging, salvar
   relatórios/evidências e automatizar redirects, estados, mensagens e OTP que
   não dependam de leitura humana de e-mail.
3. **Seis ofertas e erros de Checkout:** criar fixtures Stripe Test isoladas,
   percorrer mensal, anual, Lifetime, créditos e storage 5/20 GB, além de
   cancelamento, recusa e 3DS.
4. **Ciclo da assinatura:** portal, cancelamento, reativação, renovação,
   inadimplência, idempotência e eventos fora de ordem com Test Clocks quando
   aplicável.
5. **Extensão:** capturas de elemento/área/iframe/full-page, clipboard,
   fallback, preferências, destinos e conta.
6. **Workspace e compartilhamento:** CRUD, drag-and-drop, filtros, viewers e
   agregados com autenticação e dados reais da própria execução; validar que o
   bloco de patrocínio aparece para visitante/Free e não aparece para mensal,
   anual ou Lifetime.
7. **IA, retenção e storage:** débito/replay/reembolso, quotas, expiração e
   avisos sem exclusão automática.
8. **Fechamento:** auditoria fluxo × rota × endpoint × efeito, browser matrix,
   scoreboard, lista de manual-only e gaps restantes.

## Política de regressão

Ao encontrar uma brecha:

1. persistir screenshot e passos no relatório do fluxo;
2. escrever o menor teste que reproduz o comportamento observável;
3. provar que o teste falha contra a brecha ou mutação correspondente;
4. implementar a correção local somente depois que a regressão falhar pelo
   motivo esperado;
5. rerodar a automação local; a repetição em staging depende de a correção ter
   sido entregue pelo fluxo normal de PR/deploy.

Brecha confirmada no código: `OpenSourceSupportCard` atualmente troca título e
descrição e remove somente os botões quando `isPaidAuthSession` é verdadeiro;
a seção continua renderizada. A regra correta é ocultar a seção inteira. A
regressão deve criar estados Free, mensal, anual e Lifetime e provar que somente
o primeiro vê o bloco, sem removê-lo das superfícies públicas.

## Verificação

- `node scripts/audit-e2e-flow-coverage.mjs --write --strict`
- `bun test apps/server/src/lib/e2e-flow-catalog.test.ts`
- `bunx playwright test --project=chromium`
- projetos adicionais WebKit, Firefox, iPhone e Android para fluxos públicos e
  de extensão compatíveis;
- `bun run test`
- `bun run typecheck`
- `bun run build`
- relatório final com, por fluxo: veredito, severidades, automação, passos
  manual-only, comando e resultado.

## Decisões que a confirmação deste plano autoriza

- criar os 60 arquivos de fluxo e a infraestrutura descrita;
- instalar `@playwright/test` como dependência de desenvolvimento;
- criar e remover somente fixtures identificadas de Stripe Test/D1 staging;
- executar os fluxos sequencialmente em staging, inclusive pagamentos de teste;
- ler e-mails necessários por Gmail sem enviar, alterar ou excluir mensagens;
- criar testes automatizados e correções locais para brechas observadas.

Não autoriza commit, push, produção, dados live nem deploy de nova versão do
staging.
