// Fixture of the filing bench (F3.5 contract §4): ten collections, each
// with three to five captured sessions in pt-BR, and forty new captures,
// each with the collection it belongs to or null when no collection fits
// (the expected answer is the Inbox).
//
// Some captures are in English, and some sit between two look-alike
// collections (same product, or payments in two products): `confusableWith`
// names the other collection. Ten captures have no good collection; three of
// them look like one (a payment page, a calendar, a spreadsheet).

import type { FilingCandidate } from "../../src/server/filing/choose";

export interface FilingBenchPin {
  comment: string;
  number: number;
}

export interface FilingBenchSession {
  capturedAt: string;
  page: { title: string; url: string };
  pins: FilingBenchPin[];
}

export interface FilingBenchCollection {
  collectionId: string;
  label: string;
  sessions: FilingBenchSession[];
}

export interface FilingBenchCapture {
  confusableWith?: string;
  expected: string | null; // collectionId, or null: the Inbox
  id: string;
  language: "en" | "pt-BR";
  page: { title: string; url: string };
  pins: FilingBenchPin[];
}

function session(capturedAt: string, title: string, url: string, ...comments: string[]): FilingBenchSession {
  return { capturedAt, page: { title, url }, pins: comments.map((comment, index) => ({ comment, number: index + 1 })) };
}

