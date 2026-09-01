import type { ReleaseLocale } from "../release-content";

const locale = {
  ui: {
    allReleases: "Toutes les versions",
    backToReleases: "Retour aux versions",
    firstRelease: "Ceci est la première version",
    historyDescription:
      "Ouvrez l’historique pour voir toutes les étiquettes publiées.",
    latestRelease: "Vous êtes sur la plus récente",
    metaDescription: "Notes officielles de chaque version étiquetée de Pinar.",
    next: "Suivante",
    pageDescription:
      "Chaque note correspond à une étiquette publiée dans le dépôt, sans y mêler le travail non publié.",
    pageTitle: "Nouveautés de Pinar",
    previous: "Précédente",
    releaseNavigation: "Navigation des versions",
    releaseNotFound: "Version introuvable",
    releaseNotFoundDescription:
      "Cette version n’est pas dans l’historique publié.",
    viewDetails: "Voir les détails",
    whatChanged: "Ce qui a changé",
  },
  releases: {
    "v0.1.5": {
      title: "Lancement fiable à la connexion",
      summary:
        "Pinar.app conserve désormais la configuration de connexion macOS existante sans recharger l’agent inutilement.",
      changes: {
        "idempotent-login-setup": {
          title: "Configuration de connexion idempotente",
          description:
            "La barre de menus vérifie si son LaunchAgent existe déjà avant de le configurer, ce qui évite un second lancement RunAtLoad.",
        },
        "preference-preserved": {
          title: "Préférence conservée",
          description:
            "La préférence enregistrée Ouvrir à la connexion reste intacte, sans cycle unload/reload au démarrage normal.",
        },
      },
    },
    "v0.1.4": {
      title: "Démarrage sérialisé de la barre de menus macOS",
      summary:
        "Des hooks d’agents concurrents ne peuvent plus créer d’instances Pinar.app en double ni de tuiles fantômes dans le Dock.",
      changes: {
        "single-app-instance": {
          title: "Instance unique de l’app",
          description:
            "Un verrou PID atomique laisse la barre de menus en cours d’exécution conserver la propriété, tandis qu’un lancement en double se termine proprement.",
        },
        "coordinated-hooks": {
          title: "Hooks coordonnés",
          description:
            "Les hooks de session et l’installateur sérialisent désormais le démarrage de la barre de menus et attendent qu’elle soit prête, au lieu de se concurrencer.",
        },
      },
    },
    "v0.1.3": {
      title: "Flux de compte et de capture iframe plus nets",
      summary:
        "La gestion de compte, le ciblage d’iframe, la déduplication des envois, la navigation publique et la protection contre les lancements multiples ont été peaufinés ensemble.",
      changes: {
        "nested-iframe-locators": {
          title: "Localisateurs d’iframes imbriquées",
          description:
            "Les chemins DOM capturés conservent désormais chaque frontière de cadre, ce qui permet de localiser plus précisément les pins dans des iframes imbriquées.",
        },
        "single-flight-uploads": {
          title: "Envois à vol unique",
          description:
            "Les demandes de capture répétées partagent un seul envoi en cours, ce qui évite les sessions en double et les courses d’upload.",
        },
        "account-clarity": {
          title: "Compte plus lisible",
          description:
            "L’écran de compte de l’extension rend désormais l’état du plan, du stockage, de la facturation et du consentement juridique plus facile à comprendre et à gérer.",
        },
        "duplicate-launch-guard": {
          title: "Garde contre les lancements en double",
          description:
            "Les hooks de session d’agent détectent une barre de menus macOS déjà en cours d’exécution avant d’essayer d’ouvrir une autre instance.",
        },
      },
    },
    "v0.1.2": {
      title: "Pinar.app pour macOS",
      summary:
        "L’expérience Pinar locale est passée dans une application native de barre de menus, avec un helper intégré, le contrôle de la connexion et des mises à jour via GitHub.",
      changes: {
        "native-menu-bar-app": {
          title: "Application native de barre de menus",
          description:
            "Ouvrez le workspace, démarrez ou arrêtez le serveur local, inspectez son port actif et gérez Ouvrir à la connexion depuis Pinar.app.",
        },
        "bundled-local-helper": {
          title: "Helper local intégré",
          description:
            "L’application crée le répertoire Pinar local, lance le helper et enregistre les hooks d’agents d’IA pris en charge, sans installer de démon séparé.",
        },
        "automatic-updates": {
          title: "Mises à jour automatiques",
          description:
            "L’application vérifie les artefacts signés publiés via GitHub Releases et refuse les rétrogradations accidentelles.",
        },
        "unified-macos-installer": {
          title: "Installateur macOS unifié",
          description:
            "L’installateur public télécharge, installe et lance désormais Pinar.app comme produit local pris en charge sur macOS.",
        },
      },
    },
    "v0.1.1": {
      title: "Capture visuelle, workspace cloud et Founder",
      summary:
        "La première version produit étiquetée a relié les annotations du navigateur aux workspaces locaux et cloud, aux transferts vers les agents d’IA, au partage, aux plans et aux contrôles de confidentialité.",
      changes: {
        "element-and-area-capture": {
          title: "Capture d’élément et de zone",
          description:
            "Épinglez un ou plusieurs éléments DOM ou des zones libres, rédigez des commentaires, capturez des screenshots et copiez un paquet structuré depuis Chrome.",
        },
        "local-helper-and-agent-hooks": {
          title: "Helper local et hooks d’agents",
          description:
            "Un helper en loopback stocke les screenshots et l’historique, tandis que les hooks de session installés préparent les agents de code pris en charge à recevoir le contexte Pinar.",
        },
        "cloud-workspace-and-sharing": {
          title: "Workspace cloud et partage",
          description:
            "Les comptes sans mot de passe, les projets, les collections imbriquées, les visualiseurs de capture et les liens non listés de session, de projet et de collection sont arrivés ensemble.",
        },
        "plans-ai-and-storage": {
          title: "Plans, IA et stockage",
          description:
            "Les accès Free, Pro et Founder limité ont introduit la rétention cloud, les quotas de stockage, les résumés IA, les abonnements et les packs optionnels de crédits ou de stockage.",
        },
        "privacy-and-legal-controls": {
          title: "Contrôles de confidentialité et juridiques",
          description:
            "La rédaction des champs sensibles, les masques manuels, le consentement versionné et les politiques de service publiées ont établi la frontière de sécurité du cloud.",
        },
      },
    },
  },
} satisfies ReleaseLocale;

export default locale;
