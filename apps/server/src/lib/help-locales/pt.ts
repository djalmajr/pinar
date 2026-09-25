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
    clearSearch: "Limpar busca",
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
    "capture-toolbar": {
      alt: "Barra de captura do Pinar com controles para concluir a sessão, revisá-la com Tab e ocultar a barra com Escape.",
      caption:
        "Uma sessão contínua acompanha a navegação, preserva a numeração dos pins e mantém a barra oculta após Escape até você reabrir o Pinar explicitamente.",
    },
    "capture-session-review": {
      alt: "Painel opaco de revisão da sessão do Pinar com comentário editável, alvo selecionado, caminho DOM, miniatura e controle de remoção.",
      caption:
        "Tab substitui a barra de captura pela revisão da sessão, onde você pode editar ou remover pins antes de concluir ou cancelar.",
    },
    "capture-review": {
      alt: "Página com pins de elemento prontos para revisão com estrutura e evidência técnica capturadas.",
      caption: "Pins de elemento preservam a estrutura capturada e a evidência técnica que acompanham o comentário na entrega ao agente.",
    },
    "capture-copy-failed": {
      alt: "Pinar informando que não foi possível concluir a sessão e mantendo os pins disponíveis para revisão e nova tentativa.",
      caption:
        "Uma falha ao concluir mostra um erro acionável e mantém a sessão completa disponível para revisão e nova tentativa.",
    },
    "capture-full-page": {
      alt: "Sobreposição do Pinar numa página longa que continua abaixo da primeira viewport, pronta para uma captura de página inteira costurada.",
      caption:
        "A captura de página inteira rola e costura o documento para o screenshot copiado incluir o conteúdo abaixo da dobra.",
    },
    "capture-viewer": {
      alt: "Visualizador de sessão do Pinar com todos os screenshots anotados no mesmo panzoom e todos os comentários no painel direito.",
      caption:
        "Uma sessão salva abre como um único registro, independentemente da quantidade de páginas, com todas as imagens e anotações juntas.",
    },
    "extension-options": {
      alt: "Opções da extensão Pinar na aba Preferências, com destinos local e remoto, idioma e tema.",
      caption:
        "A aba Preferências reúne o destino de armazenamento, o idioma e a aparência usados na extensão.",
    },
    "extension-preferences": {
      alt: "Opções da extensão Pinar na aba Captura, com o detalhamento compacto ou completo da cópia para IA e o interruptor de incluir captura de tela.",
      caption:
        "A aba Captura define entrega compacta ou completa e se a próxima cópia inclui screenshot; Salvar grava essas escolhas antes da próxima cópia.",
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
      alt: "Página de preços do Pinar comparando Free, Pro anual, adicionais de armazenamento e opções de créditos de IA.",
      caption:
        "A área de preços mostra limites dos planos, periodicidade de cobrança, adicionais de armazenamento e compras de créditos de IA antes do checkout.",
    },
    updates: {
      alt: "Detalhe de versão do Pinar mostrando data, versão, mudanças e navegação para versões anterior e seguinte.",
      caption:
        "As notas de versão publicadas tornam o comportamento instalado e as mudanças operacionais rastreáveis por versão.",
    },
    "capture-shortcuts": {
      alt: "Aba Atalhos das opções da extensão Pinar, com comandos do navegador e teclas da sobreposição durante a captura.",
      caption:
        "A aba Atalhos mostra os atalhos do Chrome ao lado das teclas da sobreposição para pin, seleção, máscara, copiar e cancelar.",
    },
    "capture-types": {
      alt: "Sobreposição do Pinar com um pin numerado no título e uma região selecionada em volta do cartão de total do pedido.",
      caption:
        "Pins de elemento e regiões livres podem dividir a mesma sobreposição para o screenshot copiado guardar o alvo no DOM e o agrupamento visual.",
    },
    "capture-pins": {
      alt: "Sobreposição do Pinar com três marcadores numerados no título, no e-mail do cliente e no botão de pagamento.",
      caption:
        "Cada pin guarda o próprio número e comentário para uma captura apontar vários elementos na mesma página.",
    },
    "capture-selection": {
      alt: "Sobreposição do Pinar destacando um título com o contorno azul de seleção antes de confirmar o pin.",
      caption:
        "A seleção inteligente contorna o elemento sob o cursor para você percorrer o DOM com as setas antes de pinar.",
    },
    "capture-masks": {
      alt: "Sobreposição do Pinar com uma máscara de privacidade cobrindo o e-mail do cliente e um pin numerado no título.",
      caption:
        "A máscara esconde pixels sensíveis no screenshot copiado sem remover os comentários dos pins que ainda descrevem a página.",
    },
    "capture-copied": {
      alt: "Pinar confirmando que a sessão de captura completa foi copiada com sucesso.",
      caption:
        "Uma conclusão bem-sucedida confirma o resultado, fecha a sobreposição e deixa um único pacote correlacionado na área de transferência.",
    },
    "install-pinar": {
      alt: "Aba Preferências da extensão Pinar com o botão Baixar Pinar ao lado da opção Servidor Local.",
      caption:
        "A aba Preferências oferece o download da aplicação Pinar ao lado de Servidor Local para o auxiliar iniciar neste computador.",
    },
    "options-local": {
      alt: "Aba Preferências da extensão Pinar com Servidor Local selecionado e as capturas ficando neste computador.",
      caption:
        "Servidor Local mantém histórico e screenshots neste computador e não exige aceite jurídico do serviço hospedado.",
    },
    "workspace-nested": {
      alt: "Barra lateral do workspace do Pinar com uma coleção selecionada na árvore do projeto e os cartões de sessão correspondentes.",
      caption:
        "Selecionar uma coleção filtra o workspace para aquele ramo, deixando pastas aninhadas visíveis ao lado das sessões que elas guardam.",
    },
    "workspace-review": {
      alt: "Tabela do workspace do Pinar com o filtro de status de Revisão aberto acima das linhas de sessão.",
      caption:
        "A visão em tabela combina busca com filtros de status de Revisão para varrer pins abertos, aceitos e reabertos entre sessões.",
    },
    "workspace-security": {
      alt: "Seletor de projeto do workspace do Pinar aberto no projeto protegido Personal.",
      caption:
        "O workspace local recupera um projeto Personal e uma Inbox protegidos quando o histórico não abre, em vez de travar o aplicativo.",
    },
    "legal-retention": {
      alt: "Central jurídica do Pinar aberta no documento de Retenção de Dados.",
      caption:
        "A política de Retenção de Dados diz por quanto tempo capturas hospedadas, registros de cobrança e dados de conta relacionados são guardados.",
    },
    "sharing-markdown": {
      alt: "Visualizador público de projeto do Pinar com o botão Copiar Markdown acima dos cartões de sessão compartilhados.",
      caption:
        "Um link não listado de projeto ou coleção deixa qualquer pessoa com a URL copiar o Markdown combinado sem entrar na conta.",
    },
    "preferences-privacy": {
      alt: "Aba Captura da extensão Pinar mostrando métricas opcionais do ciclo e chaves extras de URL para ocultar.",
      caption:
        "As preferências de privacidade acrescentam chaves extras de query removidas das URLs capturadas e mantêm as métricas do ciclo desligadas até você optar.",
    },
    "pricing-credits": {
      alt: "Cartão de adicional da página de preços do Pinar para 500 créditos de IA, com compra e validade de doze meses.",
      caption:
        "Os créditos de IA são vendidos como adicional com validade de doze meses, separados do armazenamento do plano e da periodicidade de cobrança.",
    },
  },
  articles: {
    "install-pinar": {
      title: "Instalar o Pinar",
      summary: "Instale a extensão do Chrome e abra a aplicação Pinar no seu computador.",
      sections: [
        {
          heading: "Extensão do navegador",
          paragraphs: [
            "Instale o Pinar pela [Chrome Web Store](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo).",
          ],
          bullets: [
            "Fixe o ícone do Pinar no menu de extensões do Chrome para mantê-lo visível.",
            "Abra a [página da Chrome Web Store](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo) para adicionar a extensão oficial.",
          ],
        },
        {
          heading: "A aplicação Pinar",
          paragraphs: [
            "No macOS, a aplicação Pinar fica na barra de menus. No Windows, fica na área de notificação. Abra a aplicação para começar a capturar. No Linux, instale com o comando abaixo.",
          ],
          bullets: [
            "As capturas ficam neste computador. Use “Abrir pasta” para vê-las.",
            "No macOS e no Windows, “Iniciar no login” mantém o Pinar disponível depois que você entra na conta.",
            "Se uma captura não tiver imagem, abra o Pinar e tente de novo.",
          ],
        },
        {
          heading: "Instalar e abrir",
          paragraphs: [
            "Baixe a aplicação Pinar pelos links abaixo, instale-a e abra-a.",
            "Com o Pinar aberto, escolha “Abrir o workspace”. Se mostrar “Servidor local: desligado”, escolha “Iniciar”. Se as capturas coladas pararem de chegar, abra o Pinar de novo.",
          ],
          bullets: [
            "macOS: [baixe a aplicação Pinar](https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg), abra a imagem de disco e arraste-a para “Aplicativos”.",
            "Windows: [baixe a aplicação Pinar](https://github.com/djalmajr/pinar/releases/latest/download/win-x64-Pinar-Setup.zip), extraia e execute o `Pinar-Setup.exe` ao lado da pasta `.installer`. O ícone aparece na área de notificação.",
            "Windows: a primeira execução pode mostrar “O Windows protegeu seu PC”. Escolha “Mais informações” e depois “Executar mesmo assim”.",
            "Linux: `curl -fsSL https://pinar.dev/install.sh | sh`",
          ],
        },
      ],
    },
    "first-capture": {
      title: "Fazer a primeira captura",
      summary:
        "Pine elementos em uma ou mais páginas, revise a sessão contínua e conclua um único pacote correlacionado.",
      sections: [
        {
          heading: "Crie uma sessão contínua",
          paragraphs: [
            "Abra o Pinar, clique em um elemento ou arraste uma área livre, escreva o comentário e pressione `Enter`. O primeiro pin inicia uma sessão. Cada pin captura seu próprio screenshot imediatamente, e você pode navegar para outras páginas sem concluir.",
          ],
          bullets: [
            "A numeração dos pins continua em todas as páginas da mesma sessão.",
            "`Shift+Enter` adiciona uma quebra de linha. `Escape` fecha um rascunho ou oculta a barra quando não há rascunho aberto.",
            "Depois de ocultada, a barra permanece assim durante a navegação até você acionar novamente a extensão ou o atalho.",
          ],
        },
        {
          heading: "Revise antes de concluir",
          paragraphs: [
            "Pressione `Tab` para substituir a barra pela revisão da sessão. Edite comentários, confira o elemento ou região selecionada, o título da página, o caminho DOM e a miniatura, ou remova um pin pelo controle X. Pressione `Tab` novamente para voltar à captura.",
          ],
          bullets: [
            "A revisão restaura o cursor normal da página e não recebe foco apenas porque você pressionou `Tab`.",
            "Dentro do editor de comentários, `Tab` mantém a navegação normal do teclado.",
          ],
        },
        {
          heading: "Conclua ou cancele a sessão",
          paragraphs: [
            "Use `Command+Enter` no macOS ou `Alt+Enter` no Windows e Linux para concluir e copiar a sessão completa. O Pinar confirma o sucesso visualmente. Se a conclusão falhar, mostra um erro acionável e mantém a sessão disponível para revisão e nova tentativa. Cancelar sessão a encerra sem copiar.",
            "Trate o conteúdo da área de transferência como uma unidade: instruções legíveis, uma URL opcional do visualizador e um bloco pinar-visual-context delimitado por página. Cada bloco leva seu próprio screenshot, além de `captureId`, `pinId`, URL da página e localizadores (cssSelector, domPath, innerText). Os badges numerados são sobreposições de anotação, não a interface da página. Não reescreva `captureId` nem `pinId` ao colar em um agente.",
          ],
          bullets: [
            "Uma sessão sem pins salvos não pode ser concluída.",
            "O armazenamento local e o remoto usam o mesmo comportamento de sessão contínua.",
            "Mantenha o Pinar em execução ao usar o armazenamento local para preservar screenshots e o visualizador.",
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
            "O modo local mantém o histórico e os screenshots neste computador. O workspace local continua disponível sem uma conta.",
          ],
        },
        {
          heading: "Nuvem",
          paragraphs: [
            "Quando a conta autenticada é elegível na oferta atual, o modo na nuvem oferece acesso remoto ao workspace, retenção gerenciada, cobrança e links não listados. O aplicativo local e um servidor self-hosted continuam gratuitos. A transcrição de voz do Pinar Cloud continua um benefício Pro e não faz parte de uma avaliação. IA local e BYOK continuam disponíveis sem usar créditos do Pinar Cloud. Você aceita as políticas atuais antes de qualquer coisa ser armazenada remotamente.",
          ],
        },
        {
          heading: "Como as sessões local e na nuvem realmente abrem",
          paragraphs: [
            "O histórico local começa com um projeto protegido “Personal” e uma coleção “Inbox” que você não pode aninhar ou excluir como pastas comuns. As capturas ficam neste computador, e você pode abri-las no workspace local.",
            "O armazenamento na nuvem começa depois de você aceitar os “Termos”, a “Privacidade” e o “Uso Aceitável” atuais e confirmar um código por e-mail. Contas “Free” e Pro usam o mesmo acesso. Os links de compartilhamento continuam legíveis por qualquer pessoa que tenha a URL não listada.",
          ],
          bullets: [
            "O workspace local permanece neste computador e não precisa de uma conta na nuvem.",
            "Se o histórico local não conseguir abrir o armazenamento usual, o Pinar recupera um catálogo utilizável em vez de travar.",
            "Links de compartilhamento na nuvem não exigem uma sessão do workspace: quem tiver a URL não listada lê o Markdown ou a imagem.",
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
            "`Enter` pina o elemento sob o cursor; `Seta para cima` seleciona o pai e `Seta para baixo` retorna a um filho.",
            "`M` alterna o desenho de máscaras de privacidade. `Escape` cancela um rascunho ou máscara; sem rascunho, limpa os pins e esconde a barra.",
            "`R` alterna a sobreposição ao vivo entre só os pins numerados e os pins com as regiões selecionadas. O screenshot copiado sempre inclui os dois.",
            "`Command+Enter` / `Alt+Enter` copia o pacote concluído.",
            "`Alt+Shift+P` mostra ou esconde a barra sem cancelar a sessão, e você pode redefini-lo em `chrome://extensions/shortcuts`. Atalhos do navegador ficam inertes em páginas `chrome://`, na Chrome Web Store e antes de a sobreposição ser injetada.",
            "`G` começa a gravar os passos que você faz na página. Reabra o Pinar, pine o resultado e copie com `Command+Enter` / `Alt+Enter` para anexar os passos; pressionar `G` de novo descarta a gravação.",
          ],
        },
        {
          heading: "Páginas que disputam o foco",
          paragraphs: [
            "Em sites com bloqueios de foco agressivos, o Pinar tenta focar o campo de comentário algumas vezes e depois para, em vez de travar a aba. Clique diretamente no campo se a página continuar roubando o foco.",
          ],
        },
        {
          heading: "Detalhes da sobreposição, do ícone e do passeio no DOM",
          paragraphs: [
            "Os atalhos de captura só valem enquanto a sobreposição está ativa. O ícone da extensão alterna essa sobreposição; ele não apaga pins. Passar o cursor na barra sem um rascunho aberto a deixa atravessar cliques para você ainda clicar ou arrastar a página por baixo. `Shift+Enter` insere uma quebra de linha no campo de comentário, e atalhos da página digitados ali não saem desse campo.",
            "`Seta para cima` sobe ao elemento pai e lembra o filho que você deixou, então `Seta para baixo` volta a esse nó lembrado se ele ainda for filho; senão usa o primeiro filho. No modo máscara, arraste uma região para escondê-la e clique numa máscara existente para restaurá-la. A rolagem pelo teclado continua no documento, mas teclas dirigidas a controles da página são bloqueadas para não ativar botões nem digitar no formulário.",
          ],
          bullets: [
            "`Command+Enter` / `Alt+Enter` grava o rascunho aberto e depois copia; sem comentário mostra “Escreva um comentário” em vez de enviar um pin vazio.",
            "Depois de `Escape` ou da cópia, o Pinar continua dono dessa tecla física até ela ser solta, para a página não tratar o mesmo toque como cancelar ou enviar.",
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
          heading: "Clique, arraste e alvos em frames",
          paragraphs: [
            "Clique um nó, ou pressione `Enter` no contorno atual, para abrir um pin de elemento. Arraste um retângulo de pelo menos seis pixels para abrir um pin de área. O clique inicial em um iframe ou frame é ignorado para que o documento interno faça a seleção.",
            "Pins de elemento registram impressão digital, seletor e um caminho DOM que une frames ancestrais com um delimitador de fronteira. Pins de área guardam o retângulo e um rótulo em pixels, sem localizador. O screenshot copiado ainda costura em torno da união de todos os pins, inclusive os colocados em frames filhos.",
          ],
          bullets: [
            "A barra de captura permanece no frame superior; frames filhos mostram só marcadores e o campo de comentário.",
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
            "O contexto estruturado mantém `pinId` a partir do `pinId` ou id existente. Quando esses campos faltam, o analisador sintetiza `captureId`:pN a partir da identidade da captura e do número do pin. Ferramentas seguintes podem então apontar para o mesmo screenshot, comentário e linha de revisão.",
          ],
          bullets: [
            "Um campo de comentário vazio não pode ser copiado; o foco permanece no campo até existir um comentário.",
            "Ao passar o cursor no marcador, a página mostra número, comentário e a confiança atual do localizador.",
            "Editar um pin existente atualiza só o comentário; o id armazenado permanece o mesmo.",
          ],
        },
        {
          heading: "Estrutura e evidência técnica",
          paragraphs: [
            "Cada pin de elemento também guarda um snapshot do que ele aponta: a árvore HTML do elemento, os estilos computados que diferem dos padrões do navegador, as fontes e os ícones que ele usa, e seu pai e irmãos. O visualizador mostra isso em “Estrutura”. Elementos grandes são aparados para caber no limite da captura, e o visualizador avisa quando isso acontece.",
            "“Evidência técnica” lista fatos que a extensão observou na página enquanto você pinava: erros de console, requisições com falha e o ambiente (navegador, viewport, idioma). Cada item é classificado como “Após interação” quando aconteceu depois do seu último clique ou tecla, ou “Mesma página” quando só compartilha a página. Nada é inferido e nenhum crédito de IA é gasto; remova um item antes de compartilhar se ele não tiver relação.",
          ],
          bullets: [
            "Pins de área não têm estrutura; use um pin de elemento quando o agente precisar de contexto DOM e localizadores resilientes.",
            "Estrutura e evidência viajam dentro do bloco JSON pinar-visual-context, então um agente as recebe junto com o paste.",
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
            "Conteúdo carregado sob demanda, layouts animados, frames de outra origem e páginas que mudam durante a rolagem podem produzir lacunas ou áreas não resolvidas. Aguarde a página estabilizar, tente novamente ou capture a área afetada separadamente.",
          ],
        },
        {
          heading: "Faixas da viewport e restauração do layout",
          paragraphs: [
            "O Pinar planeja as posições de rolagem a partir da união das caixas dos pins mais o recuo e captura cada faixa PNG da altura da viewport pela captura de tela da aba. Faixas seguintes esperam um pouco para a página pintar, e o canvas composto usa a densidade de pixels inferida da largura da primeira faixa versus a viewport CSS.",
            "Antes da primeira faixa, nós sticky e fixed são reescritos para não se repetirem em cada quadro. Os estilos inline originais e a rolagem são restaurados mesmo se a composição falhar. Coordenadas de pins e máscaras são deslocadas para a origem da captura antes do recorte.",
          ],
          bullets: [
            "Nós fixed passam a posição absoluta na caixa medida, com transforms zerados para o screenshot não deslocá-los duas vezes.",
            "Nós sticky passam a posição relativa durante a passagem de captura.",
            "A rolagem das faixas é instantânea para o documento não animar entre os quadros.",
          ],
        },
      ],
    },
    "smart-selection": {
      title: "Localizadores inteligentes e seleção do DOM",
      summary:
        "Entenda como um pin identifica um elemento enquanto você anota uma página que muda.",
      sections: [
        {
          heading: "Impressões digitais resilientes",
          paragraphs: [
            "Um pin de elemento combina seletor estável, caminho DOM, tag, id, nome, test id, função, classes, texto, rótulo e geometria em vez de confiar em um único caminho frágil.",
          ],
        },
        {
          heading: "Confiança na página ativa",
          paragraphs: [
            "Enquanto o overlay de anotação está aberto, o Pinar reavalia seletor e estrutura para que os marcadores acompanhem elementos que se movem com as atualizações da página.",
          ],
          bullets: [
            "Classes com aparência de geração automática são removidas da impressão digital.",
            "Frames de outra origem que não podem ser lidos permanecem não resolvidos em vez de serem estimados.",
            "IDs únicos e test ids têm prioridade quando identificam um único elemento.",
            "Um caminho DOM estrutural é salvo quando nenhum atributo estável é único.",
            "Pins de área usam sua geometria e não fingem identificar um elemento do DOM.",
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
            "O desenho de máscara fica indisponível enquanto um rascunho de comentário está aberto. Um arraste válido guarda uma máscara do usuário em coordenadas do documento para acompanhar a rolagem, e clicar nessa sobreposição remove. Caixas automáticas da varredura de privacidade são combinadas com esses retângulos antes da cópia.",
            "As regiões combinadas viajam com a mensagem de captura para serem pintadas no screenshot antes da área de transferência ou do armazenamento. A sanitização à parte ainda oculta segredos conhecidos em URLs, valores de campos e texto dos pins; as máscaras cobrem pixels que essas regras de texto não classificam.",
          ],
          bullets: [
            "Máscaras do usuário usam um id único e a categoria manual para poderem ser apagadas sem as caixas automáticas.",
            "Máscaras automáticas de campo são dispensadas, não apagadas, para varreduras seguintes ainda reportarem o campo.",
            "`Escape` sai do desenho de máscara sem descartar os pins já colocados na página.",
          ],
        },
      ],
    },
    "copy-and-view": {
      title: "Copiar e visualizar uma sessão",
      summary:
        "Revise todos os screenshots e anotações de uma sessão salva em um único registro do workspace.",
      sections: [
        {
          heading: "Controles do visualizador",
          paragraphs: [
            "O visualizador permite arrastar, aplicar zoom com a roda ancorado no cursor, usar duplo clique e ajustar de 50% a 800%. Selecionar um pin abre as abas Prévia renderizada e Markdown bruto.",
          ],
          bullets: [
            "Baixe o screenshot ou copie o Markdown da sessão pelo visualizador.",
            "Use o link da página original quando precisar conferir o site atual separadamente.",
            "Selecione um pin para alternar entre Prévia e Markdown bruto.",
            "Uma sessão agrupada mantém todos os screenshots capturados no mesmo visualizador.",
            "O link da página original abre separadamente sem alterar a sessão salva.",
          ],
        },
        {
          heading: "Copiar pelo visualizador",
          paragraphs: [
            "Copiar prompt grava o pacote Markdown correlacionado da sessão agrupada completa. Abrir prompt *.md abre o Markdown público quando o compartilhamento está disponível.",
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
            "Se o pacote listar um caminho absoluto em Screenshot, o agente local deve abrir essa imagem única; os badges numerados são sobreposições. Avisos como `screenshot_missing`, `helper_unavailable` ou `viewer_unavailable` descrevem uma entrega degradada, mas não invalidam comentários e contexto DOM.",
          ],
        },
        {
          heading: "Como entregar o pacote copiado a um agente",
          paragraphs: [
            "A extensão do Chrome nunca digita no campo do agente. Depois de `Command+Enter` / `Alt+Enter`, cole você mesmo a área de transferência no Cursor, Claude, Codex ou Grok. O texto começa dizendo que as notas dos pins podem pedir uma alteração ou uma explicação, e para tratar seletor e caminho DOM como localizadores complementares, seguidas de um bloco JSON pinar-visual-context. Se houver URL de visualizador, busque-a só quando esses detalhes não bastarem.",
            "Trate `captureId` e `pinId` como identidade, não como rótulos a reescrever. O Visual Context grava hoje schemaVersion 1; o analisador rejeita um `captureId` ausente e qualquer schemaVersion que não seja 1 ou o legado 0. Siga só o que os pins descrevem. Se a pessoa não colou, peça para copiar de novo no Pinar em vez de reconstruir pins de memória.",
          ],
          bullets: [
            "Cole a área de transferência inteira no agente; não redigite comentários nem invente um `captureId` novo.",
            "Confirme que o texto colado ainda contém a cerca fechada pinar-visual-context antes de editar código.",
            "Se nada foi colado, peça `Command+Enter` / `Alt+Enter` no Pinar e siga somente as notas dos pins.",
          ],
        },
      ],
    },
    "handoff-formats": {
      title: "Formatos e destinos da entrega",
      summary:
        "Escolha contexto compacto ou completo e uma apresentação específica por agente sem mudar a identidade da captura.",
      sections: [
        {
          heading: "Compacto e completo",
          paragraphs: [
            "O modo compacto remove ruído redundante de localizadores e geometria, preservando a correlação. O modo completo mantém o conteúdo integral. Outra preferência inclui ou omite screenshots; desabilitá-los preserva metadados, pins, localizadores, revisão e entrega sem armazenar a imagem. Dados inline são removidos do texto para evitar prompts enormes. O diálogo Configurações do workspace sincroniza essas preferências com o destino ativo.",
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
            "Nas opções da extensão, um interruptor define o modo de entrega como completo quando ligado e compacto quando desligado. Compacto é o padrão gravado e mantém cada fato útil uma vez: `pinId`, comentário, cssSelector, domPath e innerText, mais box ou coords só em pins de área ou sem localizador. Completo mantém a captura integral. As duas projeções ainda removem URLs data: de screenshot do JSON; uma imagem inline vira URL nula e o aviso screenshot_inline para o prompt não inflar.",
            "Clique em Salvar para gravar o modo de entrega e `includeScreenshot` no destino ativo e nas preferências sincronizadas do Chrome. Valores desconhecidos de modo de entrega voltam para compacto; `includeScreenshot` começa ligado. Os destinos dos adaptadores são cursor, claude, codex e grok: cada um prefixa o próprio preâmbulo, mas `captureId`, pinIds e comentários permanecem idênticos. O interruptor Copiar conteúdo Markdown fica desabilitado quando Copiar Web Viewer está desligado.",
          ],
          bullets: [
            "Ajuste o interruptor compacto/completo e o de `includeScreenshot` e clique em Salvar antes da próxima cópia.",
            "Deixe `includeScreenshot` ligado, salvo se você quiser metadados, pins, localizadores e entrega sem armazenar a imagem.",
            "Depois de salvar, copie uma vez e confirme que o texto de cada adaptador ainda compartilha o mesmo `captureId` e os mesmos pinIds.",
          ],
        },
      ],
    },
    "ai-features": {
      title: "Funcionalidades de IA e como testá-las",
      summary: "Teste a transcrição por voz e transforme um fluxo gravado do navegador em passos escritos objetivos.",
      sections: [
        {
          heading: "Escolha um provedor para a reprodução",
          paragraphs: [
            "No servidor local, abra Configurações → Assistente de IA, escolha IA local ou BYOK, informe o endpoint compatível com OpenAI e o modelo e use Testar e salvar. IA local e BYOK não usam créditos do Pinar. No Pinar Cloud, a reprodução fica disponível para contas elegíveis autenticadas sem debitar créditos de IA.",
          ],
        },
        {
          heading: "Transcreva um comentário por voz",
          paragraphs: [
            "Conecte a extensão a uma conta Pro do Pinar Cloud, inicie o comentário de um pin e escolha o microfone. Grave por até 120 segundos, pare para inserir a transcrição no comentário ou envie diretamente. O guia Transcrição por voz e créditos de IA do Pinar Cloud explica as faixas atuais de cobrança e os estornos.",
          ],
        },
        {
          heading: "Gere passos escritos de reprodução",
          paragraphs: [
            "Abra a barra de captura do Pinar e pressione `G` para iniciar a gravação. Use a página normalmente, reabra o Pinar, adicione um pin e conclua com `Command+Enter` no macOS ou `Alt+Enter` no Windows e Linux. A extensão registra navegação, cliques, valores digitados, teclas e rolagens relevantes; valores sensíveis permanecem mascarados.",
            "Abra a sessão salva. Reprodução mostra a timeline bruta, que você pode editar antes de escolher Gerar passos escritos. A IA transforma essa timeline e os comentários dos pins em instruções objetivas, salvas com a sessão e incluídas na entrega ao seu agente local.",
          ],
          bullets: [
            "Edite ou remova eventos ruidosos da timeline antes de gerar.",
            "Revise as instruções geradas antes de entregá-las ao seu agente local.",
            "Deixe o agente local criar testes automatizados específicos com o repositório e suas convenções em contexto.",
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
            "Um resultado alterado move um pin aberto ou reaberto para pronto para aceitar. Somente uma pessoa pode aceitar a correção ou reabrir um pin aceito. Agentes não aceitam o próprio trabalho e transições inválidas são rejeitadas.",
          ],
          bullets: [
            "Fluxo normal: aberto → pronto para aceitar → aceito.",
            "Se a verificação falhar: aceito → reaberto → pronto para aceitar.",
          ],
        },
        {
          heading: "Registrar uma execução e aceitá-la como humano",
          paragraphs: [
            "Um agente relata o trabalho contra o `captureId` da captura e cada `pinId`. Repita uma entrega com a mesma chave só quando o resultado não mudou; um resumo, arquivos ou status diferentes precisam de uma chave nova. Pins ou capturas desconhecidos são rejeitados sem ecoar comentários privados.",
            "Uma pessoa aceita uma correção ou reabre um pin aceito pela interface de revisão. Agentes não aceitam o próprio trabalho. Depois de uma reabertura humana, a nova tentativa prevista é um segundo resultado alterado. Deixe as métricas anônimas do ciclo desligadas até optar por elas.",
          ],
          bullets: [
            "Publique um resultado alterado para o mesmo `captureId` e `pinId` e confirme no visualizador que o pin está pronto para aceitar.",
            "Reutilize uma chave de entrega só quando o resultado for idêntico; gere uma chave nova quando os arquivos, o resumo ou o status realmente mudarem.",
            "Se a verificação falhar, reabra como humano, publique um segundo resultado, aceite de novo e guarde os ids de captura anterior e posterior.",
          ],
        },
      ],
    },
    "handoff-troubleshooting": {
      title: "Resolver avisos de cópia e entrega",
      summary:
        "Recupere-se de falhas da área de transferência, do auxiliar, do screenshot ou do visualizador sem perder as anotações.",
      sections: [
        {
          heading: "Recuperação da cópia",
          paragraphs: [
            "O Pinar usa primeiro a API de área de transferência do navegador por um documento em segundo plano e recorre a uma seleção de texto oculta quando permissão ou foco bloqueiam a cópia. Se todos os mecanismos falharem, a sobreposição é restaurada para manter pins e comentários editáveis.",
          ],
        },
        {
          heading: "Degradado não significa sem correlação",
          paragraphs: [
            "`screenshot_missing` significa que a imagem não pôde ser persistida. `helper_unavailable` indica que o serviço local não foi alcançado. `viewer_unavailable` indica que não houve URL do visualizador. Continue com o comentário, o caminho DOM, o seletor, as coordenadas do pin, `captureId` e `pinId` e tente de novo só a camada ausente.",
          ],
        },
        {
          heading: "Percorrer o caminho da cópia quando a barra relata falha",
          paragraphs: [
            "A cópia exige um comentário salvo e pelo menos um pin. A barra mostra “Salvando sessão…”, esconde as sobreposições, captura a imagem e pede a um documento em segundo plano para gravar text/html e text/plain. Esse documento tenta primeiro a API de área de transferência do navegador e recorre a um evento de cópia do documento. Se essa gravação não for bem-sucedida, a página ainda tenta copiar o texto simples devolvido, inclusive por uma seleção oculta em um campo de texto.",
            "Quando todos os caminhos de cópia falham, a página restaura as sobreposições, mostra “Falha ao copiar” e deixa os pins editáveis. Uma cópia bem-sucedida mostra “Copiado com sucesso!”, ou “Copiado com sucesso!” seguido de “sem captura”, “auxiliar indisponível” ou “sem visualizador”, e então encerra a sessão. Esses sufixos correspondem a `screenshot_missing`, `helper_unavailable` e `viewer_unavailable`. screenshot_inline não é um dos avisos de entrega degradada. Um texto colado sem a cerca fechada pinar-visual-context não pode ser lido como JSON.",
          ],
          bullets: [
            "Se a barra disser “Escreva um comentário” ou “Adicione um pin”, conclua o pin e pressione `Command+Enter` / `Alt+Enter` de novo.",
            "Se aparecer “Falha ao copiar”, confirme que os pins ainda estão na página, conceda permissão de área de transferência se pedirem e tente copiar de novo.",
            "Leia o sufixo de “Copiado com sucesso!”: “sem captura”, “auxiliar indisponível” e “sem visualizador” nomeiam a camada ausente a retentar sem descartar comentários.",
          ],
        },
      ],
    },
    "organize-projects": {
      title: "Organizar projetos e sessões",
      summary:
        "Mova capturas sem perdê-las e mantenha Personal como destino protegido.",
      sections: [
        {
          heading: "Projetos e destino padrão",
          paragraphs: [
            "Projetos agrupam coleções e sessões. Personal é o projeto padrão protegido e Inbox é sua coleção protegida. Excluir outro projeto promove suas sessões ao destino padrão em vez de destruí-las.",
          ],
        },
        {
          heading: "Mover e ordenar",
          paragraphs: [
            "Arraste sessões entre coleções para reordená-las, ou use Mover para… em um conjunto selecionado.",
          ],
        },
        {
          heading: "Confirme onde a sessão movida realmente pousa",
          paragraphs: [
            "Abra uma coleção para ver e alterar a ordem manual salva arrastando uma sessão sobre a vizinha. Sem uma coleção selecionada, a listagem ordena pela data de criação, não por essa ordem salva.",
            "O arraste começa no cartão ou na linha da tabela, não na busca, nas caixas de seleção ou no menu de ações (`data-no-dnd`). Se a sessão arrastada já estiver selecionada com outras, todos os ids selecionados viajam juntos; senão, só aquela sessão se move. Mover para… pede um projeto e depois uma coleção na árvore achatada desse projeto; trocar o projeto limpa o campo da coleção, e um projeto sem coleções fica desabilitado. A sessão é acrescentada na próxima posição do destino. Excluir Personal é recusado; excluir outro projeto acrescenta as sessões em Inbox na ordem existente e remove as coleções daquele projeto.",
          ],
          bullets: [
            "Para mudar a ordem dentro de uma coleção, arraste uma sessão sobre a vizinha.",
            "Para mover várias sessões, selecione-as primeiro e arraste qualquer cartão selecionado ou abra Mover para…; arrastar um cartão não selecionado move só aquela sessão.",
            "Depois de excluir um projeto que não é Personal, abra Personal / Inbox e procure no fim da lista as sessões acrescentadas antes de arquivá-las de novo.",
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
            "Coleções podem ter coleções pai e filhas. Arrastar um ramo preserva profundidade e descendentes ao movê-lo dentro da árvore do mesmo projeto. Ciclos, pais desconhecidos e aninhamento sob um contêiner protegido são rejeitados. Excluir uma coleção pai promove suas filhas ao nível anterior na ordem existente.",
          ],
        },
        {
          heading: "Destinos pela captura",
          paragraphs: [
            "A extensão pode escolher projeto ou coleção antes de salvar na nuvem. Se o destino selecionado não estiver mais disponível, Personal/Inbox mantém a sessão acessível.",
          ],
        },
        {
          heading: "Indente um ramo e depois verifique o pai",
          paragraphs: [
            "Ao arrastar uma coleção, o deslocamento horizontal é medido em passos de recuo de 18 pixels. A profundidade projetada é limitada para não passar de um nível abaixo do irmão anterior nem ficar mais rasa que o irmão seguinte. Soltar um ramo sobre um descendente é ignorado e a árvore permanece. Coleções protegidas ficam na profundidade 0, e a lista ordenável trata filhas de uma coleção protegida como raízes para que não continuem aninhadas sob esse contêiner protegido.",
            "No seletor de destino da extensão, `destination:get` devolve um destino de captura (`projectId` e `collectionId`) e a árvore de projetos, com coleções aninhadas recuadas 16 pixels por nível. Trocar o projeto grava na hora a coleção protegida daquele projeto, se existir; senão, a primeira coleção. Se `destination:set` falhar, a página de opções mostra o erro de destino indisponível e recarrega `destination:get` para que uma coleção inexistente não continue selecionada. Uma árvore vazia mostra um placeholder desabilitado de Inbox.",
          ],
          bullets: [
            "Arraste uma coleção para a direita para aninhar sob o irmão anterior, ou para a esquerda rumo à raiz; se o soltar for recusado, a lista de pais permanece inalterada.",
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
            "A pesquisa encontra título da página, URL, descrição, comentários dos pins e seletores CSS. Filtros de quantidade de pins e status de revisão podem ser combinados. Alterne entre cards e tabela; a tabela oferece 15, 30, 60 ou 100 linhas por página e lembra a escolha neste navegador.",
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
            "A pesquisa ignora espaços nas pontas e compara como trecho sem diferenciar maiúsculas. Uma consulta só com espaços deixa todas as sessões elegíveis até os filtros de pins ou de revisão as excluírem. As caixas de quantidade de pins são faixas de 1, 2–5 e 6 ou mais; a sessão precisa cair em pelo menos uma faixa marcada. Os filtros de status de revisão usam as contagens de revisão salvas; se esses totais faltarem, cada pin é tratado como aberto. Mudar busca, qualquer filtro, coleção ou projeto volta a paginação para a primeira página.",
            "Selecionar tudo na grade vale só para a página atual de cartões; na tabela, vale a página atual da tabela. A escolha entre grade e tabela fica lembrada neste navegador. A exclusão em lote pede confirmação e depois remove cada sessão selecionada. O visualizador público de projeto ou coleção copia o Markdown combinado na página de compartilhamento. Se esse compartilhamento não existir mais, o visualizador mostra não encontrado em vez da lista.",
          ],
          bullets: [
            "Depois de aplicar busca ou filtros, confira se a paginação voltou à página 1 para não ler uma página antiga de outro resultado.",
            "Use Mover para… ou Excluir na barra em lote só depois que as caixas corresponderem às sessões desejadas; Limpar seleção esvazia o conjunto sem alterar o armazenamento.",
            "No visualizador agregado, Copiar Markdown deve colar um título, uma URL de visualizador `/p/` ou `/c/`, e cada sessão como um título `/v/{id}` com Page, Markdown, Screenshot opcional e comentários numerados dos pins; se a cópia falhar com Unable to load Markdown, abra a mesma URL `.md` no navegador.",
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
          heading: "Código por e-mail para Free e Pro",
          paragraphs: [
            "Informe seu e-mail na extensão ou em pinar.dev. O código de seis dígitos expira em dez minutos e bloqueia após cinco tentativas inválidas. A conta Free só é criada depois da confirmação do código. Provedores temporários são bloqueados para novas contas; domínios próprios são aceitos.",
          ],
        },
        {
          heading: "Sessões",
          paragraphs: [
            "Sessões web duram 30 dias e dispositivos autenticados da extensão duram 180 dias. Os códigos expiram por segurança.",
          ],
        },
        {
          heading: "Entre pela aba Conta da extensão",
          paragraphs: [
            "Abra a aba Conta, informe seu e-mail e solicite um código. Digite o código recebido para conectar a extensão à sua conta. Capturas de uma instalação anônima antiga são movidas para a conta durante a confirmação.",
            "A solicitação do código mostra a mesma resposta para endereços desconhecidos ou bloqueados, sem revelar se a conta existe. Sair encerra a sessão atual da extensão.",
          ],
          bullets: [
            "Se nenhum e-mail chegar, espere antes de tentar de novo; os códigos expiram, e tentativas demais são adiadas.",
            "Use um código atual recebido por e-mail; a extensão não oferece mais códigos de pareamento.",
            "Use Sair na aba Conta quando precisar encerrar imediatamente a sessão atual da web ou da extensão.",
          ],
        },
      ],
    },
    "plans-and-billing": {
      title: "Free, Pro e cobrança",
      summary:
        "Compare benefícios, gerencie a assinatura e trate a página de planos como fonte atual de preços.",
      sections: [
        {
          heading: "Formato dos planos",
          paragraphs: [
            "O aplicativo local e um servidor self-hosted continuam gratuitos. O Pinar Cloud hospedado segue a oferta atual e a elegibilidade da conta: uma conta nova pode receber uma avaliação temporária, e uma conta anterior pode manter elegibilidade legada. Não há um prazo único para todas as contas. Pro é um plano anual pago, com 2 GB e uma concessão única de 500 créditos de IA na primeira assinatura da conta. A transcrição por voz continua um benefício Pro. A página Planos e os direitos da conta mostram a oferta e a cota que valem agora. Capturas já guardadas na nuvem continuam sujeitas a retenção e exportação.",
          ],
        },
        {
          heading: "Cobrança e disponibilidade",
          paragraphs: [
            "Preços regionais em BRL ou globais em USD e ofertas atuais ficam na página Planos. O portal do cliente da Stripe cuida de mudanças de plano, cancelamento, formas de pagamento e faturas.",
          ],
        },
        {
          heading:
            "Inicie o Checkout com as políticas atuais e a moeda correta",
          paragraphs: [
            "Pagar em Planos aceita os Termos, a Política de Privacidade e o Uso Aceitável vigentes. O Brasil usa preços em BRL; outros países usam USD.",
            "Depois de um pagamento bem-sucedido, a oferta é concedida na conta autenticada e você volta ao workspace. O portal de cobrança fica disponível depois de um checkout pago. Quando uma assinatura Pro termina, essas sessões na nuvem entram numa janela de recuperação.",
          ],
          bullets: [
            "Continuar um checkout pago em Planos aceita as versões atuais das políticas.",
            "Os benefícios Pro exigem assinatura ativa; comprar um adicional não ativa o Pro.",
            "Se Gerenciar assinatura estiver indisponível, conclua primeiro um Checkout pago e depois abra-o numa conta autenticada.",
          ],
        },
      ],
    },
    "ai-credits": {
      title: "Transcrição por voz e créditos de IA do Pinar Cloud",
      summary:
        "Saiba como gravações de voz reservam, consomem, compram ou estornam créditos do Pinar Cloud.",
      sections: [
        {
          heading: "Custo da transcrição por voz",
          paragraphs: [
            "A transcrição por voz do Pinar Cloud é a única funcionalidade do Pinar que consome créditos de IA. Uma gravação de até 60 segundos reserva 1 crédito; de 61 a 120 segundos reserva 2. No sucesso, a reserva é consumida. Uma falha na transcrição estorna a reserva, e uma reserva não concluída por mais de cinco minutos é estornada automaticamente.",
            "Gravar uma timeline de reprodução e gerar seus passos escritos não debita créditos de IA. IA local e BYOK também nunca usam o saldo do Pinar Cloud.",
          ],
        },
        {
          heading: "Saldos",
          paragraphs: [
            "A primeira assinatura Pro da conta concede 500 créditos uma única vez. Renovar, cancelar e reativar ou trocar de plano não concede os créditos novamente. Pacotes comprados adicionam 500 créditos e duram até 12 meses.",
          ],
        },
        {
          heading: "Repita a transcrição por voz e consulte o histórico",
          paragraphs: [
            "No Pinar Cloud, se uma transcrição já estiver em andamento, espere terminar em vez de enviar a gravação novamente. Pedidos com falha estornam a reserva quando possível. Se o saldo estiver baixo demais, a extensão preserva o comentário digitado e informa que são necessários mais créditos.",
            "O saldo com vencimento mais próximo é usado primeiro. O menu da conta mostra os créditos restantes; não existe reposição mensal nem anual.",
          ],
          bullets: [
            "Se uma transcrição já estiver em andamento, espere terminar em vez de enviar a mesma gravação outra vez.",
            "Se uma reserva expirar ou for estornada, grave ou envie o comentário por voz novamente.",
            "Se o workspace mostrar zero créditos, confira o saldo restante antes de comprar outro pacote de 500 créditos.",
          ],
        },
      ],
    },
    "storage-and-retention": {
      title: "Armazenamento, retenção e recuperação",
      summary:
        "Entenda cotas, adicionais que expiram, uploads bloqueados e a janela de recuperação.",
      sections: [
        {
          heading: "Cota e adicionais",
          paragraphs: [
            "A cota na nuvem hospedada é o armazenamento que a conta autenticada inclui agora, mais qualquer adicional ainda ativo. Pro inclui 2 GB. Adicionais de 1 GB e 5 GB duram 12 meses, com avisos por e-mail antes da expiração. Se um adicional vencer acima da cota restante, novos uploads pausam; o excedente tem 30 dias de carência e permanece recuperável até o dia 90 antes de ficar elegível para exclusão. A compra de um adicional depende da oferta atual; confira a página Planos e os direitos da conta.",
          ],
        },
        {
          heading: "Depois da expiração do benefício",
          paragraphs: [
            "A expiração do adicional reduz a cota e pode bloquear novos uploads, mas não agenda exclusão automática. O cancelamento da assinatura segue a política separada de recuperação da retenção paga, descrita abaixo.",
          ],
        },
        {
          heading: "Encaixe substituições na cota e use o relógio de 90 dias",
          paragraphs: [
            "A cota é o armazenamento incluso do plano mais qualquer adicional ainda ativo. Substituir um screenshot maior por um menor pode passar quando uma captura nova estouraria a cota. Uploads pausam quando a conta está na cota ou acima dela, inclusive durante a carência e a recuperação.",
            "Sessões já armazenadas numa elegibilidade Free e não marcadas como permanentes ficam elegíveis para limpeza após 30 dias. Conteúdo Pro acima da cota Free segue carência de 30 dias e recuperação de 90 dias após o fim da elegibilidade paga. Histórico só local neste computador nunca é apagado remotamente. Elegibilidade não é promessa de remoção imediata.",
          ],
          bullets: [
            "Quando novas capturas pausarem, libere espaço excluindo sessões ou substituindo um screenshot pesado. Compre um adicional de 1 GB ou 5 GB por doze meses só quando a página Planos e os direitos da conta mostrarem essa compra.",
            "Se a conta estiver em carência ou recuperação, exporte o que ainda precisar antes do dia 90; a elegibilidade só marca o excedente, não apaga por si só.",
            "Não espere que desinstalar o app de desktop apague objetos na nuvem, nem que a nuvem apague o histórico local neste computador.",
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
            "Cada sessão, projeto ou coleção tem uma página não listada e uma cópia Markdown. Copiar Markdown coloca esse texto na área de transferência, e cada cartão de sessão abre o próprio visualizador. Um link ausente ou inválido mostra uma página de não encontrado, não o e-mail, o plano ou outros campos da conta.",
            "O Markdown da sessão inclui o pacote de entrega mais resultados de agentes e revisões de pins. O Markdown de projeto e coleção lista cada sessão aninhada com URL da página, comentários dos pins, `pinId` e localizadores. Linhas de screenshot só aparecem quando o dono permite a entrega de screenshot. Quem abre o link pode copiar o que vê, portanto URL não listada não é autorização.",
          ],
          bullets: [
            "Antes de enviar um link de projeto ou coleção, abra Copiar Markdown uma vez e confira se cada sessão aninhada, comentário de pin e linha de screenshot pode ser publicado.",
            "Desligue a entrega de screenshot na conta dona se o Markdown compartilhado não deve incluir URLs de imagem.",
            "Se um caminho compartilhado mostrar não encontrado, trate o link como inexistente ou inválido; essa página não acrescenta detalhes privados da conta.",
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
            "Screenshots e o histórico locais ficam neste computador. Preferências do navegador como visualização, idioma, tema e entrega permanecem neste navegador, salvo quando um recurso autenticado as sincroniza de propósito.",
          ],
        },
        {
          heading: "Limite da nuvem",
          paragraphs: [
            "Registros da conta, metadados de capturas e imagens ficam no serviço hospedado. A Stripe processa a cobrança, e o serviço de e-mail envia códigos de acesso. A página de Subprocessadores é a lista atual de papéis de serviços externos.",
          ],
        },
        {
          heading: "Confirme qual armazenamento realmente guarda cada captura",
          paragraphs: [
            "Screenshots locais são gravados como arquivos PNG, e o histórico da sessão fica neste computador. O tema é uma preferência só deste navegador, na aba Interface. Idioma e os interruptores de entrega da captura ficam no mesmo diálogo de configurações; uma conta autenticada na nuvem pode manter essas escolhas de entrega no workspace hospedado.",
            "Capturas hospedadas guardam metadados e imagens no serviço da nuvem. Visualizadores não listados e cópias Markdown ficam disponíveis sem uma sessão do workspace. Códigos de acesso por e-mail expiram, e o formulário não revela se a conta existe. A página de Subprocessadores nomeia os provedores hospedados atuais, e o Pinar não recebe os dados completos do cartão. As versões atuais das políticas estão nas páginas jurídicas.",
          ],
          bullets: [
            "Se o histórico local não abrir, o Pinar recupera um catálogo utilizável neste computador em vez de travar.",
            "Abra um screenshot hospedado pela página de compartilhamento ou pelo visualizador Markdown; uma imagem ausente mostra não encontrado, não detalhes da conta.",
            "Nas configurações, confirme o tema da Interface neste navegador e separe os interruptores de entrega da captura das escolhas sincronizadas na nuvem quando você estiver autenticado.",
          ],
        },
      ],
    },
    "automatic-sanitization": {
      title: "Sanitização automática",
      summary:
        "Veja quais dados de URL, DOM, credenciais e imagens inline o Pinar remove antes da entrega ou do armazenamento.",
      sections: [
        {
          heading: "Campos e URLs sensíveis",
          paragraphs: [
            "O Pinar oculta campos de senha, pagamento, token e código de uso único; remove fragmentos de URL; e retira chaves de query sensíveis como access_token, api_key, auth, password, secret, token e jwt. Você pode adicionar outros nomes nas configurações da extensão.",
          ],
        },
        {
          heading: "Entrega estruturada",
          paragraphs: [
            "O analisador de visual-context aceita versões compatíveis do schema e oculta erros internos de análise em vez de expor segredos brutos. Dados inline do screenshot são removidos da entrega textual; o pacote usa uma referência limitada por caminho ou URL.",
          ],
        },
        {
          heading:
            "Observe o relatório de redação e as imagens inline removidas",
          paragraphs: [
            "O Pinar oculta campos de senha, pagamento, token e código de uso único e depois limpa a URL da página. Valores de query com jeito de segredo são trocados por [redacted]. Nomes extras que você adiciona nas configurações entram nessa lista. Trechos iguais também são removidos de título, descrição, URL e pins.",
            "O bloco de visual-context copiado mantém `captureId` mesmo se o restante do conteúdo não puder ser analisado. Bytes inline de screenshot são removidos do pacote de texto para a cópia guardar um caminho de arquivo ou URL do visualizador. Se algumas regiões não puderam ser inspecionadas, o texto colado inclui um aviso de privacidade.",
          ],
          bullets: [
            "Depois de uma cópia, leia os avisos de privacidade no texto colado; algumas regiões podem estar marcadas como não inspecionadas.",
            "Inclua nomes extras de query como tokens separados por vírgula, espaço ou ponto e vírgula; a correspondência ignora maiúsculas.",
            "Se o JSON de entrega colado ainda contiver uma URL data: de screenshot, capture de novo para o pacote de texto guardar um caminho ou URL do visualizador.",
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
            "A API local aceita este computador e a origem publicada da extensão e verifica um segredo de capacidade salvo com permissões restritivas. A rotação mantém o segredo anterior válido por 24 horas para processos ativos adotarem o novo valor; a revogação remove o arquivo e força nova autorização.",
          ],
        },
        {
          heading: "Recuperação segura",
          paragraphs: [
            "Um bloqueio de instância obsoleto é substituído, enquanto uma instância em execução permanece intacta. Parar e reiniciar usam primeiro o encerramento gracioso do auxiliar; no macOS, um serviço travado só é encerrado se continuar respondendo depois da espera. Um histórico local corrompido volta a um esquema vazio com Personal e Inbox protegidos. Screenshots antigos em um caminho aninhado shots/shots são migrados sem sobrescrever conflitos de nome.",
          ],
        },
        {
          heading:
            "Apresente o segredo de capacidade e recupere o armazenamento local quebrado",
          paragraphs: [
            "O workspace local aceita somente a aplicação Pinar e a extensão oficial. A rotação mantém o segredo anterior válido o bastante para os processos em execução acompanharem; a revogação força uma autorização nova.",
            "Se outra instância do Pinar já estiver em execução, essa instância permanece no lugar. Pastas aninhadas de screenshots são migradas sem sobrescrever conflitos de nome. Se o histórico local não abrir, o Pinar recupera um projeto Personal e uma Inbox utilizáveis em vez de travar.",
          ],
          bullets: [
            "Continue usando a extensão oficial e a aplicação Pinar; outros sites não conversam com o workspace local.",
            "Depois de revogar o acesso local, reinicie o Pinar para o workspace autorizar de novo.",
            "Se o histórico local não abrir, espere um projeto Personal e uma Inbox recuperados, não um travamento.",
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
            "As métricas do ciclo ficam desligadas até você aceitar. Quando desabilitadas, entregas são descartadas. Quando habilitadas, o sanitizador aceita eventos operacionais, duração, agente e confiança de realocação, mas rejeita comentários, títulos, URLs, caminhos DOM, seletores, screenshots, markup e conteúdo bruto.",
          ],
        },
        {
          heading: "Consentimento e licença",
          paragraphs: [
            "Persistência remota e checkout registram a aceitação dos Termos, da Política de Privacidade e do Uso Aceitável atuais. Retenção, reembolsos, Fair Source e subprocessadores têm documentos publicados separados. O Pinar é Fair Source/source-available pela licença do repositório, não Open Source aprovado pela OSI nas versões atuais.",
          ],
        },
        {
          heading:
            "Verifique os dados de opt-in e o conjunto publicado de políticas",
          paragraphs: [
            "As métricas do ciclo permanecem desligadas até você optar. Quando habilitadas, só eventos operacionais são enviados. Comentários, títulos, URLs, seletores, screenshots e conteúdo semelhante são rejeitados.",
            "O checkout e o registro Free remoto registram as versões aceitas das políticas. Termos, Privacidade, Uso Aceitável, Retenção, Reembolsos, Fair Source e Subprocessadores são publicados em https://pinar.dev/legal/. O uso apenas local, que nunca contata o serviço hospedado, não precisa de conta hospedada. Dúvidas: contact@pinar.dev ou contato@pinar.dev.",
          ],
          bullets: [
            "Deixe as métricas do ciclo desligadas salvo se você pretende optar; uma configuração desligada não transmite um lote.",
            "Antes da persistência hospedada ou do checkout, abra Termos, Privacidade e Uso Aceitável em https://pinar.dev/legal/terms, /privacy e /acceptable-use.",
            "Trate a licença publicada como texto controlador dos limites Fair Source; os subprocessadores hospedados nomeados hoje são Cloudflare e Stripe.",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
