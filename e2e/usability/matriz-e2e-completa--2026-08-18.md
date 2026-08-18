# Evidência — matriz E2E completa

- **Data:** 2026-08-18
- **Ambiente:** build local recompilado do servidor e da extensão
- **Navegadores:** Chromium, WebKit, Firefox, iPhone 14 e Pixel 7
- **Resultado final:** ✅ **215/215** cenários aprovados em 4m42s

## Escopo observado

A matriz percorreu autenticação por código e OTP simulado, compartilhamento de sessão/coleção/projeto, Preview/Raw/zoom, scripts da extensão, conta e storage, IA e reembolso, retorno de monetização, aceite jurídico versionado, idioma/preços/instaladores, painel de usuário, CRUD e reordenação de workspace, filtros, patrocínio por plano e indisponibilidade segura.

## Findings eliminados antes do passe final

- viewer mobile deixou de comprimir o screenshot e passou a empilhar conteúdo e pins;
- toolbar mobile deixou de sobrepor busca, filtro e visualização;
- recolher/expandir coleção ganhou controle acessível e localizado;
- menus Base UI foram agrupados corretamente;
- drawers passaram a aguardar o fechamento observável de diálogos após refresh;
- menus de sessão foram limitados ao popup efetivamente aberto;
- drag móvel passou a confirmar `aria-pressed` do `KeyboardSensor`.
- checkout pago deixou de depender da URL global de Termos da conta Stripe e
  passou a exigir e registrar o bundle jurídico vigente no próprio Pinar.

Os fluxos antes intermitentes receberam repetições focadas: **3/3** para coleção aninhada no iPhone, depois **5/5** no Pixel 7 com ações de menu atômicas, e **6/6** para reordenação em iPhone/Android.

## Gates complementares

- `bun run typecheck`: aprovado; Wrangler tentou registrar um log fora do sandbox, mas encerrou com código 0 e gerou os tipos.
- `bun run test`: 96 testes Node, 3 da extensão e 135 do servidor aprovados.
- `bun run test:coverage:cli`: 34/34; 72,97% linhas, 75,93% branches, 73,72% funções.
- `bun run test:coverage:extension`: 65/65; 86,46% linhas, 75,00% funções.
- `bun run test:coverage:server`: 127/127; 91,91% linhas, 92,63% funções.
- `node scripts/audit-e2e-flow-coverage.mjs --write --strict`: aprovado; 62 fluxos, 68 superfícies, 25 automated, 32 partial, 0 missing e 5 env-gated.
- `bun run test:stripe-sandbox`: 12/12 ofertas USD/BRL e replay idempotente aprovados.
- Browser em `stg.pinar.dev`: aceite jurídico, Checkout Founder R$129,90,
  pagamento Test, Success e sessão Founder autenticada aprovados.
- Stripe Test: destino `pinar-server-test` escutando seis eventos; expiração
  e conclusão Founder entregues com HTTP 200. D1 confirmou uma compra, grant de
  500 créditos, aceite versionado e zero reservas ativas.
- Painel de conta: 15/15 cenários focados aprovados em Chromium, WebKit,
  Firefox, iPhone 14 e Pixel 7 para Founder, Free e logout; plano, saldo,
  expiração em UTC e armazenamento ficaram observáveis.
- Mutação E2E: remover o resumo de entitlements fez o cenário Founder falhar
  exatamente na ausência de `700 available`; a implementação foi restaurada e
  o cenário voltou a passar.

## Limite honesto

O passe local não substitui Chrome com extensão realmente instalada nem entrega
Gmail/Cloudflare Email. A jornada Founder possui evidência manual completa e
agora uma automação opt-in, bloqueada somente até receber um Service Token do
Cloudflare Access restrito ao staging. O staging implantado continua sendo o
Worker `pinar-stg` na versão `dee2a325-4d2a-44b0-a9e3-f46cad1e3fba`; as
correções desta rodada ainda não foram implantadas e produção, commit e push não
foram alterados.
