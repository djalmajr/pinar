# Pinar — catálogo de fluxos de uso

Esta pasta é a fonte de verdade das jornadas observáveis do Pinar. Os fluxos
começam em um ponto de entrada legítimo e avançam somente por ações visíveis de
UI. A execução de usabilidade usa o Browser integrado e a skill `ux-persona`, um
fluxo por vez. Playwright cobre regressões determinísticas em `tests/e2e/`.

## Layout

```text
e2e/
  personas/                       # lentes dos usuários
  flows/<categoria>/**/*.md       # um objetivo por fluxo
  coverage/automated-tests.json   # vínculo conservador com automação
  coverage/automated-tests.md     # matriz gerada
  coverage/product-surfaces.json  # rotas, endpoints e superfícies observáveis
  coverage/product-gap-inventory.md
  usability/<id>--<data>.md       # relatórios históricos
  usability/screenshots/<data>/   # evidências visuais
```

## Ambientes

- Web público, conta, billing e cloud: `https://stg.pinar.dev/`.
- Extensão: página de opções da extensão configurada para staging.
- Link compartilhado: URL não listada criada pela própria execução.
- Stripe: somente Sandbox/Test.

## Regras

- Nunca digitar uma rota interna para contornar a navegação do produto.
- Cada finding determinístico recebe o menor E2E capaz de reproduzi-lo.
- O E2E precisa provar estado visível e efeito persistido, não apenas cliques.
- E-mail pode ser lido para obter OTP; a caixa postal permanece somente leitura.
- Dados de teste usam prefixo `e2e_` e são removidos ao fechar a rodada.
- Kashes, Skedly, produção e Stripe live ficam fora do escopo.

## Catálogo

O catálogo aprovado contém 64 fluxos nas categorias `publico`, `autenticacao`,
`monetizacao/ofertas`, `monetizacao/assinatura`, `extensao/captura`,
`extensao/configuracao`, `extensao/revisao`, `workspace`, `compartilhamento` e `ia-retencao`.
