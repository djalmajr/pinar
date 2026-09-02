import type { HelpLocale } from "../help-content";

const locale = {
  ui: {
    articlesFound:
      "{count, plural, one {# artigo encontrado} other {# artigos encontrados}}",
    articleGuide: "Neste guia",
    articleNotFound: "Artigo não encontrado",
    articleNotFoundDescription: "Esse artigo não existe.",
    backToHelp: "Voltar à Central de Ajuda",
    breadcrumb: "Navegação estrutural",
    categories: "Categorias",
    categoryArticles: "artigos",
    categoryNotFound: "Categoria não encontrada",
    categoryNotFoundDescription: "Essa categoria não existe.",
    explore: "Explorar",
    help: "Ajuda",
    helpCategories: "Categorias da ajuda",
    helpNavigation: "Navegação da ajuda",
    homeDescription:
      "Orientação baseada na documentação, no histórico do projeto e no comportamento realmente implementado.",
    homeHeading: "Como podemos ajudar?",
    homeMetaDescription:
      "Aprenda a capturar, organizar, compartilhar e revisar feedback visual com o Pinar.",
    homeMetaTitle: "Central de Ajuda do Pinar",
    minutes: "min",
    noArticlesFound: "Nenhum artigo encontrado.",
    notFoundDescription:
      "Use a Central de Ajuda para encontrar o conteúdo publicado.",
    onThisPage: "Neste artigo",
    openScreenshot: "Abrir screenshot em tamanho completo",
    pageTitleSuffix: "Ajuda do Pinar",
    popularArticles: "Artigos populares",
    popularDescription:
      "Os caminhos mais usados para começar e fechar uma revisão.",
    searchLabel: "Pesquisar na Central de Ajuda",
    searchPlaceholder: "Pesquise capturas, agentes, planos…",
    searchResults: "Resultados da pesquisa",
    seeAllCategory: "Ver todos da categoria",
    stillNeedContext: "Ainda precisa de contexto?",
    visualExample: "Exemplo visual:",
  },
  categories: {
    "getting-started": {
      title: "Comece aqui",
      description:
        "Instale o Pinar, faça a primeira captura e escolha onde seu trabalho fica.",
    },
    captures: {
      title: "Capturas e pins",
      description:
        "Selecione páginas com precisão, anote, mascare áreas sensíveis e reabra o resultado.",
    },
    agents: {
      title: "Agentes de IA",
      description:
        "Envie contexto visual para agentes de código e feche o ciclo de revisão com segurança.",
    },
    workspace: {
      title: "Projetos e coleções",
      description:
        "Organize, pesquise, mova, compartilhe e revise sessões de captura.",
    },
    cloud: {
      title: "Nuvem e planos",
      description:
        "Entenda contas, planos, créditos, armazenamento, retenção e compartilhamento público.",
    },
    privacy: {
      title: "Privacidade e dados",
      description:
        "Saiba o que o Pinar guarda, o que remove e quais controles ficam em suas mãos.",
    },
  },
  screenshots: {
    "sign-in-extension": {
      alt: "Tela de acesso do Pinar com o fluxo de pareamento por código da extensão selecionado.",
      caption:
        "O fluxo da extensão aceita o código temporário mostrado pelo Pinar e conecta o navegador sem senha.",
    },
    "capture-workspace": {
      alt: "Workspace do Pinar com cartões de sessões anotadas, contagem de pins, projetos, coleções, busca e controles da conta.",
      caption:
        "O workspace reúne páginas capturadas, contagem de pins, projetos, coleções, busca e estado da conta em uma visão operacional.",
    },
    "getting-started": {
      alt: "Página pública do Pinar com o fluxo local-first, acesso ao workspace e navegação para os planos.",
      caption:
        "Comece pela entrada pública do Pinar para abrir o workspace local, entender o fluxo de captura ou comparar os planos de nuvem.",
    },
    "help-navigation": {
      alt: "Artigo de ajuda do Pinar com navegação por categorias, links de artigos relacionados, seções estruturadas e navegação na página.",
      caption:
        "As páginas de ajuda mantêm juntos a categoria, os procedimentos relacionados, as seções do artigo e os caminhos de recuperação.",
    },
    privacy: {
      alt: "Central jurídica do Pinar com Termos, Privacidade, Uso Aceitável, Retenção de Dados, Reembolso, Fair Source e subprocessadores.",
      caption:
        "A central jurídica reúne regras de dados, retenção, uso aceitável, reembolso, licenciamento e subprocessadores em um local auditável.",
    },
    "workspace-table": {
      alt: "Tabela do workspace do Pinar com busca, filtros, contagem de pins, datas de criação, paginação e ações por linha.",
      caption:
        "A visão em tabela organiza busca, filtros, contagem de pins, datas, paginação e ações de sessão em um fluxo fácil de percorrer.",
    },
    "sign-in-email": {
      alt: "Tela de acesso à conta do Pinar com o fluxo de código por e-mail selecionado.",
      caption:
        "Contas registradas solicitam um código temporário por e-mail e concluem a verificação na mesma tela de acesso.",
    },
    pricing: {
      alt: "Página de preços do Pinar comparando Free, Pro anual, Founder, adicionais de armazenamento e opções de créditos de IA.",
      caption:
        "A área de preços mostra limites dos planos, periodicidade de cobrança, adicionais de armazenamento e compras de créditos de IA antes do checkout.",
    },
    updates: {
      alt: "Detalhe de versão do Pinar mostrando data, versão, mudanças e navegação para versões anterior e seguinte.",
      caption:
        "As notas de versão publicadas tornam o comportamento instalado e as mudanças operacionais rastreáveis por versão.",
    },
  },
  articles: {
    "install-pinar": {
      title: "Instalar o Pinar",
      summary:
        "Adicione a extensão oficial do Chrome e conecte o produto local compatível com sua plataforma.",
      sections: [
        {
          heading: "Extensão do navegador",
          paragraphs: [
            "Instale o Pinar pela Chrome Web Store. Esse é o caminho oficial da extensão; um checkout do GitHub ou uma pasta unpacked não são necessários para o uso normal.",
          ],
          bullets: [
            "Fixe o ícone do Pinar no menu de extensões do Chrome para mantê-lo visível.",
            "A extensão aceita a origem publicada pinar.dev e os servidores locais do Pinar.",
          ],
        },
        {
          heading: "Produto local",
          paragraphs: [
            "No macOS, o Pinar.app fica na barra de menus, executa o helper integrado, registra hooks de agentes compatíveis e verifica atualizações no GitHub Releases. Windows e Linux usam hoje o instalador do helper independente, não um app desktop.",
          ],
          bullets: [
            "Screenshots normalmente ficam em `~/.pinar/shots` e o histórico em `~/.pinar/history.db`. A ação Abrir pasta do app abre esse diretório; PINAR_HOME pode substituí-lo.",
            "O helper percorre as portas 17373 a 17382 em 127.0.0.1 e reconhece o Pinar por GET `/api/health`. PINAR_PORT fixa a descoberta em uma porta.",
            "Iniciar no login usa um LaunchAgent do usuário no macOS. O Pinar recorre ao caminho antigo do launchctl em sistemas mais velhos e mantém logs no diretório do Pinar.",
            "Se o helper local estiver indisponível, os recortes de imagem vão para Downloads/pinar.",
          ],
        },
        {
          heading: "Confirme o helper e abra o workspace",
          paragraphs: [
            "Com a extensão fixada, instale o produto local pelo caminho documentado: arraste a imagem de disco do macOS para ~/Applications, execute o instalador PowerShell no Windows ou o instalador curl no Linux. Esses scripts colocam o helper em ~/.pinar/bin (ou %USERPROFILE%\\.pinar\\bin), adicionam esse diretório ao PATH e executam pinar install-hooks para que os agentes recebam as capturas coladas.",
            "No macOS, o Pinar.app esconde o ícone do Dock, mantém uma única instância com ~/.pinar/tray.pid e inicia o helper com pinar ensure se GET `/api/health` ainda não devolver ok true e service pinar. Use Iniciar ou Reiniciar na barra de menus quando o status estiver Off e, em seguida, Abrir workspace para carregar http://127.0.0.1:<port>/app. Execute de novo pinar install-hooks no helper se um agente deixar de ver as instruções coladas.",
          ],
          bullets: [
            "Instalação no Windows: irm https://pinar.dev/install.ps1 | iex. No Linux: curl -fsSL https://pinar.dev/install.sh | sh. O script precisa de curl ou wget para baixar o binário.",
            "Um helper saudável responde GET `/api/health` com ok true e service pinar. No macOS, Abrir workspace usa essa porta descoberta no caminho /app.",
            "A extensão do Chrome não grava `~/.pinar/shots` sozinha. Se os recortes não forem para essa pasta, inicie o produto local e capture de novo.",
          ],
        },
      ],
    },
    "first-capture": {
      title: "Fazer a primeira captura",
      summary:
        "Pine um elemento ou uma área visível, escreva o feedback e copie um único pacote correlacionado.",
      sections: [
        {
          heading: "Pine a página",
          paragraphs: [
            "Abra a página, selecione a extensão Pinar e clique em um elemento ou arraste uma área livre. Escreva o comentário e pressione Enter para adicionar o pin.",
          ],
          bullets: [
            "Repita a seleção para colocar vários pins numerados na mesma captura.",
            "Shift+Enter adiciona uma quebra de linha; Escape fecha o rascunho sem apagar os outros pins.",
          ],
        },
        {
          heading: "Copie o pacote",
          paragraphs: [
            "Pressione Command+Enter no macOS ou Ctrl+Enter nos outros sistemas. O Pinar copia Markdown legível, HTML e um bloco JSON pinar-visual-context que apontam para o mesmo screenshot e para as mesmas identidades de pins.",
          ],
        },
        {
          heading: "Conclua a cópia e preserve as identidades",
          paragraphs: [
            "Command/Ctrl+Enter só copia depois que pelo menos um pin tem comentário. A sobreposição mostra Copying…, esconde os pins para o screenshot e depois Copied, e a barra fecha. Clicar no ícone da extensão depois só mostra ou esconde a sobreposição; não apaga pins já colocados. Se todos os caminhos de cópia falharem, a sobreposição volta para você tentar de novo.",
            "Trate o payload da área de transferência como uma unidade: instruções legíveis, URL opcional do visualizador e um bloco JSON pinar-visual-context com `captureId`, `pinId`, URL da página, localizadores (cssSelector, domPath, innerText) e a URL do screenshot quando o helper gravou o arquivo. Os badges numerados na imagem são sobreposições de anotação, não UI da página. Não reescreva `captureId` nem `pinId` ao colar em um agente. A linha Screenshot: /path/to/file.png, quando existir, é o único recorte com todos os pins.",
          ],
          bullets: [
            "Um composer vazio ou uma captura sem pins aborta a cópia e mostra Write a comment first ou Add a pin first.",
            "Cópias degradadas ainda colam comentários e localizadores, mas a barra pode acrescentar no screenshot, helper unavailable ou no viewer depois de Copied.",
            "Prefira um helper em execução para os PNG irem a `~/.pinar/shots` e o pacote poder incluir o link do visualizador /v/<id>.md para o contexto completo.",
          ],
        },
      ],
    },
    "local-or-cloud": {
      title: "Escolher armazenamento local ou na nuvem",
      summary:
        "Use o workspace local offline ou conecte uma conta para armazenamento gerenciado e compartilhamento na nuvem.",
      sections: [
        {
          heading: "Local",
          paragraphs: [
            "O modo local mantém o histórico em SQLite e os screenshots na sua máquina. A API loopback aceita apenas origens locais ou da extensão confiáveis e usa um token de capacidade protegido no sistema de arquivos.",
          ],
        },
        {
          heading: "Nuvem",
          paragraphs: [
            "O modo na nuvem armazena dados da conta no D1 e screenshots no R2. Ele habilita acesso remoto ao workspace, retenção gerenciada, resumos por IA, cobrança e links não listados. O consentimento jurídico é obrigatório antes da persistência remota.",
          ],
        },
        {
          heading: "Como as sessões local e na nuvem realmente abrem",
          paragraphs: [
            "O histórico local sempre pertence ao owner local. No primeiro uso o banco cria um projeto protegido Personal e uma coleção protegida Inbox, que não podem ser aninhados ou apagados como os criados por você. As capturas salvas ficam isPermanent true com plan free, os PNG vão para o diretório shots do Pinar e a API loopback os apresenta em /shots/<id>.png e /v/<id>.md. Mutar essa API exige o segredo em ~/.pinar/local-capability.json, enviado como x-pinar-capability ou Authorization Bearer. O arquivo é gravado com modo 0600; a rotação mantém o segredo anterior válido por 24 horas, salvo PINAR_CAPABILITY_GRACE_MS.",
            "A persistência na nuvem é bloqueada até aceitar as versões atuais de Termos, Privacidade e Uso Aceitável; a API devolve HTTP 428 com code legal_acceptance_required. O Free remoto registra a instalação e pode emitir um código de pareamento de cinco minutos e uso único para abrir /app. Contas pagas ou que já pagaram também verificam um código de e-mail de seis dígitos. Cookies do navegador duram 30 dias; dispositivos autenticados da extensão, 180. O Markdown não listado permanece público em /v/, /p/ e /c/, e os screenshots em /shots/.",
          ],
          bullets: [
            "O GET local /api/local/capability devolve o token atual; rotate e revoke são endpoints POST no mesmo prefixo /api/local/capability.",
            "O SQLite fica em `history.db` no diretório do Pinar; se o SQLite não abrir, o histórico recorre a `history.json` nesse mesmo diretório.",
            "Links de compartilhamento na nuvem não exigem sessão do workspace: quem tiver a URL não listada lê o Markdown ou o PNG em /v/, /p/, /c/ ou /shots/.",
          ],
        },
      ],
    },
    "shortcuts-and-navigation": {
      title: "Atalhos de teclado",
      summary:
        "Capture, percorra o DOM, masque conteúdo e copie sem sair do teclado.",
      sections: [
        {
          heading: "Durante a captura",
          paragraphs: [
            "O Pinar intercepta apenas os atalhos da captura ativa para que a página não receba a mesma tecla.",
          ],
          bullets: [
            "Enter pina o elemento sob o cursor; Seta para cima seleciona o pai e Seta para baixo retorna ao filho.",
            "M alterna o desenho de máscaras de privacidade. Escape cancela um rascunho ou máscara; sem rascunho, limpa os pins e esconde a barra.",
            "Command/Ctrl+Enter copia o pacote concluído.",
            "Alt+Shift+P mostra ou esconde a toolbar sem cancelar a sessão, e você pode redefini-lo em `chrome://extensions/shortcuts`. Atalhos do navegador ficam inertes em páginas `chrome://`, na Chrome Web Store e antes de o overlay ser injetado.",
          ],
        },
        {
          heading: "Páginas que disputam foco",
          paragraphs: [
            "Em sites com focus traps agressivos, o Pinar tenta focar o campo de comentário algumas vezes e depois para, em vez de travar a aba. Clique diretamente no campo se a página continuar roubando o foco.",
          ],
        },
        {
          heading: "Detalhes da sobreposição, do ícone e do passeio no DOM",
          paragraphs: [
            "Os atalhos só são capturados com a sobreposição ativa. O ícone da extensão alterna essa sobreposição; ele não apaga pins. Passar o cursor na barra sem um rascunho aberto a deixa atravessar cliques para você ainda clicar ou arrastar a página por baixo. Shift+Enter insere quebra de linha no composer, e atalhos da página digitados ali não saem do campo de comentário.",
            "Seta para cima sobe ao elemento pai e lembra o filho que você deixou, então Seta para baixo volta a esse nó lembrado se ele ainda for filho; senão usa o primeiro filho. No modo máscara, arraste uma região para escondê-la e clique numa máscara existente para restaurá-la. A rolagem pelo teclado continua no documento, mas teclas dirigidas a controles da página são bloqueadas para não ativar botões nem digitar no formulário.",
          ],
          bullets: [
            "Command/Ctrl+Enter grava o rascunho aberto e depois copia; sem comentário mostra Write a comment first em vez de enviar um pin vazio.",
            "Depois de Escape ou da cópia, o Pinar continua dono dessa tecla física no keyup para a página não tratar o mesmo toque como cancelar ou enviar.",
            "Um pin de área só começa depois que o ponteiro anda cerca de seis pixels; um clique mais curto ainda pina o elemento sob o cursor em vez de abrir um retângulo livre.",
          ],
        },
      ],
    },
    "capture-types": {
      title: "Capturas de elemento, área, página inteira e iframe",
      summary:
        "Escolha o menor modo de captura que ainda preserve o contexto necessário para a revisão.",
      sections: [
        {
          heading: "Modos de seleção",
          paragraphs: [
            "A captura de elemento registra uma impressão DOM resiliente e a caixa exata. A captura de área cobre um retângulo livre quando nenhum elemento representa o feedback. A página inteira percorre e costura o documento. A captura em iframe preserva limites e deslocamentos de frames.",
          ],
          bullets: [
            "Prefira um elemento quando o agente precisar identificar com precisão o código responsável.",
            "Prefira uma área para relações visuais entre vários elementos.",
          ],
        },
        {
          heading: "Clique, arraste e alvos em iframe",
          paragraphs: [
            "Clique um nó, ou pressione Enter no contorno atual, para abrir um pin de elemento. Arraste um retângulo de pelo menos seis pixels para abrir um pin de área. O clique inicial em um iframe ou frame é ignorado para que o documento interno faça a seleção.",
            "Pins de elemento registram impressão digital, seletor e um caminho DOM que une frames ancestrais com um delimitador de fronteira. Pins de área guardam o retângulo e um rótulo em pixels, sem localizador. O screenshot copiado ainda costura em torno da união de todos os pins, inclusive os colocados em frames filhos.",
          ],
          bullets: [
            "A barra de captura permanece no frame superior; frames filhos mostram só marcadores e o compositor de comentário.",
            "Se o frame pai não responder com o caminho, o pin guarda apenas o caminho do documento interno.",
            "Elementos fixed ou sticky ficam marcados como ancorados na viewport para a reabertura não tratá-los como caixas roladas no documento.",
          ],
        },
      ],
    },
    "pins-and-comments": {
      title: "Pins, comentários e cores",
      summary:
        "Use pins numerados como referências estáveis entre screenshot, texto e contexto estruturado.",
      sections: [
        {
          heading: "Uma captura compartilhada",
          paragraphs: [
            "Cada badge numerado no screenshot corresponde a um comentário e a um registro de pin. A paleta rotativa separa marcadores próximos sem alterar sua identidade.",
          ],
        },
        {
          heading: "Preserve a correlação",
          paragraphs: [
            "Não reescreva `captureId` nem `pinId` ao enviar o pacote para outra ferramenta. Esses campos permitem que workspace, visualizador, resultado do agente e histórico de revisão apontem para a mesma captura.",
          ],
        },
        {
          heading: "Como números e identidades são atribuídos",
          paragraphs: [
            "Um pin só é salvo depois que o comentário é aparado e não fica vazio. Pins novos recebem um UUID, um número a partir de 1 na ordem da captura e uma cor da paleta de onze tons nesse número. Badges próximos diferem visualmente sem mudar a identidade que cada um guarda.",
            "O contexto estruturado mantém `pinId` a partir do `pinId` ou id existente. Quando esses campos faltam, o parser sintetiza `captureId`:pN a partir da identidade da captura e do número do pin. Ferramentas seguintes podem então apontar para o mesmo screenshot, comentário e linha de revisão.",
          ],
          bullets: [
            "Um compositor vazio não pode ser copiado; o foco permanece no campo até existir um comentário.",
            "Ao passar o cursor no marcador, a página mostra número, comentário e a confiança atual do localizador.",
            "Editar um pin existente atualiza só o comentário; o id armazenado permanece o mesmo.",
          ],
        },
      ],
    },
    "full-page-capture": {
      title: "Capturar uma página inteira",
      summary:
        "Crie um screenshot longo enquanto o Pinar controla rolagem, escala e conteúdo fixo repetido.",
      sections: [
        {
          heading: "Como a costura funciona",
          paragraphs: [
            "O Pinar planeja quadros da viewport, percorre o documento, suprime temporariamente elementos sticky ou fixed repetidos, renderiza na escala do dispositivo e restaura a página ao final.",
          ],
        },
        {
          heading: "Quando o resultado diverge",
          paragraphs: [
            "Conteúdo carregado sob demanda, layouts animados, frames cross-origin e páginas que mudam durante a rolagem podem produzir lacunas ou áreas não resolvidas. Aguarde a página estabilizar, tente novamente ou capture a área afetada separadamente.",
          ],
        },
        {
          heading: "Tiles da viewport e restauração do layout",
          paragraphs: [
            "O Pinar planeja as posições de rolagem a partir da união das caixas dos pins mais o padding e captura cada tile PNG da altura da viewport pela API de screenshot da aba. Tiles seguintes esperam um pouco para a página pintar, e o canvas composto usa a densidade de pixels inferida da largura do primeiro tile versus a viewport CSS.",
            "Antes do primeiro tile, nós sticky e fixed são reescritos para não se repetirem em cada quadro. Os estilos inline originais e a rolagem são restaurados mesmo se a composição falhar. Coordenadas de pins e máscaras são deslocadas para a origem da captura antes do recorte.",
          ],
          bullets: [
            "Nós fixed passam a position absolute na caixa medida, com transforms zerados para o screenshot não deslocá-los duas vezes.",
            "Nós sticky passam a position relative durante a passagem de captura.",
            "A rolagem dos tiles usa scroll-behavior instantâneo para o documento não animar entre os quadros.",
          ],
        },
      ],
    },
    "smart-selection": {
      title: "Localizadores inteligentes e seleção DOM",
      summary:
        "Entenda como um pin acompanha um elemento depois que a página muda e por que o Pinar pode pedir posicionamento manual.",
      sections: [
        {
          heading: "Impressões resilientes",
          paragraphs: [
            "Um pin de elemento combina seletor estável, caminho DOM, tag, id, name, test id, role, classes, texto, label e geometria. Ao reabrir, o Pinar avalia seletor, estrutura, semântica e geometria em vez de confiar em um único caminho frágil.",
          ],
        },
        {
          heading: "Confiança e ambiguidade",
          paragraphs: [
            "Uma correspondência pode ser exata, provável, ambígua ou não resolvida. Quando dois candidatos são parecidos demais, o Pinar mantém alternativas em vez de encaixar o pin no elemento errado. Alvos em iframe cross-origin podem ficar não resolvidos.",
          ],
        },
        {
          heading: "Fallback de seletor e correspondências concorrentes",
          paragraphs: [
            "Na captura, o Pinar prefere um seletor que case o nó de forma única por id, data-testid ou data-test, ou tag mais name. Se nenhum for único, guarda um caminho CSS estrutural. Classes que parecem geradas saem da impressão para módulos CSS com hash não virarem o único sinal.",
            "Na reabertura, candidatos das estratégias stable-selector, structure, semantic e geometry são unidos e ranqueados. Confiança exata exige um acerto alto de seletor estável ou estrutura; semantic e geometry permanecem prováveis. Quando as duas melhores pontuações viáveis diferem por uma margem estreita, o resultado fica ambíguo e nenhum elemento é escolhido.",
          ],
          bullets: [
            "Um seletor posicional :nth-of-type perde pontos quando outros nós compartilham a mesma tag, texto e classes.",
            "Pins de área são rejeitados como alvos de elemento e permanecem não resolvidos na pontuação do localizador.",
            "Quando o contentDocument de um iframe não é legível, a realocação para com o aviso cross-origin-frame em vez de adivinhar.",
          ],
        },
      ],
    },
    "privacy-masks": {
      title: "Mascarar áreas sensíveis",
      summary:
        "Cubra regiões visuais antes que o screenshot seja serializado ou enviado.",
      sections: [
        {
          heading: "Desenhe uma máscara",
          paragraphs: [
            "Pressione M com o modo de captura ativo e arraste sobre a região sensível. Máscaras do usuário são aplicadas à imagem antes do armazenamento; remova uma máscara equivocada antes de copiar.",
          ],
        },
        {
          heading: "Máscaras complementam a redação",
          paragraphs: [
            "A sanitização automática trata campos DOM sensíveis e partes da URL. Máscaras manuais cobrem conteúdo visual que o software não classifica com segurança, como gráficos, avatares ou dados renderizados em canvas.",
          ],
        },
        {
          heading: "Como as máscaras chegam à imagem salva",
          paragraphs: [
            "O desenho de máscara fica indisponível enquanto um rascunho de comentário está aberto. Um arraste válido guarda uma máscara do usuário em coordenadas do documento para acompanhar a rolagem, e clicar nesse overlay remove. Caixas automáticas da varredura de privacidade são combinadas com esses retângulos antes da cópia.",
            "As regiões combinadas viajam com a mensagem de captura para serem pintadas no screenshot antes da área de transferência ou do armazenamento. A sanitização à parte ainda reda segredos conhecidos em URLs, valores de campos e texto dos pins; as máscaras cobrem pixels que essas regras de string não classificam.",
          ],
          bullets: [
            "Máscaras do usuário usam um id único e a categoria manual para poderem ser apagadas sem as caixas automáticas.",
            "Máscaras automáticas de campo são dispensadas, não apagadas, para varreduras seguintes ainda reportarem o campo.",
            "Escape sai do desenho de máscara sem descartar os pins já colocados na página.",
          ],
        },
      ],
    },
    "copy-and-reopen": {
      title: "Copiar, visualizar e reabrir uma captura",
      summary:
        "Vá da página ativa ao workspace e volte sem perder as âncoras originais.",
      sections: [
        {
          heading: "Controles do visualizador",
          paragraphs: [
            "O visualizador aceita arraste, zoom pela roda ancorado no cursor, zoom por duplo clique e controles de 50% a 800%. Selecionar um pin abre abas de Preview renderizado e Markdown Raw literal.",
          ],
          bullets: [
            "Baixe o screenshot ou copie o Markdown da sessão pelo visualizador.",
            "Abra o Markdown público no ChatGPT ou Claude pelo menu do visualizador quando o compartilhamento estiver disponível.",
          ],
        },
        {
          heading: "Revisar na página original",
          paragraphs: [
            "Revisar na página abre a origem capturada e reidrata os pins. O Pinar rejeita divergência de origem, preserva cada âncora e caixa histórica, registra o histórico de realocação e permite reposicionar manualmente um pin não resolvido.",
          ],
        },
        {
          heading: "Cópia no visualizador e checagem de origem",
          paragraphs: [
            "Copiar página no visualizador grava o mesmo pacote Markdown correlacionado da página ao vivo, no modo compact ou full das preferências, com `captureId` caindo para o id da sessão. O menu abre o Markdown público em /v/{id}.md, ou inicia ChatGPT ou Claude com um prompt apontando para essa URL.",
            "Revisar na página dispara um evento de reabertura com o id da sessão. O helper hidrata só a partir de uma URL confiável do app Pinar quando esse id casa com o id da sessão ou o `captureId` e a origem da aba ainda é a da página capturada. Sair dessa origem descarta o vínculo em vez de injetar pins no site errado.",
          ],
          bullets: [
            "Se nenhum resultado de reabertura chegar, o visualizador mostra um aviso de helper ausente em vez de esperar indefinidamente.",
            "Visualizadores públicos ou antigos que não leem preferências ainda copiam no modo compact de handoff.",
            "Uma aba que ainda está em about:blank mantém o vínculo de hidratação; só uma origem diferente o descarta.",
          ],
        },
      ],
    },
    "send-to-agent": {
      title: "Enviar contexto visual a um agente",
      summary:
        "Cole o pacote completo do Pinar para o agente ver comentário, alvo, geometria e imagem compartilhada juntos.",
      sections: [
        {
          heading: "O que colar",
          paragraphs: [
            "O Pinar grava Markdown simples e HTML na área de transferência. O texto inclui anotações legíveis e um bloco JSON pinar-visual-context. Cole tudo como uma unidade; o bloco estruturado é a fonte de verdade legível pela máquina.",
          ],
        },
        {
          heading: "Screenshot e avisos",
          paragraphs: [
            "Se o pacote listar um caminho absoluto em Screenshot, o agente local deve abrir essa imagem única; os badges numerados são overlays. Avisos como `screenshot_missing`, `helper_unavailable` ou `viewer_unavailable` descrevem uma entrega degradada, mas não invalidam comentários e contexto DOM.",
          ],
        },
        {
          heading: "Como entregar o pacote copiado a um agente",
          paragraphs: [
            "A extensão do Chrome nunca digita no compositor do agente. Depois de Command/Ctrl+Enter, cole você mesmo a área de transferência no Cursor, Claude, Codex ou Grok. O texto começa com instruções para implementar os comentários dos pins e tratar seletor e caminho DOM como localizadores complementares, seguidas de um bloco JSON pinar-visual-context. Se houver URL de Viewer, busque-a só quando esses detalhes não bastarem.",
            "Trate `captureId` e `pinId` como identidade, não como rótulos a reescrever. O Visual Context grava hoje schemaVersion 1; o parseVisualCapture rejeita `captureId` ausente e qualquer schemaVersion que não seja 1 ou o legado 0. Altere só o que os pins descrevem. Se a pessoa não colou, peça para copiar de novo no Pinar em vez de reconstruir pins de memória.",
          ],
          bullets: [
            "Cole a área de transferência inteira no agente; não redigite comentários nem invente um `captureId` novo.",
            "Confirme que o texto colado ainda contém a cerca fechada pinar-visual-context antes de editar código.",
            "Se nada foi colado, peça Command/Ctrl+Enter no Pinar e implemente somente os comentários dos pins.",
          ],
        },
      ],
    },
    "handoff-formats": {
      title: "Formatos e destinos do handoff",
      summary:
        "Escolha contexto compacto ou completo e uma apresentação específica por agente sem mudar a identidade da captura.",
      sections: [
        {
          heading: "Compacto e completo",
          paragraphs: [
            "O modo compacto remove ruído redundante de localizadores e geometria, preservando a correlação. O modo completo mantém o payload integral. Outra preferência inclui ou omite screenshots; desabilitá-los preserva metadados, pins, localizadores, revisão e handoff sem armazenar a imagem. Dados inline são removidos do texto para evitar prompts enormes. O diálogo Configurações do workspace sincroniza essas preferências com o backend ativo.",
          ],
        },
        {
          heading: "Adaptadores de agentes",
          paragraphs: [
            "O Pinar pode adaptar o preâmbulo e o formato Markdown para Claude, Codex, Grok e outros destinos compatíveis. O contrato de `captureId`, `pinId` e visual-context permanece o mesmo.",
          ],
        },
        {
          heading:
            "Escolher o modo de entrega nas opções da extensão antes de copiar",
          paragraphs: [
            "Nas opções da extensão, um interruptor define handoffMode como full quando ligado e compact quando desligado. Compact é o padrão gravado e mantém cada fato útil uma vez: `pinId`, comentário, cssSelector, domPath e innerText, mais box ou coords só em pins de área ou sem localizador. Full mantém a captura integral. As duas projeções ainda removem URLs data: do screenshot no JSON; uma imagem inline vira URL nula e o aviso screenshot_inline para o prompt não inflar.",
            "Clique em salvar para que preferences:set grave handoffMode e `includeScreenshot` no backend ativo e no chrome.storage.sync. Valores desconhecidos de handoffMode voltam para compact; `includeScreenshot` começa ligado. Os destinos são cursor, claude, codex e grok: cada um prefixa o próprio preâmbulo, mas `captureId`, pinIds e comentários permanecem idênticos. O interruptor de copiar o conteúdo do visualizador fica desabilitado quando includeViewer está desligado.",
          ],
          bullets: [
            "Ajuste o interruptor compact/full e o de `includeScreenshot` e clique em salvar antes da próxima cópia.",
            "Deixe `includeScreenshot` ligado, salvo se você quiser metadados, pins, localizadores e handoff sem armazenar a imagem.",
            "Depois de salvar, copie uma vez e confirme que o paste de cada adaptador ainda compartilha o mesmo `captureId` e os mesmos pinIds.",
          ],
        },
      ],
    },
    "closed-loop-review": {
      title: "Fechar o ciclo de revisão do agente",
      summary:
        "Acompanhe o que o agente mudou, verifique como humano e reabra somente quando outra correção for necessária.",
      sections: [
        {
          heading: "Retorno do agente",
          paragraphs: [
            "Um agente pode reportar cada pin como alterado, bloqueado, não aplicável ou não localizado, com resumo, motivo, arquivos alterados, commit e pull request. Repetir a mesma entrega com a mesma chave de idempotência é seguro; conteúdo divergente nessa chave é rejeitado.",
          ],
        },
        {
          heading: "Verificação humana",
          paragraphs: [
            "Um resultado alterado move um pin aberto ou reaberto para correção pronta. Somente uma pessoa pode aceitar a correção ou reabrir um pin aceito. Agentes não aceitam o próprio trabalho e transições inválidas são rejeitadas.",
          ],
          bullets: [
            "Fluxo normal: aberto → correção pronta → aceito.",
            "Se a verificação falhar: aceito → reaberto → correção pronta.",
          ],
        },
        {
          heading: "Registrar uma execução e aceitá-la como humano",
          paragraphs: [
            "Faça POST em /api/agent-executions com agent igual a claude, codex, cursor ou grok, o `captureId` da captura, um idempotencyKey de 8 a 128 caracteres em [A-Za-z0-9_-] e um array results não vazio. Cada resultado precisa de um `pinId` que já exista na captura, um status e um summary de no máximo 2000 caracteres; files opcionais têm no máximo 50 caminhos, e pullRequest precisa ser uma URL http(s). Fingerprint divergente na mesma chave é idempotency_conflict (409). `pinId` desconhecido é pin_not_found (400) sem ecoar comentários da captura; `captureId` desconhecido é capture_not_found (404).",
            "A revisão humana é um POST separado em /api/sessions/{id}/pins/{`pinId`}/review com action accept ou reopen. humanActionsForStatus oferece accept só em correction_ready e reopen só em accepted; open e reopened não expõem ações humanas, e qualquer outra transição é invalid_transition (409). Depois de um reopen humano, uma segunda execução changed é o retry previsto. Deixe Share anonymous loop metrics desligado até optar: comentários, URLs, seletores e screenshots são rejeitados como forbidden_fields mesmo com optIn true.",
          ],
          bullets: [
            "Publique um resultado changed para o mesmo `captureId` e `pinId` e confirme no visualizador o status correction_ready antes de aceitar.",
            "Reutilize um idempotencyKey só com o mesmo fingerprint; gere uma chave nova quando arquivos, resumo ou status realmente mudarem.",
            "Se a verificação falhar, reabra como humano, publique um segundo resultado, aceite de novo e guarde os capture ids anterior e posterior.",
          ],
        },
      ],
    },
    "reopen-and-relocate": {
      title: "Reabrir e realocar pins",
      summary:
        "Revise a implementação na página ativa mesmo depois que o DOM mudar.",
      sections: [
        {
          heading: "Reidratação segura",
          paragraphs: [
            "O Pinar abre a página salva e hidrata somente quando a origem da aba corresponde exatamente à captura. Origens confiáveis do app podem pedir a reabertura, mas um site não relacionado não pode injetar uma sessão na extensão.",
          ],
        },
        {
          heading: "Correção manual",
          paragraphs: [
            "Se um alvo estiver ambíguo ou não resolvido, reposicione o pin manualmente. A âncora e a caixa originais permanecem congeladas no histórico, e cada realocação automática ou manual é registrada.",
          ],
        },
        {
          heading: "Abrir a URL original e posicionar pins pendentes",
          paragraphs: [
            "session:reopen só é aceito de uma origem confiável do app Pinar: https em pinar.dev ou um host *.pinar.dev, ou http em loopback nas portas 17373 a 17382. O helper busca /api/sessions/{id} e abre uma nova aba na URL salva. Qualquer outro site recebe untrusted_app. Um id que não coincide com session.id nem `captureId` é session_mismatch; captura sem page.url é missing_page. Depois do load, a hidratação injeta em todos os frames e mantém só os pins cujo caminho DOM pertence àquele frame.",
            "A hidratação continua só enquanto a origem da aba ainda coincide com a captura. Navegar para outro lugar solta o vínculo e mostra This page is not the original capture URL; about:blank é tratado como transitório e não solta. Correspondências ambíguas ou não resolvidas deixam a caixa ao vivo inalterada em vez de encaixar num sósio. Clique num pin pendente e depois no elemento correto: seletor, path e fingerprint permanecem congelados, a localização vira exact com evidência manual-reposition, e o locationHistory ganha uma entrada manual exact.",
          ],
          bullets: [
            "Inicie Revisar na página a partir do app Pinar para que só aquela sessão hidrate na origem capturada.",
            "Se o overlay disser This page is not the original capture URL, volte à origem capturada em vez de posicionar pins.",
            "Num pin não resolvido, clique no marcador, clique no elemento ao vivo e confirme que o locationHistory ganhou uma entrada manual exact.",
          ],
        },
      ],
    },
    "handoff-troubleshooting": {
      title: "Resolver avisos de cópia e handoff",
      summary:
        "Recupere-se de falhas da área de transferência, helper, screenshot ou visualizador sem perder as anotações.",
      sections: [
        {
          heading: "Recuperação da cópia",
          paragraphs: [
            "O Pinar usa primeiro a API de clipboard por um documento offscreen e recorre a uma seleção de texto oculta quando permissão ou foco bloqueiam a cópia. Se todos os mecanismos falharem, o overlay é restaurado para manter pins e comentários editáveis.",
          ],
        },
        {
          heading: "Degradado não significa sem correlação",
          paragraphs: [
            "`screenshot_missing` significa que a imagem não foi persistida. `helper_unavailable` indica que o serviço local não respondeu. `viewer_unavailable` indica que não houve URL do visualizador. Continue com comentário, caminho DOM, seletor, coordenadas, `captureId` e `pinId` e tente novamente apenas a camada ausente.",
          ],
        },
        {
          heading: "Percorrer o caminho da cópia quando a barra relata falha",
          paragraphs: [
            "A cópia exige um comentário salvo e pelo menos um pin. A barra mostra Copying…, esconde overlays, captura o shot e pede ao documento offscreen para gravar text/html e text/plain. O offscreen tenta navigator.clipboard.write e recorre a um evento copy com execCommand. Se essa gravação não for ok, o content script ainda tenta writePlainText no plain devolvido: clipboard.writeText e, depois, uma seleção oculta em textarea.",
            "Quando todos os caminhos de cópia falham, a página envia overlays:hidden com hidden false, mostra Copy failed e deixa os pins editáveis. Uma cópia bem-sucedida mostra Copied, ou Copied com no screenshot, helper unavailable ou no viewer, e então encerra a sessão. Esses sufixos correspondem a `screenshot_missing`, `helper_unavailable` e `viewer_unavailable`. screenshot_inline não é um dos avisos de handoff degradado. Um paste sem a cerca fechada pinar-visual-context não pode ser lido como JSON.",
          ],
          bullets: [
            "Se a barra disser Write a comment first ou Add a pin first, conclua o pin e pressione Command/Ctrl+Enter de novo.",
            "Se aparecer Copy failed, confirme que os pins ainda estão na página, conceda permissão de clipboard se pedirem e tente copiar de novo.",
            "Leia o sufixo de Copied: no screenshot, helper unavailable e no viewer nomeiam a camada ausente a retentar sem descartar comentários.",
          ],
        },
      ],
    },
    "organize-projects": {
      title: "Organizar projetos e sessões",
      summary:
        "Mova capturas sem perdê-las e mantenha Pessoal como destino protegido.",
      sections: [
        {
          heading: "Projetos e destino padrão",
          paragraphs: [
            "Projetos agrupam coleções e sessões. Pessoal é o projeto padrão protegido e Entrada é sua coleção protegida. Excluir outro projeto promove suas sessões ao destino padrão em vez de destruí-las.",
          ],
        },
        {
          heading: "Mover e ordenar",
          paragraphs: [
            "Arraste sessões entre coleções, reordene ou use Mover para em um conjunto selecionado. Em uma coleção, Mover antes e Mover depois ajustam a ordem manual salva.",
          ],
        },
        {
          heading: "Confirme onde a sessão movida realmente pousa",
          paragraphs: [
            "Abra uma coleção antes de usar Mover antes ou Mover depois. Essas ações só aparecem na visão de uma coleção, trocam a sessão com a vizinha na lista de posições salva e não fazem nada na primeira ou na última linha. O painel então envia essa lista completa de ids em POST para `/api/collections/{id}/sessions/reorder`. Sem uma coleção selecionada, a listagem ordena pela data de criação, não por essa ordem salva.",
            "O arraste começa no cartão ou na linha da tabela, não na busca, nas caixas de seleção ou no menu de ações (`data-no-dnd`). Se a sessão arrastada já estiver selecionada com outras, todos os ids selecionados viajam juntos; senão, só aquela sessão se move. Mover para pede um projeto e depois uma coleção na árvore achatada desse projeto; trocar o projeto limpa o campo da coleção, e um projeto sem coleções fica desabilitado. A sessão é acrescentada na próxima posição do destino. Excluir Pessoal é recusado; excluir outro projeto acrescenta as sessões em Entrada na ordem existente e remove as coleções daquele projeto.",
          ],
          bullets: [
            "Selecione uma coleção e use Mover antes ou Mover depois só quando houver vizinho; a primeira linha não sobe e a última não desce.",
            "Para mover várias sessões, selecione-as primeiro e arraste qualquer cartão selecionado ou abra Mover para; arrastar um cartão não selecionado move só aquela sessão.",
            "Depois de excluir um projeto que não é Pessoal, abra Pessoal / Entrada e procure no fim da lista as sessões acrescentadas antes de arquivá-las de novo.",
          ],
        },
      ],
    },
    "nested-collections": {
      title: "Usar coleções aninhadas",
      summary:
        "Crie uma hierarquia em cada projeto e reorganize sem achatar relações entre coleções.",
      sections: [
        {
          heading: "Árvore de coleções",
          paragraphs: [
            "Coleções podem ter coleções pai e filhas. Arrastar um ramo preserva profundidade e descendentes ao movê-lo dentro da árvore do projeto. Ciclos, pais desconhecidos e aninhamento sob um contêiner protegido são rejeitados. Excluir uma coleção pai promove suas filhas ao nível anterior na ordem existente.",
          ],
        },
        {
          heading: "Destinos pela captura",
          paragraphs: [
            "A extensão pode escolher projeto ou coleção antes de salvar na nuvem. Se o destino selecionado não estiver mais disponível, Pessoal/Entrada mantém a sessão acessível.",
          ],
        },
        {
          heading: "Indente um ramo e depois verifique o pai",
          paragraphs: [
            "Ao arrastar uma coleção, o deslocamento horizontal é medido em passos de recuo de 18 pixels. A profundidade projetada é limitada para não passar de um nível abaixo do irmão anterior nem ficar mais rasa que o irmão seguinte. Soltar um ramo sobre um descendente é ignorado e a árvore permanece. Coleções protegidas ficam na profundidade 0, e a lista ordenável trata filhas de uma coleção protegida como raízes para que não continuem aninhadas sob esse contêiner protegido.",
            "No seletor de destino da extensão, `destination:get` devolve um CaptureDestination (`projectId` e `collectionId`) e a árvore de projetos, com coleções aninhadas recuadas 16 pixels por nível. Trocar o projeto grava na hora a coleção protegida daquele projeto, se existir; senão, a primeira coleção. Se `destination:set` falhar, a página de opções mostra o erro de destino indisponível e recarrega `destination:get` para que uma coleção inexistente não continue selecionada. Uma árvore vazia mostra um placeholder desabilitado de Inbox.",
          ],
          bullets: [
            "Arraste uma coleção para a direita para aninhar sob o irmão anterior, ou para a esquerda rumo à raiz; se o soltar for recusado, a lista de parentId permanece.",
            "Recolha um pai só quando precisar de uma barra mais curta; os descendentes ocultos continuam na árvore e ainda se movem com o ramo arrastado.",
            "Depois de um erro ao salvar o destino, reabra as opções da extensão e confirme que projeto e coleção existem na árvore viva antes da próxima captura na nuvem.",
          ],
        },
      ],
    },
    "find-manage-share": {
      title: "Localizar, gerenciar e compartilhar sessões",
      summary:
        "Pesquise campos úteis, filtre revisões, aja em lote e publique apenas o que pretende.",
      sections: [
        {
          heading: "Pesquisa e visualizações",
          paragraphs: [
            "A pesquisa encontra título da página, URL, descrição, comentários dos pins e seletores CSS. Filtros de quantidade de pins e status de revisão podem ser combinados. Alterne entre cards e tabela; a tabela oferece 15, 30, 60 ou 100 linhas por página e lembra a escolha localmente.",
          ],
        },
        {
          heading: "Ações em lote e compartilhamento",
          paragraphs: [
            "Selecione sessões em qualquer visualização para mover ou excluir em conjunto. Excluir uma sessão é permanente: remove screenshot, execuções de agentes, resultados de pins, revisões e eventos. Visualizadores públicos de sessões, projetos e coleções são não listados, não protegidos por permissão; qualquer pessoa com um link ativo pode abrir. Visualizadores agregados copiam o Markdown combinado das sessões incluídas.",
          ],
        },
        {
          heading: "Combine filtros e depois copie o Markdown público",
          paragraphs: [
            "A pesquisa ignora espaços nas pontas e compara como substring sem diferenciar maiúsculas. Uma consulta só com espaços deixa todas as sessões elegíveis até os filtros de pins ou de revisão as excluírem. As caixas de quantidade de pins são faixas de 1, 2–5 e 6 ou mais; a sessão precisa cair em pelo menos uma faixa marcada. Os filtros de status de revisão usam reviewCounts; se esses totais faltarem, cada pin é tratado como aberto. Mudar busca, qualquer filtro, coleção ou projeto volta a paginação para a primeira página.",
            "Selecionar tudo na grade vale só para a página atual de cartões; na tabela, vale a página atual da tabela. A escolha entre grade e tabela fica no localStorage como `pinar-history-view`. A exclusão em lote abre um diálogo de confirmação e depois faz DELETE `/api/history/{id}` para cada id selecionado. O visualizador público de projeto ou coleção carrega `/api/public/projects/{id}` ou `/api/public/collections/{id}` e copia o Markdown combinado de `/p/{id}.md` ou `/c/{id}.md`. Se essa busca pública não for ok, o visualizador mostra não encontrado em vez da lista.",
          ],
          bullets: [
            "Depois de aplicar busca ou filtros, confira se a paginação voltou à página 1 para não ler uma página antiga de outro resultado.",
            "Use Mover para ou Excluir na barra em lote só depois que as caixas corresponderem às sessões desejadas; Limpar seleção esvazia o conjunto sem alterar o armazenamento.",
            "No visualizador agregado, Copiar Markdown deve colar um título, uma URL `/p/` ou `/c/`, e cada sessão como um título `/v/{id}` com Page, Markdown, Screenshot opcional e comentários numerados dos pins; se a cópia falhar com Unable to load Markdown, abra a mesma URL `.md` no navegador.",
          ],
        },
      ],
    },
    "account-and-sign-in": {
      title: "Conta e acesso sem senha",
      summary:
        "Conecte a extensão, abra o workspace web e entenda a expiração de códigos e sessões.",
      sections: [
        {
          heading: "Dois fluxos de código",
          paragraphs: [
            "Instalações Free remotas podem abrir o app web com um código da extensão de uso único válido por cinco minutos. Criar um novo código de oito caracteres invalida o anterior; a geração aceita 10 pedidos a cada cinco minutos por IP e conta, e a troca aceita 20 tentativas por IP. Contas pagas e anteriormente pagas também podem pedir um código de seis dígitos por email; ele expira em dez minutos e bloqueia após cinco tentativas inválidas.",
          ],
        },
        {
          heading: "Sessões",
          paragraphs: [
            "Sessões web duram 30 dias e dispositivos autenticados da extensão duram 180 dias. O servidor armazena hashes de códigos e tokens de sessão, não os valores secretos originais.",
          ],
        },
        {
          heading: "Conclua o pareamento pela aba Conta da extensão",
          paragraphs: [
            "Em uma instalação Free remota, abra a aba Conta das opções da extensão, gere o código temporário ali e copie-o. Abra a página hospedada de acesso pelo mesmo painel; o link aponta para /sign-in com returnTo=/app para que a troca bem-sucedida chegue ao workspace web. Gerar outro código pede confirmação porque o servidor apaga todo código não usado daquele dono antes de gravar o novo valor de oito caracteres. Cole o código em pinar.dev, não no loopback: o helper local redireciona /sign-in à origem hospedada e não emite sessões de nuvem.",
            "Pedir um código por e-mail sempre responde como aceito com aviso de dez minutos, inclusive para endereços desconhecidos, contas nunca pagas ou quando o serviço de e-mail não está configurado, para o formulário não servir de oráculo de contas. Uma mensagem real de seis dígitos só sai para conta que já pagou; se o envio falhar, o desafio é apagado. Pedidos de e-mail aceitam 10 tentativas por IP e 5 por endereço a cada 15 minutos; a verificação aceita 20 por IP e 10 por endereço. Enviar o código junto da identidade da instalação migra aquele workspace Free remoto para a conta paga e emite um token de dispositivo de 180 dias. Sair revoga o cookie pinar_session e qualquer bearer de dispositivo apresentado na mesma requisição.",
          ],
          bullets: [
            "Se nenhum e-mail chegar, espere a janela de 15 minutos antes de tentar de novo; 429 indica limite de IP ou endereço, e uma resposta aceita sem mensagem pode significar conta não paga ou desconhecida.",
            "Confirme o diálogo de regeneração antes de invalidar um código que você ainda pretende digitar na página hospedada.",
            "Use Sair na aba Conta, ou POST /api/auth/logout, quando precisar revogar imediatamente o cookie web ou a sessão de dispositivo da extensão.",
          ],
        },
      ],
    },
    "plans-and-billing": {
      title: "Free, Pro, Founder e cobrança",
      summary:
        "Compare benefícios, gerencie a assinatura e trate a página de planos como fonte atual de preços.",
      sections: [
        {
          heading: "Formato dos planos",
          paragraphs: [
            "Free inclui uso local permanente, 250 MB de cota na nuvem, retenção na nuvem por sete dias e cinco créditos iniciais de IA. Pro é mensal ou anual, com 5 GB e 200 créditos não acumuláveis repostos mensalmente. Founder é uma coorte limitada de compra única, com 5 GB e 500 créditos iniciais; não inclui reposição mensal de créditos.",
          ],
        },
        {
          heading: "Cobrança e disponibilidade",
          paragraphs: [
            "Preços regionais em BRL ou globais em USD, disponibilidade Founder e ofertas atuais ficam na página Planos. O Stripe Checkout reserva uma vaga Founder por 15 minutos e a libera quando a compra é abandonada. O portal da Stripe cuida de mudanças de plano, cancelamento, formas de pagamento e faturas.",
          ],
        },
        {
          heading:
            "Inicie o Checkout com as políticas atuais e a moeda correta",
          paragraphs: [
            "POST /api/stripe/checkout recusa a oferta até o aceite das versões atuais dos Termos, da Privacidade e do Uso Aceitável. País Cloudflare BR seleciona o catálogo em BRL e os Price IDs brasileiros da Stripe; qualquer outro país usa USD. O Checkout Founder primeiro grava uma reserva de vaga pela request id e pelo hash do claim, depois anexa o id da sessão Stripe; criar a sessão Stripe sem reserva anexável libera a vaga. FOUNDER_SALES_ENABLED precisa ser true com FOUNDER_CAPACITY_LIMIT positivo, senão o handler responde 503; coorte esgotada ou claim diferente numa request id reutilizada responde 409.",
            "A URL de sucesso leva session_id e claim; a ativação compara o hash desse claim com os metadados da Stripe e só então concede a oferta. GET /api/pricing expõe founderState como closed, sold_out ou available para a página Planos ocultar uma coorte que o Checkout rejeitaria. O portal de cobrança exige conta autenticada que já tenha stripeCustomerId e volta para /app. Quando o Pro deixa de estar ativo, as sessões desse plano recebem retention_expires_at 90 dias após o fim da elegibilidade paga; contas Founder e lifetime legado mantêm as sessões permanentes em vez de entrar nesse prazo.",
          ],
          bullets: [
            "Aceite as versões atuais das políticas no fluxo hospedado de Planos antes de pagar; sem aceite a API devolve legal_acceptance_required em vez da URL da Stripe.",
            "Se o Checkout Founder voltar 409, recarregue /api/pricing: closed ou sold_out significam esperar uma reserva liberada ou escolher Pro, em vez de repetir o mesmo claim com outra request id.",
            "Se o portal voltar 401 ou 404 No Stripe customer found, conclua um Checkout pago para existir um customer id e só então reabra Gerenciar assinatura numa sessão de conta.",
          ],
        },
      ],
    },
    "ai-credits": {
      title: "Resumos por IA e créditos",
      summary:
        "Saiba quando créditos são reservados, consumidos, repostos ou estornados.",
      sections: [
        {
          heading: "Custo do resumo",
          paragraphs: [
            "Um resumo de sessão reserva 100 créditos de IA antes da inferência. No sucesso, a reserva é consumida. Uma inferência com falha ou abortada estorna imediatamente; uma reserva não concluída por mais de cinco minutos é estornada automaticamente. Resumos aceitam 10 pedidos por minuto por conta e 30 por IP; um pedido duplicado da mesma sessão aguarda o pedido ativo terminar.",
          ],
        },
        {
          heading: "Saldos",
          paragraphs: [
            "Pacotes comprados adicionam 1.000 créditos. A franquia mensal de 200 créditos do Pro não acumula. Os 500 créditos do Founder são um saldo de ativação, não uma franquia mensal. O menu da conta mostra o saldo ativo e a próxima data de reposição aplicável.",
          ],
        },
        {
          heading: "Repita resumos com um request id novo e leia o saldo",
          paragraphs: [
            "POST /api/ai/session-summary exige um requestId único e uma sessão da sua conta. Reutilizar o mesmo requestId nessa sessão devolve o sucesso já gravado ou 409 ai_request_in_progress enquanto a inferência permanece reservada. Depois do timeout de cinco minutos a usage é estornada como reservation_timeout e a próxima chamada precisa de um requestId novo; se o estorno ainda falhar, a resposta é 503 ai_refund_pending. Inferência com falha ou abortada estorna na hora quando possível. Saldo insuficiente devolve 402 insufficient_ai_credits com o saldo atual. Sem Workers AI a resposta é 503 ai_unavailable.",
            "O seletor de grants consome primeiro saldos que não são compra e, em seguida, o grant que expira antes, de modo que créditos mensais inclusos que vencem no próximo mês UTC saem antes de um pacote comprado. O pacote de 1.000 créditos é gravado com expires_at de 12 meses e some da consulta de saldo quando essa data passa. GET /api/account/entitlements devolve a soma restante, nextExpiryAt e nextRefillAt para contas Founder e para Pro com billing_status active. O idioma do resumo precisa ser de, en, es, fr, ja, pt ou zh; qualquer outro valor é escrito em inglês.",
          ],
          bullets: [
            "Em 409 ai_request_in_progress, espere o requestId em voo terminar em vez de abrir um segundo resumo na mesma sessão.",
            "Em ai_request_refunded ou reservation_timeout, envie um requestId novo; repetir o id expirado não inicia outra inferência.",
            "Se o workspace mostrar zero créditos, chame /api/account/entitlements e compare nextExpiryAt com os pacotes comprados antes de comprar outra oferta de 1.000 créditos.",
          ],
        },
      ],
    },
    "storage-and-retention": {
      title: "Armazenamento, retenção e recuperação",
      summary:
        "Entenda cotas, add-ons que expiram, uploads bloqueados e a janela de recuperação.",
      sections: [
        {
          heading: "Cota e add-ons",
          paragraphs: [
            "Free tem 250 MB de armazenamento base na nuvem; Pro e Founder têm 5 GB. Add-ons opcionais de 5 GB e 20 GB duram 12 meses, com avisos por email sete dias e um dia antes da expiração. Screenshots enviados precisam ser PNG válidos e passar por uma verificação atômica de cota antes do armazenamento. Uploads pausam quando o total excederia a cota atual.",
          ],
        },
        {
          heading: "Depois da expiração",
          paragraphs: [
            "Se a expiração deixar a conta acima da cota, o Pinar concede 30 dias de carência e acesso de recuperação até o dia 90. Depois disso, os dados excedentes ficam elegíveis para limpeza. A exclusão automática não está habilitada hoje, portanto elegibilidade não significa remoção imediata.",
          ],
        },
        {
          heading: "Encaixe substituições na cota e use o relógio de 90 dias",
          paragraphs: [
            "A cota é `baseBytes` mais os bytes de add-ons ainda ativos. `canStoreBytes` trata uma substituição como `usedBytes` menos os bytes já gravados daquela sessão mais o tamanho novo, então trocar um PNG maior por um menor pode passar quando uma captura nova estouraria a cota. `uploadAllowed` fica falso quando `usedBytes` já atingiu ou ultrapassou a cota. Excesso sem `latestExpiredAt` é o estado over_quota, sem relógio de carência. Quando `latestExpiredAt` vem de um add-on expirado ou de `paidEligibilityEndedAt`, a conta fica em grace por 30 dias, recoverable até o dia 90 e depois cleanup_eligible; uploads permanecem bloqueados nos três estados.",
            "Sessões Free não permanentes na nuvem ficam elegíveis para exclusão após sete dias. Conteúdo Pro acima da cota Free segue carência de 30 dias e recuperação de 90 dias após o fim da elegibilidade paga. Conteúdo Founder e lifetime legado não se torna elegível para exclusão só por não haver assinatura recorrente; continua limitado pela cota comprada, exclusão do usuário, retenções legais e de abuso, encerramento da conta e descontinuação do serviço. Histórico só local no dispositivo nunca é apagado remotamente. Elegibilidade para exclusão não é promessa de remoção imediata, e a exclusão automática hospedada permanece desligada de propósito.",
          ],
          bullets: [
            "Quando novas capturas pausarem, reduza `usedBytes` abaixo da cota restante excluindo sessões ou substituindo um screenshot pesado, ou compre um add-on de 5 GB ou 20 GB por doze meses.",
            "Se o estado for grace ou recoverable, exporte o que ainda precisar antes do dia 90 após `latestExpiredAt`; cleanup_eligible só marca o excedente, não apaga por si só.",
            "Não espere que desinstalar o app do desktop apague objetos na nuvem, nem que a nuvem apague o histórico local em ~/.pinar.",
          ],
        },
      ],
    },
    "sharing-links": {
      title: "Compartilhar sessões, projetos e coleções",
      summary:
        "Use visualizadores não listados e projeções Markdown com a expectativa correta de privacidade.",
      sections: [
        {
          heading: "Links públicos não listados",
          paragraphs: [
            "Há visualizadores na nuvem para uma sessão, um projeto ou uma coleção. Eles são públicos para quem tiver o link e não aparecem na navegação normal. Não trate uma URL não listada como autenticação para conteúdo sensível.",
          ],
        },
        {
          heading: "Markdown para agentes",
          paragraphs: [
            "A projeção .md de uma sessão inclui metadados, referências de screenshots, localizadores, resultados de agentes e histórico de revisão. Projeções de projeto e coleção combinam suas sessões. Dados compartilhados expirados ou indisponíveis retornam não encontrado, não detalhes privados da conta.",
          ],
        },
        {
          heading: "Copie a projeção Markdown pública e saiba o que ela expõe",
          paragraphs: [
            "O HTML não listado fica em /v/{id} para uma sessão, /p/{id} para um projeto e /c/{id} para uma coleção. A projeção Markdown é o mesmo caminho com sufixo .md. O visualizador agregado carrega /api/public/projects/{id} ou /api/public/collections/{id} sem cookie de autenticação; Copiar Markdown faz GET em /p/{id}.md ou /c/{id}.md e grava o texto na área de transferência, e cada card abre /v/{id}. Um id ausente ou malformado devolve Session not found, Project not found ou Collection not found, não e-mail, plano ou outros campos da conta.",
            "O Markdown da sessão sai do pacote de handoff mais as seções de resultados de agentes e revisão de pins. O Markdown de projeto e coleção lista cada sessão aninhada com URL da página, /v/{id}.md, screenshot opcional, comentários dos pins, `pinId`, caminho DOM, seletor e texto interno. Linhas de screenshot só aparecem quando a preferência `includeScreenshot` do dono permite. Markdown e JSON públicos têm cache public max-age=60; PNGs em /shots/ ficam 86400 segundos. Quem abre o link pode copiar o que vê, portanto URL não listada não é autorização nem minimização de dados.",
          ],
          bullets: [
            "Antes de enviar /p/{id} ou /c/{id}, abra Copiar Markdown e confira se cada sessão aninhada, comentário de pin e linha de screenshot pode ser publicado.",
            "Desligue a entrega de screenshot na conta dona se a projeção não deve incluir URLs de imagem; espere pelo menos 60 segundos o cache público do Markdown expirar.",
            "Se um caminho compartilhado mostrar não encontrado, trate o id como inexistente ou inválido; os handlers públicos nunca acrescentam diagnóstico privado da conta nessa resposta.",
          ],
        },
      ],
    },
    "where-data-lives": {
      title: "Onde seus dados ficam",
      summary:
        "Separe arquivos locais, persistência na nuvem, preferências do navegador e projeções públicas.",
      sections: [
        {
          heading: "Limite local",
          paragraphs: [
            "Screenshots locais são arquivos em `~/.pinar/shots` e o histórico local é SQLite em `~/.pinar/history.db`, com fallback JSON quando SQLite não está disponível. Preferências como visualização, idioma, tema e entrega ficam no armazenamento local do navegador, salvo quando um recurso sincroniza explicitamente.",
          ],
        },
        {
          heading: "Limite da nuvem",
          paragraphs: [
            "Registros da conta e metadados de capturas usam Cloudflare D1; imagens usam R2. A Stripe processa cobrança, o serviço de email configurado envia códigos e Workers AI executa resumos solicitados. A página de Subprocessadores mantém a lista atual de papéis externos.",
          ],
        },
        {
          heading: "Confirme qual armazenamento realmente guarda cada captura",
          paragraphs: [
            "Comece no diretório local do helper e veja qual arquivo está ativo. Os screenshots são gravados como PNG na pasta shots; o histórico prefere SQLite em `history.db`, e o `history.json` só é aberto depois que o `SqliteHistoryDb` não pode ser construído. Uma abertura SQLite bem-sucedida também reescreve prefixos do caminho aninhado shots/shots para o diretório canônico. O tema permanece só no navegador: a aba Interface grava dark ou light na chave pinar-theme do localStorage e remove a chave no modo system. Idioma e os interruptores da aba Capture para modo de handoff (full versus compact) e inclusão de screenshot são editados no mesmo diálogo, mas uma conta autenticada na nuvem pode persistir handoff_mode e include_screenshot em owner_preferences no D1 por GET e PATCH /api/preferences.",
            "Capturas hospedadas guardam metadados no D1 e bytes PNG no R2. As projeções públicas sem autenticação são GET /shots/{id}.png (Cache-Control max-age 86400), GET /v/{id}.md e as rotas /p/ e /c/ de projeto e coleção. POST /api/auth/email-codes armazena só o hash em email_challenges, expira o desafio em dez minutos e responde 202 com { accepted: true, expiresInSeconds: 600 } mesmo sem EMAIL ou quando a conta não é everPaid, de modo que a resposta não revela se o e-mail foi enviado (429 é a exceção de limite de taxa). Resumos solicitados chamam o modelo Workers AI @cf/meta/llama-3.1-8b-instruct-fp8 em POST /api/ai/session-summary. A página de Subprocessadores nomeia a Cloudflare para D1, R2, Workers AI e e-mail transacional, e a Stripe para o Checkout, deixando claro que o Pinar não recebe os dados completos do cartão. GET /api/legal/current informa a versão de política 2026-08-25.",
          ],
          bullets: [
            "Se `history.db` estiver ausente ou o SQLite não abrir, trate ~/.pinar/history.json como o catálogo local ativo e espere um aviso no console sobre o fallback JSON.",
            'Abra um screenshot hospedado em /shots/{id}.png e a projeção Markdown em /v/{id}.md; um objeto ausente no R2 devolve JSON { error: "shot not found" } com status 404.',
            "Nas configurações, confirme o tema da Interface pela chave pinar-theme e separe os interruptores de entrega da aba Capture dos campos handoff_mode e include_screenshot sincronizados no D1 quando você estiver autenticado.",
          ],
        },
      ],
    },
    "automatic-sanitization": {
      title: "Sanitização automática",
      summary:
        "Veja quais dados de URL, DOM, credenciais e imagens inline o Pinar remove antes do handoff ou armazenamento.",
      sections: [
        {
          heading: "Campos e URLs sensíveis",
          paragraphs: [
            "O Pinar reda campos de senha, pagamento, token e OTP; remove fragmentos de URL; e retira chaves de query sensíveis como access_token, api_key, auth, password, secret, token e jwt. Você pode adicionar outros nomes nas configurações da extensão.",
          ],
        },
        {
          heading: "Handoff estruturado",
          paragraphs: [
            "O parser de visual-context aceita versões compatíveis do schema e reda erros internos de parsing em vez de expor segredos brutos. Dados inline do screenshot são removidos do handoff textual; o pacote usa uma referência limitada por caminho ou URL.",
          ],
        },
        {
          heading:
            "Observe o relatório de redação e as imagens inline removidas",
          paragraphs: [
            "O sanitizeCapture classifica campos password, otp, payment e token a partir do type, do autocomplete e do haystack de name/id/ariaLabel/role, depois sanitiza a URL da página. Chaves de query no conjunto sensível, ou valores que passam em looksLikeSecret (comprimento mínimo 12 com JWT ou prefixos como sk_live_, ghp_, github_pat_ e AIza), são trocados por [redacted] e marcados como secret-query ou token; parâmetros de hash usam secret-hash. Nomes extras em extraQueryKeys e extraHashKeys são convertidos para minúsculas, separados por espaço, vírgula ou ponto e vírgula, e unidos a DEFAULT_SENSITIVE_QUERY_KEYS, que também inclui authorization, refresh_token, session, session_id, client_secret, bearer e nomes relacionados além da lista curta do resumo. Os segredos coletados substituem trechos iguais em título, descrição, URL e pins. Valores com menos de quatro caracteres não entram como segredo de substituição mesmo quando o campo foi categorizado, e uma URL que não faz parse volta inalterada.",
            "O parseVisualCapture aceita schemaVersion 1 ou o legado 0 e lança VisualContextError com a mensagem estável invalid visual context e códigos unsupported_schema, invalid_payload, invalid_pin ou missing_capture_id, sem ecoar o corpo bruto. O decodeVisualCaptureJson recupera falha de JSON ou de schema devolvendo aquele `captureId` com pins vazios. screenshotFrom e captureForHandoffJson definem screenshot.url como null para URLs data:; o caminho de handoff adiciona o aviso screenshot_inline quando remove bytes inline, de modo que o pacote textual guarda um caminho de arquivo ou referência http(s) em vez da imagem. Se input.unevaluated for true, o relatório de privacidade registra unevaluated e o aviso privacy_unevaluated.",
          ],
          bullets: [
            "Depois de sanitizeCapture, leia privacy.redacted e os avisos privacy_redacted ou privacy_unevaluated; unevaluated true significa que algumas regiões não foram inspecionadas.",
            "Inclua nomes extras de query como tokens separados por vírgula, espaço ou ponto e vírgula; a correspondência ignora maiúsculas e se une ao conjunto embutido, inclusive authorization, session e refresh_token.",
            "Se o JSON de handoff colado ainda contiver uma URL data: de screenshot, a captura não passou por captureForHandoffJson; o caminho suportado anula url e pode adicionar screenshot_inline.",
          ],
        },
      ],
    },
    "local-security-and-recovery": {
      title: "Segurança e recuperação local",
      summary:
        "Entenda tokens de capacidade, origens confiáveis, migrações locais e recuperação segura da inicialização.",
      sections: [
        {
          heading: "Confiança da API local",
          paragraphs: [
            "A API local aceita loopback e a origem publicada da extensão e verifica um segredo de capacidade salvo com permissões restritivas. A rotação mantém o segredo anterior válido por 24 horas para processos ativos adotarem o novo valor; a revogação remove o arquivo e força nova autorização.",
          ],
        },
        {
          heading: "Recuperação segura",
          paragraphs: [
            "Um bloqueio de PID obsoleto é substituído, enquanto uma instância ativa não é tocada. Parar e reiniciar usam primeiro o caminho gracioso do helper; no macOS, um listener travado só é encerrado se continuar respondendo depois da espera. Um JSON de histórico corrompido volta a um schema vazio com Pessoal e Entrada protegidos. Screenshots antigos em shots/shots são migrados sem sobrescrever conflitos de nome.",
          ],
        },
        {
          heading:
            "Apresente o segredo de capacidade e recupere o armazenamento local quebrado",
          paragraphs: [
            'O helper persiste um store na versão 1 em local-capability.json com arquivo temporário 0o600 e rename. Envie o segredo atual no cabeçalho x-pinar-capability ou como token Authorization Bearer. GET /api/local/capability pode omitir o segredo quando Origin está vazio, é HTTP loopback em 127.0.0.1, localhost ou ::1, ou chrome-extension:// com id alfanumérico; qualquer outra Origin é hostil e recebe 401 { error: "unauthorized" } com Cache-Control no-store. Loopback em HTTPS não conta como loopback. POST /api/local/capability/rotate e /revoke exigem um segredo correspondente. A rotação grava um current novo e mantém previous.secret até expiresAt (padrão 24 horas, ajustável com PINAR_CAPABILITY_GRACE_MS; zero elimina o anterior). A revogação apaga o arquivo; o próximo readOrCreateLocalCapability cria um store novo. Pedidos loopback comuns dispensam o segredo; origens chrome-extension precisam de correspondência. Entradas classificadas como public-min ou local-public-projection pulam esse controle.',
            "O claimInstanceLock deixa um PID estrangeiro vivo no lugar e chama onDuplicate; um lock ausente ou ilegível é tratado como obsoleto e sobrescrito com este pid. O migrateNestedShots move arquivos de shots/shots para shots e ignora nomes que já existem no destino; só remove o diretório aninhado quando a lista de conflicts está vazia. Ids de screenshot são reduzidos a A–Z, a–z, 0–9, sublinhado e hífen com no máximo 80 caracteres; caso contrário o arquivo é pin.png. Se o `SqliteHistoryDb` lançar erro, o openHistoryDb avisa e abre `history.json`. Um JSON corrompido vira arrays vazios, e _ensureDefaults recria o projeto protegido Personal e a coleção Inbox para o owner local. Falha ao gravar JSON gera um aviso e não aborta a inicialização. Quando `history.db` não existe, migrateLegacyHistoryDb pode renomear um history.sqlite residual em bin/ ou shots/ para `history.db`.",
          ],
          bullets: [
            "Envie x-pinar-capability ou Bearer nas chamadas chrome-extension; GET /api/local/capability faz bootstrap a partir de HTTP loopback ou chrome-extension, e outras Origins recebem 401 unauthorized.",
            "Depois da revogação, local-capability.json desaparece; a próxima inicialização do helper cria um segredo novo, e os clientes precisam lê-lo de novo antes que rotate ou revoke voltem a funcionar.",
            "Se `history.db` não abrir, espere `history.json`; um JSON corrompido vira catálogo vazio e em seguida Personal e Inbox para o owner local, sem derrubar o helper.",
          ],
        },
      ],
    },
    "telemetry-and-policies": {
      title: "Telemetria, consentimento e políticas",
      summary:
        "Saiba o que é opt-in, quais políticas condicionam o uso da nuvem e o que Fair Source significa aqui.",
      sections: [
        {
          heading: "Métricas do ciclo fechado",
          paragraphs: [
            "Métricas do ciclo ficam desligadas até você aceitar. Quando desabilitadas, entregas são descartadas. Quando habilitadas, o sanitizador aceita eventos operacionais, duração, agente e confiança de realocação, mas rejeita comentários, títulos, URLs, caminhos DOM, seletores, screenshots, markup e conteúdo bruto.",
          ],
        },
        {
          heading: "Consentimento e licença",
          paragraphs: [
            "Persistência remota e checkout registram a aceitação dos Termos, Política de Privacidade e Uso Aceitável atuais. Retenção, reembolsos, Fair Source e subprocessadores têm documentos publicados separados. O Pinar é Fair Source/source-available pela licença do repositório, não Open Source aprovado pela OSI nas versões atuais.",
          ],
        },
        {
          heading:
            "Verifique os payloads de opt-in e o conjunto publicado de políticas",
          paragraphs: [
            "As métricas do ciclo começam desligadas porque DEFAULT_LOOP_METRICS_OPT_IN é false. O planLoopMetricRequest devolve send false com reason opt_in_off salvo se optIn for estritamente true, e loopMetricHttpStatus mapeia esse código para HTTP 200. Quando habilitado, cada objeto de evento só pode conter agent, degraded, durationMs, event e locationConfidence. Chaves desconhecidas, chaves proibidas como url, title, comment, screenshot, selector, path, `captureId`, sessionId, html, markdown, content, pin e page, ou valores string que parecem URLs http(s), URIs data: ou contêm { ou <, viram forbidden_fields (HTTP 400). event deve ser accepted, correction_ready, handoff, relocation_failed ou reopened; agent deve ser claude, codex, cursor ou grok; locationConfidence deve ser exact, probable, ambiguous ou unresolved; durationMs deve ser inteiro não negativo de no máximo 86.400.000. events vazio ou que não é array é invalid_payload e não é enviado.",
            "O README afirma que o checkout e o registro remote Free registram as versões aceitas das políticas e publica Termos, Privacidade, Uso Aceitável, Retenção, Reembolso, Fair Source e Subprocessadores em https://pinar.dev/legal/. O legal-documents fixa CURRENT_LEGAL_VERSION em 2026-08-25 para os sete ids. Os Termos dizem que o uso apenas local, sem contato com o serviço hospedado, não exige conta hospedada; a Privacidade diz que dados apenas locais que nunca saem do dispositivo ficam fora da política hospedada. A LICENSE é Functional Source License, Version 1.1, MIT Conversion: dois anos após a primeira publicação a Change License é MIT, e até a Change Date você não pode oferecer um serviço comercial hospedado concorrente de anotação visual, preview de screenshot ou persistência em nuvem. O aviso Fair Source remete à LICENSE e não é Open Source aprovado pela OSI. Dúvidas: contact@pinar.dev ou contato@pinar.dev.",
          ],
          bullets: [
            "Mantenha as métricas do ciclo desligadas salvo se optIn for true de propósito; o plano desabilitado devolve send false com opt_in_off e não transmite o lote.",
            "Antes de persistência hospedada ou checkout, abra Termos, Privacidade e Uso Aceitável na versão 2026-08-25 em https://pinar.dev/legal/terms, /privacy e /acceptable-use.",
            "Trate a LICENSE como texto controlador dos limites de concorrência FSL-1.1-MIT e da Change Date; os subprocessadores hospedados nomeados hoje são Cloudflare e Stripe.",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