export const FILING_BENCH_COLLECTIONS: FilingBenchCollection[] = [
  {
    collectionId: "pinar-extensao",
    label: "Pinar / Extensão",
    sessions: [
      session(
        "2026-10-14T13:10:00.000Z",
        "Opções da extensão Pinar",
        "chrome-extension://pinar/options.html",
        "O seletor de destino corta o nome da coleção quando ele é longo",
        "Falta explicar o atalho Ctrl+Enter abaixo do botão de copiar",
      ),
      session("2026-10-10T18:02:00.000Z", "Popup da Pinar", "chrome-extension://pinar/popup.html", "O botão Capturar fica cinza mesmo com a aba ativa"),
      session(
        "2026-10-03T11:45:00.000Z",
        "Sobreposição de anotação da Pinar",
        "https://pinar.app/demo",
        "O número do pin some atrás do cabeçalho fixo",
        "Ao rolar a página o marcador do pin se desloca uns 20px",
      ),
      session(
        "2026-09-25T09:30:00.000Z",
        "Permissões da extensão Pinar",
        "chrome-extension://pinar/permissions.html",
        "O texto da permissão de acesso às abas está em inglês",
      ),
    ],
  },
  {
    collectionId: "pinar-site",
    label: "Pinar / Site",
    sessions: [
      session(
        "2026-10-12T15:20:00.000Z",
        "Pinar — anotações visuais para agentes",
        "https://pinar.app/",
        "O título do hero quebra em três linhas no celular",
        "O botão Instalar no Chrome precisa de mais contraste",
      ),
      session(
        "2026-10-06T10:05:00.000Z",
        "Preços da Pinar",
        "https://pinar.app/precos",
        "A tabela de planos não mostra o preço em reais",
        "Destacar o plano Pro como o mais escolhido",
      ),
      session("2026-09-28T16:40:00.000Z", "Perguntas frequentes da Pinar", "https://pinar.app/faq", "A resposta sobre privacidade dos dados está desatualizada"),
    ],
  },
  {
    collectionId: "pinar-historico",
    label: "Pinar / Histórico",
    sessions: [
      session(
        "2026-10-15T14:00:00.000Z",
        "Histórico de capturas",
        "http://127.0.0.1:17373/history",
        "O filtro por coleção não limpa ao trocar de projeto",
        "O chip da coleção aparece cortado na lista de sessões",
      ),
      session("2026-10-11T08:50:00.000Z", "Sessão de captura #482", "http://127.0.0.1:17373/session/482", "Os comentários do pin aparecem fora de ordem"),
      session("2026-10-04T19:15:00.000Z", "Busca no histórico", "http://127.0.0.1:17373/history?q=checkout", "A busca não encontra o texto dos comentários"),
      session(
        "2026-09-27T12:30:00.000Z",
        "Mover sessão para outra coleção",
        "http://127.0.0.1:17373/history/move",
        "O diálogo de mover sessão não mostra as subcoleções",
      ),
    ],
  },
  {
    collectionId: "cinzel-editor",
    label: "Cinzel / Editor",
    sessions: [
      session(
        "2026-10-13T17:25:00.000Z",
        "Editor do Cinzel — Roadmap",
        "https://app.cinzel.dev/doc/roadmap",
        "O atalho Ctrl+K não abre o diálogo de link",
        "A barra de ferramentas cobre a primeira linha do documento",
      ),
      session("2026-10-07T09:10:00.000Z", "Editor do Cinzel — Documentação da API", "https://app.cinzel.dev/doc/api", "O realce de sintaxe some ao colar código TypeScript"),
      session("2026-09-30T14:55:00.000Z", "Editor do Cinzel — Metas do trimestre", "https://app.cinzel.dev/doc/metas", "Não dá para redimensionar a coluna da tabela"),
    ],
  },
  {
    collectionId: "cinzel-quadro",
    label: "Cinzel / Quadro",
    sessions: [
      session(
        "2026-10-14T10:40:00.000Z",
        "Quadro da sprint 42 — Cinzel",
        "https://app.cinzel.dev/board/sprint-42",
        "Arrastar o cartão para Concluído não salva a mudança",
        "O limite de WIP da coluna Em andamento não aparece",
      ),
      session("2026-10-08T13:35:00.000Z", "Cartão CIN-311 — Cinzel", "https://app.cinzel.dev/board/card/CIN-311", "O responsável do cartão não atualiza o avatar"),
      session(
        "2026-10-01T16:20:00.000Z",
        "Filtros do quadro — Cinzel",
        "https://app.cinzel.dev/board/sprint-42?filtro=bugs",
        "O filtro por etiqueta esconde os cartões sem etiqueta",
      ),
    ],
  },
  {
    collectionId: "skedly-agenda",
    label: "Skedly / Agenda",
    sessions: [
      session(
        "2026-10-15T11:15:00.000Z",
        "Agenda semanal do Skedly",
        "https://skedly.app/agenda/semana",
        "Sábado e domingo deveriam ter outra cor de fundo",
        "O horário das 12h aparece duplicado",
      ),
      session("2026-10-09T15:45:00.000Z", "Novo agendamento — Skedly", "https://skedly.app/agenda/novo", "O seletor de horário não respeita o fuso de Recife"),
      session("2026-10-02T08:20:00.000Z", "Agenda do dia — Skedly", "https://skedly.app/agenda/dia", "Consultas sobrepostas ficam uma em cima da outra"),
      session(
        "2026-09-26T17:05:00.000Z",
        "Lembretes por WhatsApp — Skedly",
        "https://skedly.app/agenda/lembretes",
        "O texto do lembrete não mostra o endereço da clínica",
      ),
    ],
  },
  {
    collectionId: "skedly-faturas",
    label: "Skedly / Faturas",
    sessions: [
      session(
        "2026-10-13T09:40:00.000Z",
        "Faturas do Skedly",
        "https://skedly.app/faturas",
        "O download do PDF da fatura falha no Safari",
        "O status Vencida está num vermelho fraco demais",
      ),
      session("2026-10-05T14:10:00.000Z", "Fatura de setembro de 2026 — Skedly", "https://skedly.app/faturas/2026-09", "O valor do imposto aparece sem os centavos"),
      session(
        "2026-09-29T10:25:00.000Z",
        "Forma de pagamento — Skedly",
        "https://skedly.app/faturas/pagamento",
        "Trocar o cartão de crédito pede o CVV duas vezes",
      ),
    ],
  },
  {
    collectionId: "aurora-checkout",
    label: "Loja Aurora / Checkout",
    sessions: [
      session(
        "2026-10-16T12:00:00.000Z",
        "Carrinho — Loja Aurora",
        "https://loja-aurora.com.br/carrinho",
        "O cupom de desconto não recalcula o frete",
        "O botão Finalizar compra some no celular",
      ),
      session(
        "2026-10-12T19:30:00.000Z",
        "Pagamento — Loja Aurora",
        "https://loja-aurora.com.br/checkout/pagamento",
        "O campo de CPF aceita letras",
        "O QR code do Pix não aparece no tema escuro",
      ),
      session("2026-10-06T15:50:00.000Z", "Entrega — Loja Aurora", "https://loja-aurora.com.br/checkout/entrega", "O CEP não preenche o bairro automaticamente"),
      session(
        "2026-09-30T20:10:00.000Z",
        "Pedido confirmado — Loja Aurora",
        "https://loja-aurora.com.br/checkout/confirmado",
        "O número do pedido está numa fonte muito pequena",
      ),
    ],
  },
  {
    collectionId: "aurora-catalogo",
    label: "Loja Aurora / Catálogo",
    sessions: [
      session(
        "2026-10-15T16:35:00.000Z",
        "Vestidos — Loja Aurora",
        "https://loja-aurora.com.br/vestidos",
        "O filtro por tamanho não combina com o filtro de cor",
        "As fotos dos produtos carregam distorcidas",
      ),
      session(
        "2026-10-09T11:00:00.000Z",
        "Vestido midi floral — Loja Aurora",
        "https://loja-aurora.com.br/produto/vestido-midi-floral",
        "A tabela de medidas abre fora da tela",
      ),
      session("2026-10-02T18:45:00.000Z", "Busca: sandália — Loja Aurora", "https://loja-aurora.com.br/busca?q=sandalia", "A busca não corrige sandalia sem acento"),
    ],
  },
  {
    collectionId: "tinta-artigos",
    label: "Blog Tinta / Artigos",
    sessions: [
      session(
        "2026-10-11T21:00:00.000Z",
        "Como funciona a tokenização — Blog Tinta",
        "https://blogtinta.com.br/tokenizacao",
        "A fonte do corpo do texto ficou pequena",
        "O diagrama de tokens não tem texto alternativo",
      ),
      session(
        "2026-10-03T20:15:00.000Z",
        "Tipografia para leitura longa — Blog Tinta",
        "https://blogtinta.com.br/tipografia",
        "O espaçamento entre os parágrafos está apertado",
      ),
      session("2026-09-24T22:40:00.000Z", "Arquivo de posts — Blog Tinta", "https://blogtinta.com.br/arquivo", "A paginação pula da página 2 para a 4"),
    ],
  },
];

