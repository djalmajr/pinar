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
