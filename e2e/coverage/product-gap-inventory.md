# Inventário de lacunas do produto — Pinar

Atualizado em 2026-08-18 durante a execução sequencial dos fluxos em
`https://stg.pinar.dev` e da matriz local cross-browser. Este inventário distingue evidência observada no
Browser, correção local ainda não entregue e dependências externas. Uma
suspeita sem reprodução não é classificada como defeito.

## Confirmadas no staging e corrigidas localmente

| Fluxo | Evidência no staging | Correção local | Regressão | Estado de entrega |
|---|---|---|---|---|
| `publico-instalar-e-apoiar` | O CTA **Use Free** não navegou. O DOM exposto pelo Browser continha um `button` dentro de um `link`, combinação interativa inválida. | `Pricing.tsx` usa o próprio `Button` para renderizar a âncora externa, sem aninhamento. | `tests/e2e/publico/pricing.e2e.test.ts` falha com o aninhamento e passa com a correção. | Não implantada; staging ainda precisa de nova validação após entrega autorizada. |
| `workspace-patrocinio-somente-free` | Uma sessão paga ainda exibiu o bloco de patrocínio, embora sem os botões. A regra é ocultar a seção inteira para Pro mensal, Pro anual e Founder. | `ServerFooter.tsx` retorna `null` para qualquer sessão paga. | `tests/e2e/workspace/sponsorship.e2e.test.ts` cobre Free, `pro` e `founder`. | Não implantada; staging ainda precisa de nova validação após entrega autorizada. |
| `checkout-pro-anual` / `assinatura-sucesso-idempotente` | O Checkout anual foi pago, mas a Success manteve “Checkout session is missing” mesmo depois de chamar a ativação com parâmetros corretos. A limpeza da URL fazia o roteador reaplicar o erro inicial. | `Success.tsx` usa uma máquina de estado que ignora o evento `missing` depois que a ativação começou. | `tests/e2e/monetizacao/success.e2e.test.ts` falhou com o sintoma; `success-state.test.ts` cobre a ordem missing → activate → URL scrub → success. | Não implantada; a conta Sandbox foi recuperada reapresentando o retorno e validada como Pro anual no portal. |

## Regra confirmada e coberta automaticamente

| Fluxo | Regra | Prova atual | Verificação manual restante |
|---|---|---|---|
| `publico-alternar-idioma-tema` | Na primeira visita, sem preferência persistida, detectar o idioma do navegador; uma escolha manual posterior passa a prevalecer. | `tests/e2e/publico/i18n.e2e.test.ts` inicia um contexto `pt-BR`, confirma português e prova que inglês persiste após recarga. | Repetir em um perfil Browser novo, pois o perfil usado na exploração já possuía inglês salvo. |

## Confirmada no bundle local e corrigida

| Fluxo | Evidência | Correção | Regressão | Estado de entrega |
|---|---|---|---|---|
| `extensao-conta-app-billing-logout` | Após logout, o CTA Free embutia `$19/yr` e traduções equivalentes, contradizendo o preço regional BRL/USD da página de planos. | As sete traduções usam CTA neutro e mantêm `/pricing` como fonte do preço regional. | `tests/e2e/extensao/options-storage-account.e2e.test.ts` falhou procurando o CTA neutro e passou após a correção. | Não implantada; requer commit/push/deploy autorizados. |
| `workspace-idioma-tema-sidebar` / monetização | O backend já calculava créditos e armazenamento, mas o usuário não tinha uma superfície para consultar plano, saldo, expiração e uso/cota. | O painel `sidebar-08` consulta `/api/account/entitlements` e apresenta o contrato para Free, Pro, Founder, Lifetime legado e add-ons. | 15/15 em `tests/e2e/workspace/account-menu.e2e.test.ts` nos cinco projetos; unidades cobrem payload inválido, bytes, percentual e data estável em UTC. | Não implantada; requer commit/push/deploy autorizados. |

## Confirmadas pela matriz local e corrigidas

