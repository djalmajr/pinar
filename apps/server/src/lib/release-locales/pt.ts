import type { ReleaseLocale } from "../release-content";

const locale = {
  ui: {
    allReleases: "Todas as novidades",
    backToReleases: "Voltar às novidades",
    firstRelease: "Esta é a primeira versão",
    historyDescription:
      "Consulte o histórico para ver todas as tags publicadas.",
    latestRelease: "Você está na mais recente",
    metaDescription: "Notas oficiais das versões publicadas do Pinar.",
    next: "Próxima",
    pageDescription:
      "Cada nota corresponde a uma versão publicada ou preparada para o próximo lançamento, sem misturar trabalho fora desse escopo.",
    pageTitle: "Novidades do Pinar",
    previous: "Anterior",
    releaseNavigation: "Navegação entre versões",
    releaseNotFound: "Versão não encontrada",
    releaseNotFoundDescription:
      "Essa versão não existe no histórico publicado.",
    upcomingRelease: "Próxima versão · ainda não publicada",
    viewDetails: "Ver detalhes",
    whatChanged: "O que mudou",
  },
  releases: {
    "v0.9.0": {
      title: "Seu próprio endpoint de IA no Pinar Cloud",
      summary:
        "Contas Pro no Pinar Cloud podem cadastrar o próprio endpoint de IA, os erros de IA do assistente, da reprodução e da voz agora mostram a causa com escolha, os documentos legais descrevem esse endpoint, com novo aceite para o Pinar Cloud, e a contagem da barra lateral não cobre mais o botão de ações no celular.",
      changes: {
        "own-ai-endpoint": {
          title: "Seu próprio endpoint no Pinar Cloud (Pro)",
          description:
            "No Pinar Cloud, contas Pro podem cadastrar o próprio endpoint em Configurações → Assistente de IA: URL base HTTPS, chave da API e modelos opcionais de chat, Embeddings e transcrição. Um recurso é atendido por esse endpoint, sem créditos do Pinar Cloud, quando a capacidade correspondente passa no teste de conexão; um recurso cuja capacidade não passou segue pelos provedores do Pinar, com créditos, com a exceção da busca nos pins de uma resposta atendida por esse endpoint, que usa a visão e os Embeddings do endpoint quando passam, ou só o texto quando não passam. Quando o endpoint falha, o assistente e os passos escritos de reprodução mostram a causa com “Tentar de novo” e “Usar créditos do Pinar”, e a extensão oferece reenviar a mesma gravação de voz com créditos.",
        },
        "own-endpoint-legal-update": {
          title: "Documentos legais atualizados para o seu endpoint",
          description:
            "A Política de Privacidade, os Termos de Serviço e a página Provedores de Serviço e Suboperadores agora descrevem o seu próprio endpoint de IA: você escolhe e contrata o provedor, o tratamento que ele faz segue os termos entre você e ele, e o Pinar só encaminha os seus pedidos a ele. O tratamento ocorre onde esse provedor trata os dados, o que pode ser fora do Brasil. O provedor desse endpoint não é suboperador do Pinar. Se você usa o Pinar Cloud, aceita os documentos atualizados de novo.",
        },
        "sidebar-count-on-phones": {
          title: "A contagem da barra lateral não cobre mais o botão de ações no celular",
          description:
            "No celular, o botão de ações (⋮) das linhas da Caixa de entrada e das coleções na barra lateral do workspace fica sempre visível, e a contagem de sessões ficava em cima dele. Agora a contagem fica ao lado do botão, e um nome longo é cortado antes dela. Em telas maiores, nada muda.",
        },
      },
    },
    "v0.8.1": {
      title: "Voz e passos escritos voltam a funcionar no Pinar Cloud",
      summary:
        "O Pinar Cloud volta a transcrever comentários de voz e a gerar passos escritos de reprodução.",
      changes: {
        "cloud-voice-restored": {
          title: "A transcrição de voz e Gerar passos escritos estão de volta",
          description:
            "Na versão 0.8.0, o Pinar Cloud não oferecia a transcrição de voz nem Gerar passos escritos por causa de uma falha no servidor. Os dois voltam a funcionar com os mesmos créditos do Pinar Cloud: a voz usa 1 crédito por até 60 segundos e 2 de 61 a 120 segundos, e cada geração de passos escritos usa 1. O app local não muda.",
        },
      },
    },
    "v0.8.0": {
      title: "Um assistente para as suas capturas",
      summary:
        "Um chat no workspace responde sobre o seu trabalho e o organiza depois da sua confirmação, uma opção de captura escolhe a coleção por você, todos os recursos de IA do Pinar Cloud usam créditos e a Política de Privacidade, os Termos de Serviço e a página Provedores de Serviço e Suboperadores foram atualizados, com novo aceite para o Pinar Cloud.",
      changes: {
        "assistant": {
          title: "Pergunte ao assistente sobre as suas capturas",
          description: "Um novo chat no workspace, no aplicativo local e no Pinar Cloud, responde a perguntas sobre seus projetos, coleções, sessões, lotes e pins, inclusive sobre o que aparece na captura de tela de um pin. Ele também cria, renomeia, move, apaga, comenta, conclui e reabre itens, sempre como proposta: nada muda até você confirmar, e algumas ações podem ser desfeitas no próprio cartão. No aplicativo local, ele usa a IA que você configurou nas Configurações.",
        },
        "automatic-capture-destination": {
          title: "O Pinar escolhe a coleção das capturas novas",
          description: "Ligue “Escolher a coleção automaticamente” em Configurações → Captura e o Pinar coloca cada captura nova numa das suas coleções. Na dúvida, a captura vai para a Caixa de entrada, e as capturas de um mesmo lote ficam juntas. As sessões arquivadas assim mostram um selo; mover a sessão corrige a escolha e tira o selo. A opção precisa da IA disponível. Enquanto a opção ficar ligada sem a IA disponível, as capturas novas vão para a Caixa de entrada; para escolher o destino à mão, desligue a opção.",
        },
        "assistant-credits": {
          title: "Todos os recursos de IA do Pinar Cloud usam créditos",
          description: "No Pinar Cloud, toda chamada de IA agora acontece dentro de uma ação cobrada. O assistente faz parte do Pro e usa 3 créditos por mensagem, e uma resposta que falha devolve os créditos; confirmar ou desfazer uma proposta não custa nada. Gerar os passos escritos de reprodução agora usa 1 crédito por geração; uma geração que falha devolve o crédito, e sem saldo a resposta é recusada. Com a escolha automática da coleção, cada captura cuja coleção a IA escolhe usa 1 crédito, mesmo quando a resposta é a Caixa de entrada; uma escolha que falha ou estoura o prazo devolve o crédito, e sem saldo a IA não é chamada e a captura vai para a Caixa de entrada. Reenviar a mesma captura não cobra de novo. A indexação não acontece mais em segundo plano: os pins são indexados só enquanto o assistente responde a uma mensagem, o que os 3 créditos dela já cobrem, e a escolha automática usa o índice que já existe.",
        },
        "legal-update": {
          title: "Documentos legais atualizados",
          description:
            "A Política de Privacidade, os Termos de Serviço e a página Provedores de Serviço e Suboperadores foram atualizados. Agora descrevem os recursos de IA do Pinar Cloud, que acessam os provedores de IA pelo Vercel AI Gateway, o seu papel como controlador dos dados de terceiros no seu conteúdo enquanto o Pinar atua como operador, que a hospedagem do serviço fica na Alemanha e os cookies que o serviço usa: o Pinar não usa cookies de publicidade nem de análise. Se você usa o Pinar Cloud, aceita os documentos atualizados de novo.",
        },
      },
    },
    "v0.7.4": {
      title: "O Pinar Cloud mostra o botão certo desde o início",
      summary:
        "Quando você está conectado ao Pinar Cloud, o cabeçalho do site não mostra mais Entrar antes de trocar para Abrir app, e o card Apoie o desenvolvimento Fair Source não pisca mais para contas Pro.",
      changes: {
        "signed-in-header": {
          title: "Sem Entrar piscando para quem já está conectado",
          description:
            "O Pinar Cloud agora reconhece a sua sessão enquanto prepara a página, então o cabeçalho mostra Abrir app desde o primeiro instante e o card Apoie o desenvolvimento Fair Source fica oculto para contas Pro, em vez de aparecer e sumir. Se a sua sessão não puder ser conferida por um momento, o cabeçalho espera em vez de oferecer Entrar e confere de novo logo depois.",
        },
      },
    },
    "v0.7.3": {
      title: "Atualizações que se instalam pelo menu e voz mais clara com a sua própria IA",
      summary:
        "Escolher uma atualização no menu do Pinar agora a instala e reabre o Pinar. O aplicativo local confere o seu modelo de transcrição e diz por que a voz falha, e a central de ajuda cobre muito mais do Pinar.",
      changes: {
        "desktop-updates": {
          title: "Atualizações se instalam pelo menu do Pinar",
          description:
            "Escolher o item de atualização no menu do Pinar agora instala a versão baixada e reabre o Pinar, com o servidor local reiniciado nela. As versões anteriores fechavam sem atualizar, então instale esta versão uma vez pela página de download; a partir daí, as atualizações passam pelo menu. Se uma atualização não puder começar, o Pinar continua aberto e o menu avisa.",
        },
        "local-voice-checks": {
          title: "A voz com a sua própria IA explica o que está errado",
          description:
            "No aplicativo local, Testar conexão e Salvar em Configurações → Assistente de IA agora conferem o modelo de transcrição além do modelo principal e dizem por que a transcrição falha, por exemplo uma chave de API sem permissão para transcrever áudio. As configurações continuam sendo salvas quando só a transcrição falha, e um comentário de voz que falha no modo local não pede mais para conectar a extensão ao Pinar Cloud.",
        },
        "help-center": {
          title: "Uma central de ajuda mais completa",
          description:
            "A central de ajuda agora cobre as atualizações do aplicativo desktop, os hooks de sessão dos agentes, a conexão de agentes ao aplicativo local pelo MCP, as chaves de API para agentes, a sua própria IA no aplicativo local, a colaboração em coleções, a migração de dados entre o aplicativo local e o Pinar Cloud e as mensagens mostradas quando uma sessão não consegue terminar. Várias afirmações que não correspondiam mais ao Pinar foram corrigidas.",
        },
      },
    },
    "v0.7.2": {
      title: "Pinar Cloud em nova hospedagem",
      summary:
        "O serviço em nuvem do Pinar agora roda numa hospedagem nova. Contas, capturas, compras e créditos continuam os mesmos, e você não precisa fazer nada.",
      changes: {
        "cloud-hosting": {
          title: "Nova hospedagem do serviço em nuvem",
          description:
            "Capturas compartilhadas, transcrição de voz, sugestões de IA, e-mails de acesso e pagamentos agora rodam numa hospedagem nova. Durante a mudança, ações que gravam dados podem ficar indisponíveis por alguns minutos.",
        },
      },
    },
    "v0.7.1": {
      title: "Bandeja do Pinar mais estável no Windows",
      summary:
        "A bandeja do Windows volta a abrir depois de ser fechada à força, sai mais rápido, trabalha menos em segundo plano e se substitui antes que o crescimento de memória do seu runtime deixe o computador lento.",
      changes: {
        "tray-reliability": {
          title: "A bandeja sempre abre e sai mais rápido",
          description:
            "Depois de encerrada pelo Gerenciador de Tarefas, a bandeja podia se recusar a abrir de novo até alguém apagar um arquivo de trava à mão; agora ela reconhece que a bandeja antiga não existe mais. Sair pelo menu não espera mais os timers em segundo plano, e a bandeja deixou de recriar o menu e reler a opção de iniciar com o Windows a cada dois segundos.",
        },
        "tray-memory-guard": {
          title: "Proteção contra o crescimento de memória da bandeja",
          description:
            "O runtime de desktop por baixo da bandeja continua reservando memória mesmo parado. Até que isso seja corrigido na origem, a bandeja confere a própria memória a cada cinco minutos e, acima de 2 GB, se substitui discretamente por uma bandeja nova. O servidor local continua rodando, então capturas e agentes não são interrompidos.",
        },
      },
    },
    "v0.7.0": {
      title: "IA local com voz, um caminho para o Pinar Cloud e destino de captura mais claro",
      summary:
        "O Pinar Local volta a usar IA pelo seu próprio endpoint compatível com OpenAI, agora com comentários por voz. Você pode levar o trabalho local para o Pinar Cloud, escolher onde as capturas caem em um só menu e entender por que um código de login não chegou.",
      changes: {
        "local-ai-voice": {
          title: "IA local e BYOK com comentários por voz",
          description:
            "Configurações → IA no Pinar Local conecta um servidor local ou o seu próprio provedor compatível com OpenAI, com a chave guardada no cofre do sistema. Com um modelo de transcrição, a extensão grava comentários por voz no modo local e o servidor local os transcreve, opcionalmente transformando a transcrição em comentário e critérios de aceite. Nenhum crédito do Pinar é usado.",
        },
        "local-to-cloud-import": {
          title: "Leve o trabalho local para o Pinar Cloud",
          description:
            "Configurações → Dados exporta projetos, coleções, lotes, sessões e capturas de tela do Pinar Local em um único arquivo. No Pinar Cloud, a mesma seção importa esse arquivo sessão por sessão, com progresso e botão de cancelar. Importar o mesmo arquivo de novo atualiza o que já foi importado, sem duplicar.",
        },
        "capture-destination-picker": {
          title: "Escolha o destino das capturas em um só menu",
          description:
            "O app e as opções da extensão escolhem onde as novas capturas caem com um único menu em cascata: primeiro o projeto, depois a coleção, com busca, ícones e o caminho escolhido exibido no campo. A escolha fica sincronizada entre a extensão e o servidor.",
        },
        "sign-in-delivery-errors": {
          title: "Erros claros quando o código de login não pode ser enviado",
          description:
            "Quando o e-mail de login não pode ser entregue, o Pinar agora avisa no seu idioma, em vez de mostrar que o código foi enviado. A resposta é a mesma, tenha o endereço uma conta ou não.",
        },
        "windows-desktop": {
          title: "Pinar mais estável no Windows",
          description:
            "O app do Windows inicia o servidor local pela bandeja, respeita a opção de iniciar com o Windows, instala os hooks de sessão dos agentes e não abre mais uma janela do PowerShell ao ler a chave de IA.",
        },
      },
    },
    "v0.6.0": {
      title: "Gestão completa pelo MCP, handoff focado e diálogo de pins mais limpo",
      summary:
        "Agentes agora podem gerenciar projetos, coleções, lotes, sessões, pins e comentários pelo MCP — no Local, sem conta, e no Cloud, com chaves de escopo. Por padrão, ao finalizar a sessão só entram no handoff compacto os pins que ainda precisam de ação, e o diálogo de pins do viewer deixa de oferecer as abas técnicas.",
      changes: {
        "mcp-crud": {
          title: "Gestão completa de sessões e organização pelo MCP",
          description:
            "Agentes podem criar, ler, atualizar e excluir projetos, coleções, lotes, sessões, pins e comentários de pins pelo MCP. O Pinar Local oferece essas operações a agentes na mesma máquina, sem conta nem chave; o Pinar Cloud aplica a permissão e o escopo da chave a cada operação.",
        },
        "focused-handoff": {
          title: "Handoff focado, com o detalhe completo ao alcance",
          description:
            "Por padrão, ao finalizar a sessão, apenas os pins que ainda precisam de ação entram no handoff compacto, com o contexto da página para agirem sobre eles; o detalhe completo da sessão continua acessível pelos links do handoff. Com Prompt você copia o texto, com Link apenas o link da sessão e com Off nada é copiado. Notas dos pins e comentários da conversa continuam editáveis, seguindo as mesmas regras do viewer no Local e no Cloud.",
        },
        "viewer-technical-tabs-removed": {
          title: "Diálogo de pins sem as abas técnicas",
          description:
            "O diálogo de pins do viewer deixa de oferecer as abas técnicas. O contexto do pin agora aparece diretamente na pré-visualização, e a aba de conversa abre primeiro, reunindo comentários, evidências e edições.",
        },
      },
    },
    "v0.5.1": {
      title: "Acesso de agentes ao Cloud e revisão de pins mais clara",
      summary:
        "Contas Pro podem fornecer chaves Cloud com escopo para agentes e usar operações MCP configuradas manualmente. O viewer reúne a conversa e a revisão de cada pin, com controles mais claros para links de compartilhamento.",
      changes: {
        "cloud-agent-access": {
          title: "Chaves com escopo para agentes",
          description:
            "Contas Pro do Pinar Cloud podem criar chaves pessoais de agente com escopo de recurso, permissão e expiração, consultar o status e o último uso e revogá-las. Chaves com permissões que incluem leitura podem acessar Markdown e imagens privados dentro do escopo. O Pinar Local não emite essas chaves.",
        },
        "agent-mcp-operations": {
          title: "Operações do Pinar Cloud pelo MCP",
          description:
            "Um cliente MCP compatível pode usar as operações do Cloud depois que você configurar manualmente o endpoint HTTP e um header Authorization: Bearer com uma chave de agente. As ferramentas disponíveis leem dados de projetos, coleções, sessões e lotes dentro do escopo; organizam recursos; e publicam ou revogam links explicitamente quando a chave tem a permissão necessária em nível de conta. Não há OAuth, descoberta automática, exclusão nem operações de cobrança.",
        },
        "viewer-sharing-followups": {
          title: "Conversas de pins e controles de compartilhamento mais claros",
          description:
            "O viewer reúne o comentário original do pin, comentários posteriores e resultados de agentes na conversa de cada pin. Usuários autorizados podem comentar e concluir ou reabrir a revisão. Miniaturas das capturas abrem em uma visualização com zoom, com rótulos de pin mais claros e um aviso de privacidade quando partes da captura não foram verificadas. É possível publicar, copiar e revogar links; a revogação em lote atua nos links diretos de sessões, sem revogar links herdados de um projeto, coleção ou lote.",
        },
      },
    },
    "v0.5.0": {
      title: "Revisores na coleção e um workspace mais calmo",
      summary: "Uma conta Pro pode convidar revisores para uma coleção. O Cloud hospedado segue a oferta atual de cada conta. O viewer prepara Copiar prompt ao abrir a sessão, e a lista do workspace atualiza com menos carga em segundo plano.",
      changes: {
        "cloud-offer-eligibility": {
          title: "A elegibilidade do Cloud segue a oferta atual",
          description: "O aplicativo local e um servidor self-hosted continuam gratuitos. O Pinar Cloud hospedado segue a oferta atual e a elegibilidade da conta: uma conta nova pode receber uma avaliação temporária, e uma conta anterior pode manter a elegibilidade que já tinha. Não há um único prazo para todas as contas. Quando a página de planos oferece uma avaliação, são 14 dias de Pinar Cloud, até 250 MB, sem cartão. A transcrição de voz continua um benefício Pro. Durante uma avaliação, complementos de armazenamento e de créditos de IA exigem Pro.",
        },
        "collection-reviewers": {
          title: "Convide revisores para uma coleção",
          description: "Uma conta Pro pode convidar alguém por e-mail para ver e revisar uma única coleção. O convidado entra e aceita no aplicativo. O dono pode revogar o acesso. Se o Pro do dono termina, a coleção continua na lista, mas a revisão pausa até o Pro voltar. O convite não cobre outras coleções.",
        },
        "viewer-prompt-ready": {
          title: "Copiar prompt fica pronto ao abrir o viewer",
          description: "Abrir uma sessão agrupada prepara Copiar prompt em segundo plano. O botão mostra Preparando prompt… enquanto carrega e Não foi possível preparar o prompt se falhar. Copiar prompt continua a ação principal. Abrir prompt *.md permanece no menu da sessão.",
        },
        "quieter-workspace-refresh": {
          title: "A lista do workspace atualiza com menos frequência",
          description: "A lista de sessões procura mudanças externas cerca de cada 30 segundos, em vez de a cada poucos segundos. Voltar à aba, ou criar, mover, excluir ou compartilhar, atualiza lotes e links de compartilhamento na hora. Sessões que já estão compartilhadas continuam marcadas entre essas atualizações.",
        },
      },
    },
    "v0.4.7": {
      title: "Acesso ao Cloud nas configurações da extensão",
      summary: "A extensão entra no Pinar Cloud com um código enviado ao e-mail de uma conta já criada no site. As opções agora estão organizadas em Preferências e Captura.",
      changes: {
        "extension-cloud-account-settings": {
          title: "Acesso por e-mail e opções mais claras",
          description: "Crie a conta em pinar.dev e depois peça o código por e-mail nas opções de Servidor Remoto da extensão. O aceite legal fica no site. Na extensão, Preferências reúne armazenamento, idioma e tema; Captura reúne a entrega ao agente e a privacidade.",
        },
      },
    },
    "v0.4.6": {
      title: "Acesso por e-mail e Pro mais claros",
      summary: "A confirmação por e-mail tem um aviso legal mais simples. Contas com Pro concedido recebem as cotas normais do plano.",
      changes: {
        "sign-in-and-complimentary-pro": {
          title: "Confirmação por e-mail e benefícios Pro",
          description: "A tela de login deixa de exibir a versão dos documentos legais e mostra a ação de trocar e-mail com contorno. Contas com Pro cortesia recebem o armazenamento e os créditos de IA normais do plano.",
        },
      },
    },
    "v0.4.5": {
      title: "Rodapé e menu da conta mais claros",
      summary: "O rodapé da página inicial acompanha o conteúdo. O menu da conta mostra ações de planos e cobrança somente quando elas estão disponíveis.",
      changes: {
        "landing-footer-and-account-menu": {
          title: "Menos espaço vazio na página inicial",
          description: "O card de apoio e o rodapé vêm logo após o conteúdo. Contas Free sem cliente Stripe oferecem acesso aos planos, e contas sem cobrança não mostram um link de cobrança indisponível.",
        },
      },
    },
    "v0.4.4": {
      title: "Contas por e-mail e plano anual",
      summary: "O Free no Pinar Cloud agora começa com acesso por e-mail. O Pro tem somente preço anual, com retenção, armazenamento e adicionais mais claros.",
      changes: {
        "email-first-cloud": {
          title: "Acesso por e-mail ao Cloud",
          description: "Crie uma conta Free ou entre com um código de seis dígitos enviado por e-mail. Domínios temporários são bloqueados, domínios próprios são aceitos e a extensão deixa de gerar códigos temporários de acesso.",
        },
        "annual-only-pricing": {
          title: "Um único plano Pro anual",
          description: "Novas assinaturas Pro custam R$ 99 por ano no Brasil ou US$ 29 por ano nos demais países. Assinaturas existentes mantêm seu preço atual. A retenção Free no Cloud é de 30 dias; o Pro inclui 2 GB e 500 créditos iniciais de IA. As ofertas mensal e Founder foram retiradas, e as notas legais da página de preços ficam no rodapé.",
        },
      },
    },
    "v0.4.3": {
      title: "Versão sem o rótulo de lugar",
      summary: "Configurações mostra só o número da versão. O endereço já diz se você está na nuvem ou neste computador.",
      changes: {
        "version-without-runtime-badge": {
          title: "O rótulo Nuvem ao lado da versão saiu",
          description: "A seção Sobre não repete mais Nuvem ou Local ao lado da versão. O endereço do site já mostra qual dos dois está em uso.",
        },
      },
    },
    "v0.4.2": {
      title: "A extensão permanece conectada",
      summary:
        "A extensão deixa de mostrar Unauthorized quando o navegador também tem uma sessão do site Pinar.",
      changes: {
        "extension-session-isolation": {
          title: "O acesso da extensão fica independente do site",
          description:
            "O armazenamento remoto usa a credencial da própria extensão. A sessão do site só entra quando a extensão não enviou a dela, então um login antigo do site não bloqueia a extensão.",
        },
      },
    },
    "v0.4.1": {
      title: "Créditos de IA sustentáveis e armazenamento sob medida",
      summary:
        "O Pro agora começa com um saldo único de 500 créditos de IA do Pinar Cloud e 2 GB de armazenamento na nuvem. Os adicionais ficaram menores, mais claros e mantêm validade de 12 meses, sem reposição mensal de créditos.",
      changes: {
        "sustainable-ai-credits": {
          title: "500 créditos iniciais de IA do Pinar Cloud",
          description:
            "A primeira assinatura Pro concede 500 créditos de IA do Pinar Cloud uma única vez. A transcrição de voz usa um crédito até 60 segundos e dois créditos entre 61 e 120 segundos; créditos adicionais vêm em pacotes de 500 válidos por 12 meses.",
        },
        "right-sized-storage": {
          title: "2 GB no Pro, com adicionais de 1 GB e 5 GB",
          description:
            "O Pro inclui 2 GB de armazenamento na nuvem. Os pacotes disponíveis passam a ser de 1 GB e 5 GB, acumuláveis e válidos por 12 meses, enquanto adicionais de 5 GB e 20 GB comprados anteriormente continuam respeitados.",
        },
        "storage-expiry-protection": {
          title: "Um caminho claro após o armazenamento expirar",
          description:
            "Se o uso superar a cota restante, novos uploads pausam quando o armazenamento expira. O excedente recebe 30 dias de carência e permanece recuperável até o dia 90 antes de se tornar elegível para um processo de limpeza auditado separadamente.",
        },
      },
    },
    "v0.4.0": {
      title: "Captura contínua, revisão unificada e IA em cada pin",
      summary:
        "Uma sessão de captura agora acompanha você entre páginas e salva cada screenshot e pin como um único registro. A revisão foi unificada no visualizador, a oferta Founder foi aposentada e os pins ganharam estrutura, evidência técnica e ações de IA.",
      changes: {
        "continuous-capture-session": {
          title: "Uma sessão contínua entre páginas",
          description:
            "Pine em uma página, continue navegando e conclua uma única vez. O Pinar captura cada pin antes da navegação, preserva a numeração entre páginas e salva toda a jornada em uma sessão, sem slots de lote.",
        },
        "unified-session-review": {
          title: "Revise todas as telas e pins juntos",
          description:
            "Sessões com várias páginas abrem em um único pan-and-zoom, com todas as anotações no painel lateral. Tab revisa a captura ativa, Esc oculta a toolbar e sessões salvas permanecem no visualizador em vez de reabrir na página original.",
        },
        "founder-retired": {
          title: "Oferta Founder aposentada",
          description:
            "Novas compras agora oferecem somente Free e Pro. Como não há assinantes Founder, a migração remove a oferta e interrompe para tratamento explícito se encontrar qualquer conta, compra, concessão, captura ou reserva ativa Founder inesperada.",
        },
        "element-structure": {
          title: "Estrutura em todo pin de elemento",
          description:
            "Cada pin de elemento guarda sua árvore HTML, os estilos computados fora do padrão, fontes, ícones e os elementos ao redor. O visualizador mostra isso em Estrutura, e tudo viaja no bloco pinar-visual-context.",
        },
        "technical-evidence": {
          title: "Evidência técnica",
          description:
            "Erros de console, requisições com falha e o ambiente observados enquanto você pinava são listados com o pin, classificados como Após interação ou Mesma página. Nada é inferido e nenhum crédito do Pinar Cloud é gasto.",
        },
        "pin-diagnosis": {
          title: "Diagnosticar um pin no Pinar Cloud (3 créditos)",
          description:
            "A IA explica a causa provável do pin a partir da estrutura e propõe uma correção em CSS com um nível de confiança. Aceite, edite ou descarte; só diagnósticos aceitos ficam com o pin.",
        },
        "save-as-component": {
          title: "Salvar um pin como componente no Pinar Cloud (10 créditos)",
          description:
            "Transforme um elemento capturado em HTML + CSS, React + Tailwind ou Preact + htm, com arquivos, dependências, notas de fidelidade, prévia, download em ZIP e StackBlitz.",
        },
        "step-recording": {
          title: "Grave e organize passos de reprodução",
          description:
            "Pressione G na página para gravar cliques, digitação, rolagem e navegação. Reabra o Pinar, pine e copie para anexar a timeline; G de novo a descarta. O visualizador transforma a gravação em passos escritos objetivos para o seu agente local.",
        },
        "collection-design-system": {
          title: "Design system de uma coleção no Pinar Cloud (15 créditos)",
          description:
            "Extraia cores, tipografia, espaçamento, raios e sombras compartilhados pelos pins de uma coleção. Exporte como variáveis CSS, tema Tailwind, tokens W3C ou DESIGN.md.",
        },
        "windows-tray-icon": {
          title: "Ícone do tray nítido no Windows",
          description:
            "O ícone da área de notificação é renderizado no tamanho que a escala da tela pede, então não fica mais borrado em 125%, 150% ou 200%.",
        },
      },
    },
    "v0.3.6": {
      title: "A verificação de atualização do tray fica visível",
      summary:
        "O app da barra de menu mostra Verificando atualizações, Tudo atualizado ou Falha ao verificar atualizações, cada um com uma contagem de 10 segundos até voltar a Verificar atualizações.",
      changes: {
        "tray-update-status": {
          title: "Estado da verificação no tray",
          description:
            "Verificar atualizações passa a Verificando atualizações enquanto corre. Se já estiver na versão atual, mostra Tudo atualizado (10s). Se falhar, mostra Falha ao verificar atualizações (10s). Os dois contam até voltar a Verificar atualizações. Um clique durante a contagem verifica de novo.",
        },
      },
    },
    "v0.3.5": {
      title: "Aba Conta, pagamento único só Founder, captura copia mais cedo",
      summary:
        "A aba Conta da extensão é uma faixa de código numa linha. O plano único é só Founder. A captura copia os comentários assim que estão prontos, e Alt+Enter funciona como Ctrl+Enter.",
      changes: {
        "account-tab-options": {
          title: "Faixa de código na aba Conta",
          description:
            "Instalações Free geram um código temporário numa fileira de ícones, com a contagem abaixo do campo. Contas pagas mostram e-mail e plano; Sair é outline; Gerenciar assinatura só no Pro.",
        },
        "lifetime-folded-into-founder": {
          title: "Lifetime é Founder",
          description:
            "O plano de pagamento único é só Pinar Founder. O checkout ainda aceita o metadata antigo lifetime_founder. Não há rótulo, env nem alias de Price Lifetime.",
        },
        "capture-copy-sooner": {
          title: "Copiar antes de gravar o screenshot",
          description:
            "Ctrl+Enter, Command+Enter ou Alt+Enter copia comentários e localizadores primeiro, enquanto o auxiliar ainda grava o screenshot. O progresso não fica em 80% depois que o paste já está pronto.",
        },
      },
    },
    "v0.3.4": {
      title: "Políticas aceitas ao continuar",
      summary:
        "Pagar em Planos ou verificar o código da conta aceita os Termos, a Política de Privacidade e o Uso Aceitável vigentes. Não há diálogo extra.",
      changes: {
        "checkout-policy-acceptance": {
          title: "Pagar é aceitar",
          description:
            "Iniciar um checkout pago em Planos grava os Termos, a Política de Privacidade e o Uso Aceitável vigentes. O diálogo extra saiu.",
        },
        "sign-in-policy-acceptance": {
          title: "Entrar é aceitar",
          description:
            "Verificar o código da conta por e-mail grava as mesmas políticas vigentes. O passo extra de aceitar saiu. O Free remoto ainda aceita nas opções da extensão.",
        },
      },
    },
    "v0.3.3": {
      title: "Menu da conta no local e Free sem IA",
      summary:
        "O workspace local usa o mesmo popover da conta que o Free. A Página Inicial fica nesse menu, e o Free deixa de incluir créditos ou resumos de IA.",
      changes: {
        "local-account-menu": {
          title: "Menu da conta no local",
          description:
            "O rodapé do workspace local agora abre o mesmo popover da conta que o Free. A Página Inicial fica dentro do menu. Sair some no local, porque não há sessão na nuvem para encerrar.",
        },
        "free-without-ai": {
          title: "Free sem IA",
          description:
            "O Free deixa de conceder créditos de IA e de mostrar o resumo com IA. Os resumos ficam no Pro, Founder e Lifetime. Planos e ajuda passam a refletir esse limite.",
        },
      },
    },
    "v0.3.2": {
      title: "Instalador Windows completo",
      summary:
        "O download do Windows agora é o ZIP completo do Setup. Extraia e execute o Pinar-Setup.exe ao lado da pasta .installer.",
      changes: {
        "windows-setup-zip": {
          title: "ZIP completo do Setup no Windows",
          description:
            "O GitHub Releases agora publica o win-x64-Pinar-Setup.zip, com o Pinar-Setup.exe e o payload .installer juntos. O exe de 1,2 MB deixou de ser listado, porque sozinho não instala.",
        },
        "windows-help-links": {
          title: "Links de instalação no Windows",
          description:
            "A ajuda e as Opções baixam o ZIP. Depois de extrair, mantenha a pasta .installer ao lado do Pinar-Setup.exe e, se o Windows mostrar o SmartScreen, continue por Mais informações e Executar mesmo assim.",
        },
      },
    },
    "v0.3.1": {
      title: "Aplicação Windows e capas únicas na ajuda",
      summary:
        "Use o Pinar na área de notificação do Windows, baixe o instalador Setup e abra artigos de ajuda com capa própria.",
      changes: {
        "windows-desktop-app": {
          title: "Aplicação para Windows",
          description:
            "O Pinar agora tem aplicação de bandeja no Windows. Baixe o win-x64-Pinar-Setup.exe, execute o instalador e inicie o auxiliar local pela área de notificação — o mesmo fluxo de captura local do macOS.",
        },
        "unique-help-covers": {
          title: "Capas únicas na ajuda",
          description:
            "Cada um dos 27 artigos de ajuda agora tem a própria imagem de capa, para que guias como instalação, primeira captura, atalhos e cobrança não compartilhem mais a mesma captura.",
        },
        "windows-first-run-help": {
          title: "Ajuda na primeira execução no Windows",
          description:
            "O guia de instalação agora explica como seguir depois do bloqueio inicial do SmartScreen: abra “Mais informações” e escolha “Executar mesmo assim”.",
        },
      },
    },
    "v0.3.0": {
      title: "Workspace e captura mais claros",
      summary:
        "Organize coleções em crescimento, ajuste o Pinar em uma única área e revise cada captura com feedback visual e ajuda mais claros.",
      changes: {
        "workspace-organization": {
          title: "Organização do workspace",
          description:
            "Coleções aninhadas agora comportam bibliotecas maiores com hierarquia mais clara, navegação redimensionável, controles compactos e contexto da coleção na visão de todos os itens.",
        },
        "global-settings": {
          title: "Configurações globais",
          description:
            "Uma área dedicada reúne preferências gerais, de captura, privacidade, interface, tema e detalhamento da cópia em uma experiência consistente.",
        },
        "capture-feedback": {
          title: "Feedback de captura mais claro",
          description:
            "Dimensões da seleção, foco no comentário do pin, previews de imagem, tratamento de regiões ocultas e progresso ao gravar tornam a captura mais fluida e previsível.",
        },
        "help-center": {
          title: "Central de ajuda aprimorada",
          description:
            "Os guias de instalação e primeira captura estão mais curtos e claros, imagens abrem em preview com zoom e artigos longos destacam a seção visível.",
        },
      },
    },
    "v0.2.0": {
      title: "Lotes de captura e preferências sincronizadas",
      summary:
        "Agrupe capturas de várias páginas em um só prompt, mantenha todas as preferências no servidor e use o Pinar em sete idiomas de ponta a ponta.",
      changes: {
        "capture-batches": {
          title: "Lotes de captura",
          description:
            "Pressione Alt+Shift+B para agrupar as próximas capturas; pressione de novo para finalizar e copiá-las como um só prompt. Os lotes ficam em uma pasta na barra lateral, e Alt+Shift+X ou o menu do ícone encerra um sem copiar.",
        },
        "server-preferences": {
          title: "Preferências no servidor",
          description:
            "Destino da captura, cópia do lote, formato do handoff, chaves de URL ocultas e idioma vivem no servidor e ficam em sincronia com a extensão. As Configurações ganharam seções de Captura, Handoff e Privacidade.",
        },
        "localized-everywhere": {
          title: "Sete idiomas em tudo",
          description:
            "A toolbar, o menu do ícone e o prompt entregue ao agente seguem o idioma escolhido, junto do workspace e das Opções.",
        },
        "progress-toolbar": {
          title: "Progresso na toolbar",
          description:
            "Cmd+Enter transforma a toolbar em uma barra de progresso - gravando, concluído ou erro - e o obturador do screenshot agora dura dois quadros. Encerrar um lote informa o resultado em uma notificação.",
        },
        "about-and-versioning": {
          title: "Sobre e uma versão só",
          description:
            "Configurações > Sobre mostra o que é o Pinar, sua versão e as notas de lançamento. Uma versão do produto rege o app, o site e as tags, e builds de produção saem apenas de uma tag de release.",
        },
      },
    },
    "v0.1.5": {
      title: "Inicialização confiável no login",
      summary:
        "O Pinar.app agora preserva a configuração de início no macOS sem recarregar o agente desnecessariamente.",
      changes: {
        "idempotent-login-setup": {
          title: "Configuração idempotente de início",
          description:
            "O app da barra de menus verifica se o LaunchAgent já existe antes de configurá-lo, evitando uma segunda abertura por RunAtLoad.",
        },
        "preference-preserved": {
          title: "Preferência preservada",
          description:
            "A preferência salva de iniciar no login permanece intacta, sem ciclos de descarregar e recarregar durante a abertura normal.",
        },
      },
    },
    "v0.1.4": {
      title: "Inicialização serializada no macOS",
      summary:
        "Hooks de agentes executados ao mesmo tempo não criam mais instâncias duplicadas do Pinar.app nem ícones fantasma no Dock.",
      changes: {
        "single-app-instance": {
          title: "Instância única do app",
          description:
            "Um bloqueio atômico por PID mantém a instância ativa no controle enquanto uma abertura duplicada termina com segurança.",
        },
        "coordinated-hooks": {
          title: "Hooks coordenados",
          description:
            "Os hooks de sessão e o instalador agora serializam a abertura do app e aguardam sua prontidão, em vez de disputar entre si.",
        },
      },
    },
    "v0.1.3": {
      title: "Fluxos de conta e captura em iframe mais precisos",
      summary:
        "Gerenciamento de conta, seleção em iframes, deduplicação de envios, navegação pública e proteção da abertura do app foram refinados em conjunto.",
      changes: {
        "nested-iframe-locators": {
          title: "Localizadores em iframes aninhados",
          description:
            "Os caminhos DOM capturados agora preservam cada limite de frame, permitindo localizar com mais precisão pins dentro de iframes aninhados.",
        },
        "single-flight-uploads": {
          title: "Envios sem duplicação",
          description:
            "Pedidos repetidos de captura compartilham um único envio em andamento, evitando sessões duplicadas e condições de corrida.",
        },
        "account-clarity": {
          title: "Conta mais clara",
          description:
            "A tela de conta da extensão agora deixa plano, armazenamento, cobrança e consentimento jurídico mais fáceis de entender e gerenciar.",
        },
        "duplicate-launch-guard": {
          title: "Proteção contra abertura duplicada",
          description:
            "Os hooks de sessão detectam o app da barra de menus já ativo antes de tentar abrir outra instância no macOS.",
        },
      },
    },
    "v0.1.2": {
      title: "Pinar.app para macOS",
      summary:
        "A experiência local do Pinar passou a viver em um app nativo na barra de menus, com helper integrado, controle de início e atualizações pelo GitHub.",
      changes: {
        "native-menu-bar-app": {
          title: "App nativo na barra de menus",
          description:
            "Abra o workspace, inicie ou pare o servidor local, veja a porta ativa e controle o início no login pelo Pinar.app.",
        },
        "bundled-local-helper": {
          title: "Helper local integrado",
          description:
            "O app cria a pasta local do Pinar, executa o helper e registra os hooks dos agentes de IA compatíveis sem instalar um daemon separado.",
        },
        "automatic-updates": {
          title: "Atualizações automáticas",
          description:
            "O app verifica artefatos publicados pelo GitHub Releases e impede downgrades acidentais.",
        },
        "unified-macos-installer": {
          title: "Instalador unificado no macOS",
          description:
            "O instalador público agora baixa, instala e abre o Pinar.app como produto local compatível no macOS.",
        },
      },
    },
    "v0.1.1": {
      title: "Captura visual, workspace na nuvem e Founder",
      summary:
        "A primeira versão pública conectou anotações no navegador a workspaces local e na nuvem, handoffs para agentes de IA, compartilhamento, planos e controles de privacidade.",
      changes: {
        "element-and-area-capture": {
          title: "Captura de elementos e áreas",
          description:
            "Pine um ou vários elementos DOM ou áreas livres, escreva comentários, capture screenshots e copie um pacote estruturado pelo Chrome.",
        },
        "local-helper-and-agent-hooks": {
          title: "Helper local e hooks de agentes",
          description:
            "Um helper local armazena screenshots e histórico, enquanto hooks de sessão deixam agentes de código compatíveis prontos para receber o contexto do Pinar.",
        },
        "cloud-workspace-and-sharing": {
          title: "Workspace na nuvem e compartilhamento",
          description:
            "Contas sem senha, projetos, coleções aninhadas, visualizadores e links não listados de sessão, projeto e coleção chegaram juntos.",
        },
        "plans-ai-and-storage": {
          title: "Planos, IA e armazenamento",
          description:
            "Free, Pro e o acesso limitado Founder introduziram retenção na nuvem, cotas de armazenamento, resumos por IA, assinaturas e pacotes opcionais de créditos ou espaço.",
        },
        "privacy-and-legal-controls": {
          title: "Controles de privacidade e termos",
          description:
            "Redação de campos sensíveis, máscaras manuais, consentimento versionado e políticas publicadas estabeleceram o limite de segurança da nuvem.",
        },
      },
    },
  },
  upcoming: {
    changes: {
      "byok-test-before-save": {
        description:
          "Em Configurações → Assistente de IA, “Testar e salvar” testa a URL, a chave e os modelos digitados antes de gravar o seu endpoint no Pinar Cloud, e só grava quando ao menos uma capacidade passa; se nenhuma passar, nada é salvo e a configuração anterior continua valendo. “Testar conexão” testa de novo o endpoint salvo, e só o botão clicado mostra o andamento.",
        title: "Endpoint próprio testado antes de salvar",
      },
      "assistant-slow-models": {
        description:
          "O assistente não encerra mais a resposta depois de 60 segundos fixos: ele espera enquanto o modelo continua respondendo e para depois de 1 minuto sem nenhuma resposta, de 3 minutos na mesma tentativa ou de 4 minutos no total e oferece “Tentar de novo”. Depois de um erro, “Consultando…” não fica mais na conversa. O botão do assistente no cabeçalho ficou só com o ícone, sem fundo.",
        title: "O assistente espera um modelo lento que continua respondendo",
      },
    },
    summary:
      "O endpoint próprio do Pinar Cloud é testado antes de ser salvo, e só o botão clicado mostra o andamento. O assistente espera um modelo lento enquanto ele continua respondendo, para de mostrar “Consultando…” depois de um erro e o botão do assistente no cabeçalho ficou só com o ícone.",
    title: "Endpoint próprio testado antes de salvar e um assistente que espera modelos lentos",
  },
} satisfies ReleaseLocale;

export default locale;
