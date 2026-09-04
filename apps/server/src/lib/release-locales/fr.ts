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
    "v0.3.3": {
      title: "Menu de compte local et Free sans IA",
      summary:
        "L’espace de travail local utilise le même popover de compte que Free. La page d’accueil est dans ce menu, et Free n’inclut plus de crédits ni de résumés IA.",
      changes: {
        "local-account-menu": {
          title: "Menu de compte local",
          description:
            "Le pied de l’espace de travail local ouvre désormais le même popover de compte que Free. La page d’accueil est dans le menu. Se déconnecter disparaît en local, car il n’y a pas de session cloud à quitter.",
        },
        "free-without-ai": {
          title: "Free sans IA",
          description:
            "Free n’accorde plus de crédits IA et n’affiche plus le résumé IA. Les résumés restent sur Pro, Founder et Lifetime. Les plans et l’aide reflètent cette limite.",
        },
      },
    },
    "v0.3.2": {
      title: "Installateur Windows complet",
      summary:
        "Le téléchargement Windows est désormais le ZIP Setup complet. Extrayez-le et lancez Pinar-Setup.exe à côté du dossier .installer.",
      changes: {
        "windows-setup-zip": {
          title: "ZIP Setup Windows complet",
          description:
            "GitHub Releases publie désormais win-x64-Pinar-Setup.zip, avec Pinar-Setup.exe et le payload .installer. L’exe de 1,2 Mo n’est plus listé, car il n’installe rien tout seul.",
        },
        "windows-help-links": {
          title: "Liens d’installation Windows",
          description:
            "L’aide et les Options téléchargent le ZIP. Après extraction, gardez le dossier .installer à côté de Pinar-Setup.exe, puis passez SmartScreen si Windows l’affiche.",
        },
      },
    },
    "v0.3.1": {
      title: "Application Windows et couvertures d’aide uniques",
      summary:
        "Lancez Pinar depuis la zone de notification Windows, téléchargez l’installateur Setup et ouvrez des articles d’aide avec chacun sa couverture.",
      changes: {
        "windows-desktop-app": {
          title: "Application de bureau Windows",
          description:
            "Pinar propose désormais une application de barre d’état Windows. Téléchargez win-x64-Pinar-Setup.exe, lancez l’installateur et démarrez l’assistant local depuis la zone de notification — le même flux de capture locale que sur macOS.",
        },
        "unique-help-covers": {
          title: "Couvertures d’aide uniques",
          description:
            "Chacun des 27 articles d’aide a désormais sa propre image de couverture, afin que les guides d’installation, de première capture, de raccourcis et de facturation ne partagent plus la même capture.",
        },
        "windows-first-run-help": {
          title: "Aide au premier lancement Windows",
          description:
            "Le guide d’installation explique désormais comment poursuivre après le blocage SmartScreen au premier lancement : ouvrez « Plus d’infos », puis choisissez « Exécuter quand même ».",
        },
      },
    },
    "v0.3.0": {
      title: "Un espace de travail et une capture plus clairs",
      summary: "Organisez des collections grandissantes, réglez Pinar depuis un seul espace et révisez chaque capture avec des indications visuelles et une aide plus claires.",
      changes: {
        "workspace-organization": { title: "Organisation de l’espace de travail", description: "Les collections imbriquées prennent en charge de grandes bibliothèques avec une hiérarchie plus claire, une navigation redimensionnable, des contrôles compacts et le contexte de collection dans la vue globale." },
        "global-settings": { title: "Réglages globaux", description: "Un espace dédié regroupe les préférences générales, de capture, de confidentialité, d’interface, de thème et de détail de copie dans une expérience cohérente." },
        "capture-feedback": { title: "Retours de capture plus clairs", description: "Les dimensions de sélection, le focus du commentaire, les aperçus, les zones masquées et la progression de l’enregistrement rendent la capture plus fluide et prévisible." },
        "help-center": { title: "Centre d’aide amélioré", description: "Les guides d’installation et de première capture sont plus courts et clairs, les images s’ouvrent avec zoom et les longs articles indiquent la section visible." },
      },
    },
    "v0.2.0": {
      title: "Lots de captures et préférences synchronisées",
      summary:
        "Regroupez des captures de plusieurs pages en un seul prompt, gardez toutes les préférences sur le serveur et utilisez Pinar en sept langues de bout en bout.",
      changes: {
        "capture-batches": {
          title: "Lots de captures",
          description:
            "Appuyez sur Alt+Maj+B pour regrouper les prochaines captures ; appuyez à nouveau pour terminer et les copier en un seul prompt. Les lots vivent dans un dossier de la barre latérale, et Alt+Maj+X ou le menu de l’icône en ferme un sans copier.",
        },
        "server-preferences": {
          title: "Préférences sur le serveur",
          description:
            "Destination des captures, copie du lot, forme du handoff, clés d’URL masquées et langue vivent sur le serveur et restent synchronisées avec l’extension. Les Réglages gagnent des sections Capture, Handoff et Confidentialité.",
        },
        "localized-everywhere": {
          title: "Sept langues partout",
          description:
            "La barre d’outils, le menu de l’icône et le prompt remis à l’agent suivent la langue choisie, avec l’espace de travail et les Options.",
        },
        "progress-toolbar": {
          title: "Progression dans la barre",
          description:
            "Cmd+Entrée transforme la barre en barre de progression - enregistrement, terminé ou erreur - et l’obturateur de la capture ne dure plus que deux images. Fermer un lot signale son résultat par une notification.",
        },
        "about-and-versioning": {
          title: "À propos et une seule version",
          description:
            "Réglages > À propos montre ce qu’est Pinar, sa version et les notes de version. Une seule version du produit régit l’app, le site et les tags, et les builds de production ne partent que d’un tag de release.",
        },
      },
    },
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