function capture(
  id: string,
  expected: string | null,
  language: FilingBenchCapture["language"],
  title: string,
  url: string,
  comments: string[],
  confusableWith?: string,
): FilingBenchCapture {
  return {
    ...(confusableWith ? { confusableWith } : {}),
    expected,
    id,
    language,
    page: { title, url },
    pins: comments.map((comment, index) => ({ comment, number: index + 1 })),
  };
}

export const FILING_BENCH_CAPTURES: FilingBenchCapture[] = [
  capture("f01", "pinar-extensao", "pt-BR", "Opções da extensão Pinar", "chrome-extension://pinar/options.html#destino", [
    "A lista de coleções do destino não rola quando há muitas coleções",
  ]),
  capture("f02", "pinar-extensao", "en", "Pinar annotation overlay", "https://pinar.app/demo#overlay", ["The pin badge overlaps the page's sticky header"]),
  capture(
    "f03",
    "pinar-extensao",
    "pt-BR",
    "Popup da Pinar",
    "chrome-extension://pinar/popup.html",
    ["O popup não mostra o nome da última sessão capturada"],
    "pinar-historico",
  ),
  capture("f04", "pinar-site", "pt-BR", "Pinar — anotações visuais para agentes", "https://pinar.app/#como-funciona", [
    "O vídeo de demonstração não toca no Firefox",
  ]),
  capture("f05", "pinar-site", "en", "Pinar pricing", "https://pinar.app/en/pricing", ["The yearly price is missing the currency symbol"]),
  capture("f06", "pinar-site", "pt-BR", "Preços da Pinar", "https://pinar.app/precos#anual", ["O botão Assinar o plano anual leva para uma página 404"], "skedly-faturas"),
  capture("f07", "pinar-historico", "pt-BR", "Histórico de capturas", "http://127.0.0.1:17373/history?colecao=inbox", [
    "A Inbox ainda mostra sessões que já foram movidas",
  ]),
  capture("f08", "pinar-historico", "en", "Capture history", "http://127.0.0.1:17373/history?q=login", ["Search results don't highlight the matched comment"]),
  capture(
    "f09",
    "pinar-historico",
    "pt-BR",
    "Sessão de captura #519",
    "http://127.0.0.1:17373/session/519",
    ["A screenshot da sessão aparece sem os números dos pins"],
    "pinar-extensao",
  ),
  capture("f10", "cinzel-editor", "pt-BR", "Editor do Cinzel — Onboarding", "https://app.cinzel.dev/doc/onboarding", ["Desfazer com Ctrl+Z apaga o parágrafo inteiro"]),
  capture("f11", "cinzel-editor", "en", "Cinzel editor — Changelog", "https://app.cinzel.dev/doc/changelog", ["Markdown headings typed with # don't convert"]),
  capture(
    "f12",
    "cinzel-editor",
    "pt-BR",
    "Editor do Cinzel — Guia de estilo",
    "https://app.cinzel.dev/doc/guia-de-estilo",
    ["A fonte do texto no editor ficou pequena e as linhas estão apertadas"],
    "tinta-artigos",
  ),
  capture("f13", "cinzel-quadro", "pt-BR", "Quadro da sprint 43 — Cinzel", "https://app.cinzel.dev/board/sprint-43", ["A coluna Revisão não aceita mais cartões"]),
  capture("f14", "cinzel-quadro", "en", "Card CIN-402 — Cinzel", "https://app.cinzel.dev/board/card/CIN-402", ["The due date picker closes when I drag the card"]),
  capture(
    "f15",
    "cinzel-quadro",
    "pt-BR",
    "Cartão CIN-377 — Cinzel",
    "https://app.cinzel.dev/board/card/CIN-377",
    ["A descrição do cartão não aceita bloco de código"],
    "cinzel-editor",
  ),
  capture("f16", "skedly-agenda", "pt-BR", "Agenda semanal do Skedly", "https://skedly.app/agenda/semana?inicio=2026-10-12", [
    "O feriado de 12 de outubro não aparece na agenda",
  ]),
  capture("f17", "skedly-agenda", "en", "New appointment — Skedly", "https://skedly.app/en/agenda/new", ["Time slots after 6pm are hidden"]),
  capture(
    "f18",
    "skedly-agenda",
    "pt-BR",
    "Agenda do dia — Skedly",
    "https://skedly.app/agenda/dia?data=2026-10-15",
    ["A consulta já paga não mostra o selo de pago na agenda"],
    "skedly-faturas",
  ),
  capture("f19", "skedly-faturas", "pt-BR", "Faturas do Skedly", "https://skedly.app/faturas?ano=2026", ["A fatura de outubro aparece duplicada na lista"]),
  capture("f20", "skedly-faturas", "en", "Invoices — Skedly", "https://skedly.app/en/invoices", ["The invoice PDF shows the wrong tax ID"]),
  capture(
    "f21",
    "skedly-faturas",
    "pt-BR",
    "Forma de pagamento — Skedly",
    "https://skedly.app/faturas/pagamento",
    ["O formulário do cartão não valida a data de validade"],
    "aurora-checkout",
  ),
  capture("f22", "aurora-checkout", "pt-BR", "Carrinho — Loja Aurora", "https://loja-aurora.com.br/carrinho", ["Remover um item não atualiza o total"]),
  capture("f23", "aurora-checkout", "en", "Checkout — Aurora Store", "https://loja-aurora.com.br/en/checkout/payment", ["The card form rejects valid Amex numbers"]),
  capture(
    "f24",
    "aurora-checkout",
    "pt-BR",
    "Carrinho — Loja Aurora",
    "https://loja-aurora.com.br/carrinho?passo=revisao",
    ["A foto do produto no carrinho aparece cortada"],
    "aurora-catalogo",
  ),
  capture("f25", "aurora-catalogo", "pt-BR", "Saias — Loja Aurora", "https://loja-aurora.com.br/saias", ["Ordenar por menor preço não funciona"]),
  capture("f26", "aurora-catalogo", "en", "Floral midi dress — Aurora Store", "https://loja-aurora.com.br/en/product/floral-midi-dress", [
    "The size chart modal can't be closed on mobile",
  ]),
  capture(
    "f27",
    "aurora-catalogo",
    "pt-BR",
    "Vestido longo azul — Loja Aurora",
    "https://loja-aurora.com.br/produto/vestido-longo-azul",
    ["A página do produto não mostra se o tamanho M está disponível"],
    "aurora-checkout",
  ),
  capture("f28", "tinta-artigos", "pt-BR", "Por que usar embeddings — Blog Tinta", "https://blogtinta.com.br/embeddings", [
    "O bloco de código sai do container no celular",
  ]),
  capture("f29", "tinta-artigos", "en", "Archive — Blog Tinta", "https://blogtinta.com.br/en/archive", ["Tag pages have no title"]),
  capture(
    "f30",
    "tinta-artigos",
    "pt-BR",
    "Tipografia para leitura longa — Blog Tinta",
    "https://blogtinta.com.br/tipografia#exemplos",
    ["Os exemplos de fonte não carregam a fonte certa"],
    "cinzel-editor",
  ),
  capture("n01", null, "pt-BR", "Internet Banking — Banco Horizonte", "https://banco-horizonte.com.br/login", ["O teclado virtual da senha cobre o botão Entrar"]),
  capture("n02", null, "en", "Weather in Lisbon", "https://weather.example.com/lisbon", ["The hourly chart has no axis labels"]),
  capture("n03", null, "pt-BR", "Receita de pão de queijo — Cozinha Fácil", "https://cozinhafacil.com.br/pao-de-queijo", [
    "A lista de ingredientes some ao imprimir",
  ]),
  capture("n04", null, "pt-BR", "Segunda via do IPTU — Prefeitura", "https://prefeitura.example.gov.br/iptu/segunda-via", ["O captcha não carrega"]),
  capture("n05", null, "en", "Pull request #88 — acme/api", "https://github.com/acme/api/pull/88", ["The diff view wraps long lines badly"]),
  capture(
    "n06",
    null,
    "pt-BR",
    "Recarga de celular — Operadora Lume",
    "https://lume.example.com.br/recarga",
    ["O Pix copia e cola não copia o código"],
    "aurora-checkout",
  ),
  capture(
    "n07",
    null,
    "pt-BR",
    "Calendário acadêmico — Universidade Federal",
    "https://universidade.example.edu.br/calendario",
    ["As datas das provas estão no formato americano"],
    "skedly-agenda",
  ),
  capture("n08", null, "en", "Directions — Maps", "https://maps.example.com/dir", ["The route summary overlaps the zoom buttons"]),
  capture(
    "n09",
    null,
    "pt-BR",
    "Planilha de orçamento — Planilhas Online",
    "https://planilhas.example.com/orcamento",
    ["A célula com fórmula não mostra o resultado"],
    "cinzel-editor",
  ),
  capture("n10", null, "pt-BR", "Política — Jornal da Cidade", "https://jornaldacidade.example.com.br/politica", ["O anúncio cobre o título da matéria"]),
];

// The candidates chooseCollection would get for these collections: up to 3
// titles of the most recent sessions as examples (A31) and the last capture
// as lastUsedAt (A32).
export function filingCandidates(collections: FilingBenchCollection[] = FILING_BENCH_COLLECTIONS): FilingCandidate[] {
  return collections.map((collection) => {
    const recent = [...collection.sessions].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
    return {
      collectionId: collection.collectionId,
      examples: recent.slice(0, 3).map((item) => item.page.title),
      label: collection.label,
      lastUsedAt: recent[0]?.capturedAt ?? null,
    };
  });
}