| Fluxo | Evidência | Correção | Regressão | Estado de entrega |
|---|---|---|---|---|
| `viewer-pin-preview-raw-zoom` | A grade desktop comprimiu o screenshot a uma faixa estreita no mobile. | Viewer empilha screenshot e pins no mobile e preserva duas colunas no desktop. | 20/20 em `viewer-pin-preview-raw-zoom.e2e.test.ts`. | Não implantada. |
| `workspace-buscar-filtrar-alternar-visao` | Busca, filtro Pins e seletor de visualização se sobrepunham no mobile. | Toolbar responsivo com wrap, busca flexível e grupo de visualização separado. | 5/5 no fluxo de busca/filtro. | Não implantada. |
| `workspace-colecao-crud-aninhada` | Recolher/expandir dependia de uma área interna sem nome e sem teclado; no mobile podia selecionar e fechar o drawer. | Controle separado, localizado, com `aria-expanded`, foco e teclado. | 5/5 na matriz e 3/3 repetições focadas no iPhone. | Não implantada. |
| `workspace-mover-reordenar-excluir-sessoes` | Grupos inválidos do menu causavam erro Base UI #31 e tela de erro. | Rótulos e itens foram agrupados conforme o contrato Base UI. | 5/5 na matriz final. | Não implantada. |
| `workspace-reordenar-arvore` | O teste móvel inferia início do sensor por timing e podia ativar seleção em vez de drag. | A regressão confirma o estado acessível `aria-pressed` do `KeyboardSensor`. | 5/5 na matriz e 6/6 repetições móveis. | Teste corrigido; comportamento do produto permaneceu válido. |

## Dependentes de ambiente ou serviço externo

| Área | Dependência | Impacto nos fluxos |
|---|---|---|
| Cloudflare Access | Uma sessão realmente limpa pode parar no Access antes de chegar ao redirecionamento do Pinar. O E2E Founder hospedado exige um Service Token dedicado ao staging. | `publico-abrir-workspace-sem-sessao` precisa registrar separadamente Access e aplicação; `checkout-founder` já possui runner restrito a staging e aguarda apenas `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` locais. |
| Gmail OTP | Leitura somente para recuperar o código enviado a `djalmajr@gmail.com`; nenhuma ação de escrita é autorizada. | `auth-entrar-email-conta` e recuperação de conta paga. |
| Stripe Test | Checkout hospedado, Portal, cartões de teste, 3DS e Test Clocks. A confirmação final de uma compra de teste continua sendo uma transição explícita. | Ofertas, erros de Checkout e ciclo completo da assinatura. |
| Extensão Chrome | A extensão carregada, `chrome.storage`, clipboard e múltiplos frames não existem no Browser integrado. | Captura e configuração da extensão exigem Chrome real além dos testes unitários atuais. |
| Entrega de staging | As correções locais catalogadas não podem ser observadas remotamente antes de commit/push/deploy autorizados. | Revalidação final dos fluxos corrigidos no staging depois de uma entrega autorizada. |

## Ainda não confirmadas

| Observação | Por que ainda não é um defeito | Próxima prova necessária |
|---|---|---|
| `/app` chegou a exibir “Loading page” e zero sessões durante uma exploração anterior. | A identidade, os cookies e o término do carregamento daquele perfil não foram isolados. | Executar `workspace-estado-vazio` com identidade conhecida e observar o estado até estabilizar. |
| Autodetecção visual de idioma em staging com perfil novo. | A execução manual disponível já tinha preferência explícita persistida. | Abrir novo contexto limpo com `pt-BR`, sem `localStorage`, e iniciar pela landing page. |

## Lacunas estruturais de automação

O scoreboard gerado em `automated-tests.md` mantém a classificação completa.
Nenhum dos 62 fluxos permanece sem teste mapeado; quatro continuam `env-gated`
e os gaps observáveis restantes estão declarados como `partial`. Um fluxo não
deve ser promovido a `automated` apenas porque seu consumidor possui teste
unitário: fronteiras reais de Chrome, Stripe, e-mail e staging continuam
explicitadas na matriz.

A matriz local final aprovou **215/215** cenários nos cinco projetos Playwright.
Depois dela, a regressão focada do novo painel aprovou **15/15** cenários nos
mesmos cinco projetos. Esses passes não alteram por si sós a classificação dos
fluxos que ainda exigem Chrome real, Stripe hospedado, e-mail ou staging
implantado.
