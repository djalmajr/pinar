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
      "Cada nota corresponde a uma tag publicada no repositório, sem misturar trabalho ainda não lançado.",
    pageTitle: "Novidades do Pinar",
    previous: "Anterior",
    releaseNavigation: "Navegação entre versões",
    releaseNotFound: "Versão não encontrada",
    releaseNotFoundDescription:
      "Essa versão não existe no histórico publicado.",
    viewDetails: "Ver detalhes",
    whatChanged: "O que mudou",
  },
  releases: {
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
} satisfies ReleaseLocale;

export default locale;
