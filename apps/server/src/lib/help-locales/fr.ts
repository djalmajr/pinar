import type { HelpLocale } from "../help-content";

const locale = {
  ui: {
    articlesFound:
      "{count, plural, one {# article trouvé} other {# articles trouvés}}",
    articleGuide: "Dans ce guide",
    articleNotFound: "Article introuvable",
    articleNotFoundDescription: "Cet article n’existe pas.",
    backToHelp: "Retour au centre d’aide",
    breadcrumb: "Fil d’Ariane",
    categories: "Catégories",
    categoryArticles: "articles",
    categoryNotFound: "Catégorie introuvable",
    categoryNotFoundDescription: "Cette catégorie n’existe pas.",
    clearSearch: "Effacer la recherche",
    explore: "Explorer",
    help: "Aide",
    helpCategories: "Catégories d’aide",
    helpNavigation: "Navigation de l’aide",
    homeDescription:
      "Des conseils ancrés dans la documentation du projet, l’historique des livraisons et le comportement réellement implémenté.",
    homeHeading: "Comment pouvons-nous vous aider ?",
    homeMetaDescription:
      "Apprenez à capturer, organiser, partager et relire le feedback visuel avec Pinar.",
    homeMetaTitle: "Centre d’aide Pinar",
    minutes: "min",
    noArticlesFound: "Aucun article trouvé.",
    notFoundDescription:
      "Utilisez le centre d’aide pour trouver les guides publiés.",
    onThisPage: "Sur cette page",
    openScreenshot: "Ouvrir le screenshot en taille réelle",
    pageTitleSuffix: "Aide Pinar",
    popularArticles: "Articles populaires",
    popularDescription:
      "Les chemins les plus utilisés pour lancer et clôturer une relecture.",
    searchLabel: "Rechercher dans le centre d’aide",
    searchPlaceholder: "Rechercher des captures, des agents, des plans…",
    searchResults: "Résultats de recherche",
    seeAllCategory: "Voir toute la catégorie",
    stillNeedContext: "Il vous faut encore du contexte ?",
    visualExample: "Exemple visuel :",
  },
  categories: {
    "getting-started": {
      title: "Premiers pas",
      description:
        "Installez Pinar, faites une première capture et choisissez où votre travail est stocké.",
    },
    captures: {
      title: "Captures et pins",
      description:
        "Sélectionnez les pages avec précision, annotez-les, masquez les zones sensibles et rouvrez le résultat.",
    },
    agents: {
      title: "Agents d’IA",
      description:
        "Envoyez le contexte visuel aux agents de code et clôturez le cycle de relecture en toute sécurité.",
    },
    workspace: {
      title: "Projets et collections",
      description:
        "Organisez, recherchez, déplacez, partagez et relisez les sessions de capture.",
    },
    cloud: {
      title: "Cloud et plans",
      description:
        "Comprenez les comptes, les plans, les crédits, le stockage, la rétention et le partage public.",
    },
    privacy: {
      title: "Confidentialité et données",
      description:
        "Sachez ce que Pinar stocke, ce qu’il retire et quels contrôles restent entre vos mains.",
    },
  },
  screenshots: {
    "capture-workspace": {
      alt: "Workspace Pinar avec des cartes de sessions annotées, des compteurs de pins, des projets, des collections, la recherche et les contrôles de compte.",
      caption:
        "Le workspace rassemble les pages capturées, les compteurs de pins, les projets, les collections, la recherche et l’état du compte dans une vue opérationnelle.",
    },
    "capture-toolbar": {
      alt: "Barre de capture Pinar avec les commandes pour terminer la session, la revoir avec Tab et la masquer avec Échap.",
      caption:
        "Une session continue suit la navigation, conserve la numérotation des pins et garde la barre masquée après Échap jusqu’à la réouverture explicite de Pinar.",
    },
    "capture-session-review": {
      alt: "Panneau opaque de révision de session Pinar avec commentaire modifiable, cible sélectionnée, chemin DOM, miniature et commande de suppression.",
      caption:
        "Tab remplace la barre de capture par la révision de session, où les pins peuvent être modifiés ou supprimés avant de terminer ou d’abandonner.",
    },
    "capture-review": {
      alt: "Page avec des pins d’élément prêts à être examinés avec leur structure et leurs preuves techniques capturées.",
      caption: "Les pins d’élément conservent la structure capturée et les preuves techniques qui accompagnent le commentaire remis à l’agent.",
    },
    "capture-copy-failed": {
      alt: "Pinar indique que la session n’a pas pu être terminée et conserve les pins pour révision et nouvel essai.",
      caption:
        "Un échec affiche une erreur exploitable et conserve la session complète pour la revoir et réessayer.",
    },
    "capture-full-page": {
      alt: "Overlay Pinar sur un long document qui continue sous le premier viewport, prêt pour une capture pleine page assemblée.",
      caption:
        "La capture pleine page fait défiler et assemble le document pour que le screenshot copié inclue le contenu sous la ligne de flottaison.",
    },
    "capture-viewer": {
      alt: "Visualiseur de session Pinar avec toutes les captures annotées sur une même surface de déplacement et zoom et toutes les notes dans le panneau droit.",
      caption:
        "Une session enregistrée s’ouvre comme un seul élément quel que soit le nombre de pages, avec toutes les images et annotations réunies.",
    },
    "extension-options": {
      alt: "Options de l’extension Pinar sur l’onglet Préférences, avec les destinations locale et distante, la langue et le thème.",
      caption:
        "L’onglet Préférences réunit la destination de stockage, la langue et l’apparence de l’extension.",
    },
    "extension-preferences": {
      alt: "Options de l’extension Pinar sur l’onglet Capture, avec le détail compact ou complet de la copie IA et l’interrupteur d’inclusion de screenshot.",
      caption:
        "Capture définit la livraison compacte ou complète et si la copie suivante inclut un screenshot ; Enregistrer écrit ces choix avant la copie suivante.",
    },
    "help-navigation": {
      alt: "Article d’aide Pinar avec navigation par catégorie, liens vers les autres articles de la catégorie, sections structurées et navigation dans la page.",
      caption:
        "Les pages d’aide gardent visibles ensemble la catégorie, les procédures voisines, les sections de l’article et les chemins de récupération.",
    },
    privacy: {
      alt: "Centre juridique Pinar avec les documents Conditions, Confidentialité, Utilisation acceptable, Rétention des données, Remboursement, Fair Source et sous-traitants.",
      caption:
        "Le centre juridique rassemble les règles de données, de rétention, d’utilisation acceptable, de remboursement, de licence et de sous-traitants en un lieu auditable.",
    },
    "workspace-table": {
      alt: "Tableau du workspace Pinar avec recherche, filtres, compteurs de pins, dates de création, pagination et actions de ligne.",
      caption:
        "La vue tableau place la recherche, les filtres, les compteurs de pins, les dates, la pagination et les actions de session dans un flux facile à parcourir.",
    },
    "sign-in-email": {
      alt: "Écran de connexion au compte Pinar avec le flux de code e-mail sélectionné.",
      caption:
        "Les comptes enregistrés demandent un code à courte durée de vie par e-mail et terminent la vérification dans la même surface de connexion.",
    },
    pricing: {
      alt: "Page tarifaire Pinar comparant Free, Pro annuel, les options de stockage et les crédits IA.",
      caption:
        "La surface tarifaire expose les limites de plan, la cadence de facturation, les options de stockage et les achats de crédits IA avant le paiement.",
    },
    updates: {
      alt: "Détail d’une version Pinar montrant la date, le numéro, les changements et la navigation vers les versions précédente et suivante.",
      caption:
        "Les notes de version publiées rendent le comportement installé et les changements opérationnels traçables par version.",
    },
    "capture-shortcuts": {
      alt: "Onglet Raccourcis des options de l’extension Pinar, avec les commandes du navigateur et les touches de l’overlay pendant la capture.",
      caption:
        "L’onglet Raccourcis montre les liaisons Chrome à côté des touches de l’overlay pour pin, sélection, masque, copier et annuler.",
    },
    "capture-types": {
      alt: "Overlay Pinar avec un pin numéroté sur un titre et une région sélectionnée autour de la carte du total de commande.",
      caption:
        "Les pins d’élément et les régions libres peuvent partager le même overlay pour que le screenshot copié garde la cible DOM et le groupement visuel.",
    },
    "capture-pins": {
      alt: "Overlay Pinar avec trois marqueurs numérotés sur un titre, l’e-mail client et le bouton de paiement.",
      caption:
        "Chaque pin conserve son numéro et son commentaire pour qu’une capture pointe plusieurs éléments de la même page.",
    },
    "capture-selection": {
      alt: "Overlay Pinar mettant en évidence un titre avec le contour bleu de sélection avant de confirmer le pin.",
      caption:
        "La sélection intelligente entoure l’élément sous le curseur pour parcourir le DOM avec les flèches avant d’épingler.",
    },
    "capture-masks": {
      alt: "Overlay Pinar avec un masque de confidentialité sur l’e-mail client et un pin numéroté sur le titre.",
      caption:
        "Un masque cache les pixels sensibles dans le screenshot copié sans retirer les commentaires des pins qui décrivent encore la page.",
    },
    "capture-copied": {
      alt: "Pinar confirme que la session de capture complète a été copiée avec succès.",
      caption:
        "Une fin réussie confirme le résultat, ferme l’overlay et place un seul paquet de session corrélé dans le presse-papiers.",
    },
    "install-pinar": {
      alt: "Onglet Préférences de l’extension Pinar avec le bouton Télécharger Pinar à côté de l’option Serveur Local.",
      caption:
        "L’onglet Préférences propose le téléchargement de l’application Pinar à côté de Serveur Local pour démarrer l’assistant sur cet ordinateur.",
    },
    "options-local": {
      alt: "Onglet Préférences de l’extension Pinar avec Serveur Local sélectionné et les captures restant sur cet ordinateur.",
      caption:
        "Serveur Local conserve l’historique et les screenshots sur cet ordinateur et n’exige pas l’acceptation juridique du service hébergé.",
    },
    "workspace-nested": {
      alt: "Barre latérale du workspace Pinar avec une collection sélectionnée dans l’arbre du projet et les cartes de session correspondantes.",
      caption:
        "Sélectionner une collection filtre le workspace sur cette branche pour que les dossiers imbriqués restent visibles à côté des sessions qu’ils contiennent.",
    },
    "workspace-review": {
      alt: "Tableau du workspace Pinar avec le filtre de statut Revue ouvert au-dessus des lignes de session.",
      caption:
        "La vue tableau combine la recherche avec les filtres de statut Revue pour parcourir les pins ouverts, acceptés et rouverts entre sessions.",
    },
    "workspace-security": {
      alt: "Sélecteur de projet du workspace Pinar ouvert sur le projet protégé Personal.",
      caption:
        "Le workspace local rétablit un projet Personal et une Inbox protégés lorsque l’historique ne s’ouvre pas, au lieu de bloquer l’application.",
    },
    "legal-retention": {
      alt: "Centre juridique Pinar ouvert sur le document de Rétention des données.",
      caption:
        "La politique de Rétention des données indique combien de temps les captures hébergées, les enregistrements de facturation et les données de compte associées sont conservés.",
    },
    "sharing-markdown": {
      alt: "Visionneuse publique de projet Pinar avec le bouton Copier le Markdown au-dessus des cartes de session partagées.",
      caption:
        "Un lien non listé de projet ou de collection permet à quiconque a l’URL de copier le Markdown combiné sans se connecter.",
    },
    "preferences-privacy": {
      alt: "Onglet Capture de l’extension Pinar montrant les métriques de cycle facultatives et les clés d’URL supplémentaires à masquer.",
      caption:
        "Les préférences de confidentialité ajoutent des clés de requête extra retirées des URL capturées et gardent les métriques de cycle désactivées jusqu’à l’opt-in.",
    },
    "pricing-credits": {
      alt: "Carte d’option tarifaire Pinar pour 500 crédits IA, avec achat et validité de douze mois.",
      caption:
        "Les crédits IA sont vendus en option avec une validité de douze mois, séparés du stockage du plan et de la cadence de facturation.",
    },
    assistant: {
      alt: "Workspace Pinar avec le panneau de l’assistant ouvert à côté des cartes de session, montrant une question, la réponse et une carte de proposition avec Confirmer et Refuser.",
      caption: "L’assistant répond dans un panneau latéral et propose chaque changement sur une carte : rien ne bouge dans le workspace avant votre confirmation.",
    },
    "own-ai-endpoint": {
      alt: "Workspace Pinar Cloud avec la boîte de paramètres ouverte sur la section Assistant IA, montrant le bloc Votre propre endpoint : les états des capacités avec la cause, l’URL de l’endpoint, la clé API masquée et les champs de modèle.",
      caption: "Le test de connexion vérifie quatre capacités, et chacune montre si la demande passe par votre endpoint ou par les crédits Pinar Cloud.",
    },
  },
  articles: {
    "install-pinar": {
      title: "Installer Pinar",
      summary: "Installez l’extension Chrome et ouvrez l’application Pinar sur votre ordinateur.",
      sections: [
        {
          heading: "Extension de navigateur",
          paragraphs: [
            "Installez Pinar depuis le [Chrome Web Store](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo).",
          ],
          bullets: [
            "Épinglez l’icône Pinar depuis le menu des extensions de Chrome pour qu’elle reste visible.",
            "Ouvrez la [fiche Chrome Web Store](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo) pour ajouter l’extension officielle.",
          ],
        },
        {
          heading: "L’application Pinar",
          paragraphs: [
            "Sur macOS, l’application Pinar se trouve dans la barre de menus. Sur Windows, elle se trouve dans la zone de notification. Ouvrez l’application Pinar pour commencer à capturer. Sur Linux, installez-la avec la commande ci-dessous.",
          ],
          bullets: [
            "Les captures restent sur cet ordinateur. Choisissez « Ouvrir le dossier » pour les voir.",
            "Sur macOS et Windows, « Ouvrir à la connexion » garde Pinar disponible après la connexion.",
            "Si une capture n’a pas d’image, ouvrez Pinar et réessayez.",
          ],
        },
        {
          heading: "Installer et ouvrir",
          paragraphs: [
            "Téléchargez l’application Pinar avec les liens ci-dessous, installez-la et ouvrez-la.",
            "Quand Pinar est ouvert, choisissez « Ouvrir le workspace ». S’il indique « Serveur local : désactivé », choisissez « Démarrer ». Si les captures collées cessent d’arriver, ouvrez Pinar à nouveau.",
          ],
          bullets: [
            "macOS : [téléchargez l’application Pinar](https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg), ouvrez l’image disque et glissez-la dans « Applications ».",
            "Windows : [téléchargez l’application Pinar](https://github.com/djalmajr/pinar/releases/latest/download/win-x64-Pinar-Setup.zip), extrayez-la et lancez `Pinar-Setup.exe` à côté du dossier `.installer`. L’icône apparaît dans la zone de notification.",
            "Windows : le premier lancement peut afficher « Windows a protégé votre PC ». Choisissez « Plus d’infos », puis « Exécuter quand même ».",
            "Linux : `curl -fsSL https://pinar.dev/install.sh | sh`",
          ],
        },
        {
          heading: "Mettre à jour l’application de bureau",
          paragraphs: [
            "Le menu Pinar cherche les mises à jour de son propre chef et lorsque vous choisissez « Rechercher des mises à jour… ». Une version plus récente se télécharge en arrière-plan pendant que le menu affiche « Téléchargement de {version}… ». Choisissez « Mettre à jour vers {version} » pour appliquer la mise à jour téléchargée : l’application rouvre sur la nouvelle version, et le serveur local redémarre avec elle. Lorsqu’il n’y a rien de plus récent, le menu affiche « À jour » pendant un court moment.",
            "Si une vérification échoue, l’application reste ouverte et le menu affiche « Échec de la vérification ». Choisissez cet élément pour relancer la vérification. Lisez ce que chaque version modifie sur la page « Nouveautés » du site, ou ouvrez le lien « Nouveautés » dans Paramètres → À propos, qui se trouve à côté de la version de votre build.",
          ],
          bullets: [
            "Une vérification échouée ne bloque que la mise à jour elle-même : la version en cours, vos captures et le serveur local continuent de fonctionner.",
            "L’application de bureau vérifie les mises à jour à son démarrage, de sorte que le menu affiche habituellement le résultat sans que vous le demandiez.",
          ],
        },
        {
          heading: "Crochets de session des agents",
          paragraphs: [
            "Chaque agent pris en charge enregistre un crochet de session Pinar. Lorsque vous ouvrez une session dans Claude Code, Codex, Cursor, Grok, Antigravity, Pi ou OMP, le crochet ouvre Pinar et s’assure que le serveur local est en marche avant que l’agent commence à travailler.",
            "L’application de bureau Pinar enregistre ces crochets à son démarrage, et les installateurs en ligne de commande les enregistrent pendant qu’ils installent le helper, de sorte qu’il n’y a rien à configurer par agent. Le fichier de crochet que chaque agent utilise, et l’étape de confiance de première fois qu’un agent peut demander, sont listés dans la [section des crochets de session du README Pinar](https://github.com/djalmajr/pinar/blob/main/README.md#session-hooks).",
          ],
          bullets: [
            "Le crochet n’ouvre que l’application ou ne démarre que le serveur local. Il ne lit pas vos fichiers et ne modifie pas ce que fait l’agent.",
            "Relancer l’installateur, ou redémarrer l’application de bureau, réenregistre les crochets si vous les avez effacés ou changé d’agent.",
          ],
        },
        {
          heading: "Installation en ligne de commande sous Linux et Windows",
          paragraphs: [
            "Sous Linux et Windows, vous pouvez installer le helper Pinar en ligne de commande au lieu de l’application de bureau. L’installateur en une ligne télécharge le helper dans un dossier de votre compte utilisateur, ajoute ce dossier à votre PATH et enregistre les crochets de session des agents, afin qu’une nouvelle session de terminal trouve le helper immédiatement.",
            "Le helper est le même service local Pinar que l’application de bureau exécute : il stocke les captures sur cet ordinateur et sert le workspace et le visualiseur locaux. La [section d’installation du README Pinar](https://github.com/djalmajr/pinar/blob/main/README.md#install) documente les installateurs en ligne de commande.",
          ],
          bullets: [
            "Utilisez la ligne de commande sur les machines sans l’application de bureau, ou lorsque vous gérez Pinar depuis un terminal distant.",
            "Installer à la fois l’application de bureau et le helper en ligne de commande est sûr : ils utilisent le même service local et les mêmes captures.",
          ],
        },
      ],
    },
    "first-capture": {
      title: "Réaliser votre première capture",
      summary:
        "Épinglez des éléments sur une ou plusieurs pages, révisez la session continue et terminez un seul paquet corrélé.",
      sections: [
        {
          heading: "Créer une session continue",
          paragraphs: [
            "Ouvrez Pinar, cliquez sur un élément ou faites glisser une zone libre, rédigez le commentaire puis appuyez sur `Enter`. Le premier pin démarre une session. Chaque pin capture immédiatement sa propre image et vous pouvez naviguer vers d’autres pages avant de terminer.",
          ],
          bullets: [
            "La numérotation des pins continue sur toutes les pages de la même session.",
            "`Shift+Enter` ajoute un saut de ligne. `Escape` ferme un brouillon ou masque la barre lorsqu’aucun brouillon n’est ouvert.",
            "Une fois masquée, la barre le reste pendant la navigation jusqu’à ce que vous invoquiez à nouveau l’extension ou son raccourci.",
            "Recharger l’onglet annoté ne termine pas la session ; quand l’onglet termine de se recharger, Pinar restaure la session en cours et ses épingles.",
          ],
        },
        {
          heading: "Réviser avant de terminer",
          paragraphs: [
            "Appuyez sur `Tab` pour remplacer la barre par la révision de session. Modifiez les commentaires, examinez l’élément ou la région, le titre, le chemin DOM et la miniature, ou supprimez un pin avec X. Appuyez à nouveau sur `Tab` pour revenir à la capture.",
          ],
          bullets: [
            "La révision restaure le curseur normal de la page et ne reçoit pas le focus du seul fait d’appuyer sur `Tab`.",
            "Dans l’éditeur de commentaire, `Tab` conserve la navigation clavier normale.",
          ],
        },
        {
          heading: "Terminer ou annuler la session",
          paragraphs: [
            "Utilisez `Command+Enter` sous macOS ou `Alt+Enter` sous Windows et Linux, ou le bouton Terminer la session, pour terminer toute la session. Ce qui est copié dépend de l’option À la fin : Prompt copie le texte de handoff de la session, Lien copie seulement le lien de la session et Désactivé termine sans copier. Pinar confirme visiblement la réussite. En cas d’échec, une erreur exploitable s’affiche et la session reste disponible pour révision et nouvel essai. Abandonner la session la termine sans copie. Avec Pinar Cloud, le lien est privé : il ne s’ouvre qu’avec un accès authentifié (API key ou MCP) ou un partage explicite.",
            "Traitez le presse-papiers comme une unité : instructions lisibles, URL facultative du visualiseur et un bloc pinar-visual-context délimité par page. Chaque bloc contient sa propre capture, `captureId`, `pinId`, l’URL et les localisateurs. Les badges numérotés sont des overlays d’annotation. Ne réécrivez ni `captureId` ni `pinId`.",
          ],
          bullets: [
            "Une session sans pin enregistré ne peut pas être terminée.",
            "Le stockage local et distant utilisent le même comportement de session continue.",
            "Gardez l’application Pinar locale active avec le stockage local pour conserver les captures et le visualiseur.",
          ],
        },
      ],
    },
    "local-or-cloud": {
      title: "Choisir le stockage local ou cloud",
      summary:
        "Utilisez le workspace local hors ligne ou connectez un compte pour le stockage cloud géré et le partage.",
      sections: [
        {
          heading: "Local",
          paragraphs: [
            "Le mode local conserve l’historique et les screenshots sur cet ordinateur. Le workspace local reste disponible sans compte.",
          ],
        },
        {
          heading: "Cloud",
          paragraphs: [
            "Lorsque le compte connecté est éligible dans l’offre actuelle, le mode cloud fournit l’accès distant au workspace, la rétention gérée, la facturation et les liens de partage non listés. L’application locale et un serveur auto-hébergé restent gratuits. Dans Pinar Cloud, la transcription vocale reste un avantage Pro et ne fait pas partie d’une évaluation ; l’application locale peut transcrire la voix avec votre propre endpoint IA. Vous acceptez les politiques en vigueur avant que quoi que ce soit ne soit stocké à distance.",
          ],
          bullets: [
            "Dans les options de l’extension, « Enregistrer l’Historique des Annotations » (affiché en mode cloud lorsque vous êtes connecté) contrôle si la session est stockée sur le serveur Pinar Cloud afin que le visualiseur, la réouverture et la relecture continuent de fonctionner. Les captures locales restent toujours sur cet appareil.",
          ],
        },
        {
          heading: "Comment les sessions locales et cloud s’ouvrent réellement",
          paragraphs: [
            "L’historique local commence avec un projet protégé « Personal » et une collection « Inbox », que vous ne pouvez pas imbriquer ni supprimer comme des dossiers ordinaires. Les captures restent sur cet ordinateur, et vous pouvez les ouvrir depuis le workspace local.",
            "Le stockage cloud commence après l’acceptation des « Conditions », de la « Confidentialité » et de l’« Utilisation acceptable » en vigueur et la confirmation d’un code e-mail. Les comptes « Free » et Pro utilisent la même connexion. Toute personne possédant l’URL non listée peut lire les liens de partage.",
          ],
          bullets: [
            "Le workspace local reste sur cet ordinateur et n’a pas besoin de compte cloud.",
            "Si l’historique local ne peut pas ouvrir son magasin habituel, Pinar récupère un catalogue utilisable au lieu de planter.",
            "Les liens de partage cloud n’exigent pas de session de workspace : quiconque a l’URL non listée peut lire le Markdown ou l’image.",
          ],
        },
        {
          heading: "Différences entre les interfaces locales et cloud",
          paragraphs: [
            "Les mêmes pages se comportent différemment selon le stockage. Dans l’application locale, le visualiseur de session, les pages projet, collection et lot, et le Markdown s’ouvrent sur cet ordinateur sans connexion. Dans Pinar Cloud, ces pages restent privées jusqu’à ce que vous publiez un partage : le Markdown privé ne s’ouvre qu’avec votre compte ou une clé autorisée.",
            "Dans l’application locale, les pages Plans et de connexion s’ouvrent sur pinar.dev au lieu de se charger sur cet ordinateur.",
          ],
          bullets: [
            "Le visualiseur local n’affiche pas les résultats d’exécution des agents. Il affiche les commentaires enregistrés sur les pins, y compris ceux que les agents ajoutent via MCP. Pinar Cloud affiche aussi les résultats d’exécution des agents dans le fil de relecture.",
            "Les contrôles de partage dans le visualiseur — publier un partage, copier son lien et le révoquer — ne sont proposés que dans Pinar Cloud.",
            "L’action « Générer les étapes rédigées » dans le visualiseur n’est proposée que dans Pinar Cloud.",
          ],
        },
      ],
    },
    "shortcuts-and-navigation": {
      title: "Raccourcis clavier",
      summary:
        "Capturez, parcourez le DOM, masquez du contenu et copiez sans quitter le clavier.",
      sections: [
        {
          heading: "Pendant la capture",
          paragraphs: [
            "Pinar intercepte uniquement ses raccourcis de capture actifs, afin que la page hôte ne reçoive pas la même frappe.",
          ],
          bullets: [
            "`Enter` épingle l’élément survolé ; `Arrow Up` sélectionne son parent et `Arrow Down` revient à un enfant.",
            "`M` bascule le dessin du masque de confidentialité. `Escape` annule un brouillon ou un masque ; sans brouillon, il efface les pins et masque la barre d’outils.",
            "`R` bascule l’overlay en direct entre les épingles numérotées seules et les épingles avec leurs régions. La capture copiée inclut toujours les deux.",
            "`Command+Enter` / `Alt+Enter` termine la session et copie selon l’option À la fin.",
            "`Alt+Shift+P` affiche ou masque la barre d’outils sans annuler la session, et vous pouvez le réattribuer dans `chrome://extensions/shortcuts`. Les raccourcis du navigateur restent inertes sur les pages `chrome://`, sur le Chrome Web Store et avant l’injection de l’overlay.",
            "`G` commence à enregistrer les étapes que vous effectuez sur la page. Rouvrez Pinar, épinglez le résultat et copiez avec `Command+Enter` / `Alt+Enter` pour joindre les étapes ; appuyer à nouveau sur `G` abandonne l’enregistrement.",
          ],
        },
        {
          heading: "Commandes du navigateur et icône de la barre d’outils",
          paragraphs: [
            "L’extension enregistre trois commandes du navigateur avec des raccourcis par défaut : `Alt+Shift+P` affiche ou masque la barre d’outils Pinar, `Alt+Shift+O` ouvre le workspace Pinar dans un nouvel onglet, et `Alt+Shift+X` ferme la session sans copier. Cliquer sur l’icône de l’extension fait la même chose que `Alt+Shift+P` sur l’onglet actuel.",
            "Le menu contextuel de l’icône propose trois éléments : « Ouvrir le panneau », « Terminer la session » et « Annuler la session ». Les deux éléments de session ne fonctionnent que pendant qu’une session est active. Pendant qu’une session est en cours, le badge de l’icône affiche « on » jusqu’à ce que le premier pin soit enregistré, et le nombre de pins après cela.",
          ],
          bullets: [
            "Les associations peuvent être modifiées sur la page des raccourcis d’extensions de Chrome ; l’onglet Raccourcis des options de l’extension liste chaque commande du navigateur avec son association actuelle et ouvre cette page, à côté des touches fixes de l’overlay.",
          ],
        },
        {
          heading: "Pages à focus agressif",
          paragraphs: [
            "Sur les sites avec des pièges de focus agressifs, Pinar réessaie un nombre limité de fois de focaliser le composer de commentaire, puis s’arrête plutôt que de figer l’onglet. Cliquez directement le composer si la page continue de voler le focus.",
          ],
        },
        {
          heading: "Détails de l’overlay, de l’icône et de la marche DOM",
          paragraphs: [
            "Les raccourcis de capture ne sont détenus que pendant que l’overlay est actif. L’icône de l’extension bascule cet overlay ; elle ne supprime pas les pins. Survoler la barre d’outils sans brouillon ouvert la rend passante, afin que vous puissiez encore cliquer ou faire glisser la page en dessous. `Shift+Enter` insère un saut de ligne dans le composer, et les raccourcis de la page hôte tapés là sont empêchés de quitter le champ de commentaire.",
            "`Arrow Up` remonte à l’élément parent et mémorise l’enfant que vous quittez, de sorte qu’`Arrow Down` revient à ce nœud mémorisé s’il est encore un enfant ; sinon il utilise le premier enfant. En mode masque, faites glisser une région pour la cacher et cliquez un masque existant pour le restaurer. Le défilement clavier fonctionne encore sur le document, mais les touches destinées aux contrôles de page focalisés sont bloquées afin qu’elles ne puissent pas activer des boutons ni taper dans le formulaire hôte.",
          ],
          bullets: [
            "`Command+Enter` / `Alt+Enter` enregistre un brouillon ouvert, puis termine ; sans commentaire, il affiche « Écrivez un commentaire » au lieu d’envoyer un pin vide.",
            "Après `Escape` ou une copie, Pinar conserve la propriété de cette touche physique jusqu’au keyup, afin que la page hôte ne traite pas la même frappe comme sa propre annulation ou soumission.",
            "Un pin de zone ne commence qu’après que le pointeur a bougé d’environ six pixels ; un clic plus court épingle encore l’élément survolé, au lieu d’ouvrir un rectangle libre.",
          ],
        },
      ],
    },
    "capture-types": {
      title: "Captures d’élément, de zone, de page entière et d’iframe",
      summary:
        "Choisissez le mode de capture le plus petit qui préserve encore le contexte dont le relecteur a besoin.",
      sections: [
        {
          heading: "Modes de sélection",
          paragraphs: [
            "La capture d’élément enregistre une empreinte DOM résiliente et la boîte exacte. La capture de zone couvre un rectangle libre lorsqu’aucun élément unique ne représente le feedback. La capture de page entière fait défiler et assemble le document. La capture d’iframe préserve les frontières de cadre et les décalages.",
          ],
          bullets: [
            "Préférez un élément lorsque l’agent doit identifier précisément la propriété du code.",
            "Préférez une zone pour les relations visuelles entre plusieurs éléments.",
          ],
        },
        {
          heading: "Clic, glisser et ciblage de cadre",
          paragraphs: [
            "Cliquez un nœud, ou appuyez sur `Enter` sur le contour courant, pour ouvrir un pin d’élément. Faites glisser un rectangle d’au moins six pixels pour ouvrir un pin de zone à la place. Le premier appui sur un élément iframe ou frame est ignoré afin que le document à l’intérieur de ce cadre puisse prendre la sélection.",
            "Les pins d’élément enregistrent une empreinte, un sélecteur et un chemin DOM qui joint les cadres ancêtres avec un délimiteur de frontière de cadre. Les pins de zone stockent le rectangle et une étiquette de taille en pixels, sans localisateur. Le screenshot copié s’assemble encore autour de l’union de tous les pins, y compris ceux placés dans des cadres enfants.",
          ],
          bullets: [
            "La barre d’outils de capture reste sur le cadre supérieur ; les cadres enfants n’affichent que les marqueurs et le composer de commentaire.",
            "Si un cadre parent ne répond pas avec son chemin, le pin conserve uniquement le chemin du document intérieur.",
            "Les éléments fixed ou sticky sont marqués ancrés au viewport, afin que la réouverture ne les traite pas comme des boîtes défilées avec le document.",
          ],
        },
      ],
    },
    "pins-and-comments": {
      title: "Pins, commentaires et couleurs",
      summary:
        "Utilisez les pins numérotés comme références stables entre le screenshot, le texte et le contexte structuré.",
      sections: [
        {
          heading: "Une capture partagée",
          paragraphs: [
            "Chaque badge numéroté du screenshot correspond à un commentaire et à un enregistrement de pin. La palette de couleurs rotative sépare les marqueurs proches sans changer leur identité.",
          ],
        },
        {
          heading: "Conserver la corrélation",
          paragraphs: [
            "Ne réécrivez pas `captureId` ni `pinId` en transmettant le paquet à un autre outil. Ces champs permettent au workspace, au visualiseur, au résultat d’agent et à l’historique de relecture de se référer à la même capture.",
          ],
        },
        {
          heading: "Comment les numéros et identités sont attribués",
          paragraphs: [
            "Un pin n’est enregistré qu’après que le commentaire a été débarrassé des espaces et n’est pas vide. Les nouveaux pins reçoivent un UUID, un numéro commençant à 1 selon leur ordre dans la capture, et une couleur de la palette à onze nuanciers pour ce numéro. Les badges proches diffèrent donc visuellement sans changer l’identité qu’ils conservent.",
            "Le contexte structuré conserve `pinId` depuis le `pinId` ou id existant. Lorsque ces champs sont absents, l’analyseur synthétise `captureId`:pN à partir de l’identité de capture et du numéro de pin. Les outils en aval peuvent alors pointer le même screenshot, commentaire et ligne de relecture.",
          ],
          bullets: [
            "Un composer vide ne peut pas être copié ; le focus reste sur le champ jusqu’à ce qu’un commentaire existe.",
            "Survoler un marqueur prévisualise son numéro, son commentaire et la confiance courante du localisateur sur la page live.",
            "Modifier un pin existant ne met à jour que son commentaire ; l’id stocké reste inchangé.",
          ],
        },
        {
          heading: "Structure et preuves techniques",
          paragraphs: [
            "Chaque pin d’élément stocke aussi un instantané de ce qu’il désigne : l’arbre HTML de l’élément, les styles calculés qui diffèrent des valeurs par défaut du navigateur, les polices et icônes qu’il utilise, ainsi que son parent et ses frères. L’Aperçu affiche les localisateurs et les preuves stockés avec le pin, tandis que l’instantané complet reste dans la capture stockée et la charge complète du handoff. Les éléments volumineux sont tronqués pour rester dans la limite de capture, et le Markdown de la session l’indique avec un compte de nœuds tronqué.",
            "« Preuves techniques » liste les faits que l’extension a observés sur la page pendant que vous épingliez : erreurs de console, requêtes échouées et environnement (navigateur, viewport, langue). Chaque élément est classé « Après interaction » s’il s’est produit après votre dernier clic ou dernière frappe, ou « Même page » s’il partage seulement la page. Rien n’est déduit et aucun crédit IA n’est dépensé ; retirez un élément avant de partager s’il est sans rapport.",
          ],
          bullets: [
            "Les pins de zone n’ont pas de structure ; utilisez un pin d’élément lorsque l’agent a besoin du contexte DOM et de localisateurs robustes.",
            "Le prompt compact par défaut conserve les localisateurs, le commentaire et les preuves compactes ; l’instantané de l’élément voyage avec le bloc pinar-visual-context de la charge complète et le Markdown de la session, accessible par le lien de contexte complet.",
          ],
        },
        {
          heading: "Modifier la note et les commentaires dans le visualiseur",
          paragraphs: [
            "La discussion du pin dans le visualiseur propose la note originale et les commentaires du fil stockés pour modification. Les règles diffèrent entre le workspace local et Pinar Cloud.",
            "Le workspace local n’a aucune connexion, donc toute note et tout commentaire stocké peuvent se modifier dans le visualiseur. Sur Pinar Cloud, le propriétaire de la session modifie la note, et un commentaire humain ne se modifie que par la personne qui l’a écrit. Les commentaires d’agent ne sont jamais modifiables dans le visualiseur.",
          ],
          bullets: [
            "Une modification enregistre par-dessus le texte stocké et conserve l’identité, l’auteur et l’horodatage du message.",
          ],
        },
      ],
    },
    "full-page-capture": {
      title: "Capturer une page entière",
      summary:
        "Créez un long screenshot pendant que Pinar contrôle le défilement, l’échelle et le contenu fixe répété.",
      sections: [
        {
          heading: "Comment l’assemblage fonctionne",
          paragraphs: [
            "Pinar planifie les cadres de viewport, fait défiler le document, masque temporairement les éléments sticky ou fixed répétés, rend au device pixel ratio, puis restaure la page.",
          ],
        },
        {
          heading: "Quand le résultat diffère",
          paragraphs: [
            "Le contenu chargé à la demande, les mises en page animées, les cadres cross-origin et les pages qui changent pendant le défilement peuvent produire des trous ou des régions non résolues. Laissez la page se stabiliser, réessayez, ou capturez séparément la zone concernée.",
          ],
        },
        {
          heading: "Tuiles de viewport et restauration de mise en page",
          paragraphs: [
            "Pinar planifie les positions de défilement à partir de l’union des bornes de pins plus le padding, puis capture chaque tuile PNG de hauteur de viewport via l’API de screenshot de l’onglet. Les tuiles suivantes attendent brièvement pour que la page puisse peindre, et le canvas composé utilise le device pixel ratio déduit de la largeur de la première tuile par rapport au viewport CSS.",
            "Avant la première tuile, les nœuds sticky et fixed sont réécrits afin de ne pas se répéter sur chaque cadre. Les styles inline d’origine et la position de défilement sont restaurés même si la composition échoue. Les coordonnées de pins et de masques sont décalées vers l’origine de capture avant le recadrage de l’image.",
          ],
          bullets: [
            "Les nœuds fixed deviennent positionnés en absolute à la boîte mesurée, avec les transforms effacés afin que le screenshot ne les décale pas deux fois.",
            "Les nœuds sticky deviennent positionnés en relative pendant le passage de capture.",
            "Le défilement des tuiles utilise un scroll-behavior instant, afin que le document n’anime pas entre les cadres.",
          ],
        },
      ],
    },
    "smart-selection": {
      title: "Localisateurs intelligents et sélection DOM",
      summary:
        "Comprenez comment une épingle identifie un élément pendant l’annotation d’une page qui évolue.",
      sections: [
        {
          heading: "Empreintes résilientes",
          paragraphs: [
            "Une épingle d’élément combine sélecteur stable, chemin DOM, balise, id, nom, test id, rôle, classes, texte, libellé et géométrie au lieu de dépendre d’un seul chemin fragile.",
          ],
        },
        {
          heading: "Confiance sur la page active",
          paragraphs: [
            "Tant que l’overlay d’annotation est ouvert, Pinar réévalue le sélecteur et la structure afin que les marqueurs suivent les éléments qui se déplacent.",
          ],
          bullets: [
            "Les classes qui semblent générées sont exclues de l’empreinte.",
            "Les frames d’une autre origine qui sont illisibles restent non résolues au lieu d’être devinées.",
            "Les identifiants uniques et test ids sont prioritaires lorsqu’ils désignent un seul élément.",
            "Un chemin DOM structurel est conservé lorsqu’aucun attribut stable n’est unique.",
            "Les épingles de zone utilisent leur géométrie sans prétendre identifier un élément DOM.",
          ],
        },
      ],
    },
    "privacy-masks": {
      title: "Masquer les zones sensibles",
      summary:
        "Occultez des régions visuelles avant que le screenshot soit sérialisé ou envoyé.",
      sections: [
        {
          heading: "Dessiner un masque",
          paragraphs: [
            "Appuyez sur M pendant que le mode capture est actif, puis faites glisser sur la région sensible. Les masques utilisateur sont appliqués à l’image capturée avant le stockage ; retirez un masque erroné avant de copier.",
          ],
        },
        {
          heading: "Les masques complètent la rédaction",
          paragraphs: [
            "La sanitization automatique traite les champs DOM sensibles connus et les parties d’URL. Les masques manuels couvrent le contenu visuel que le logiciel ne peut pas classer de façon fiable, comme les graphiques, les avatars ou les données rendues sur canvas.",
          ],
        },
        {
          heading: "Comment les masques atteignent l’image stockée",
          paragraphs: [
            "Le dessin de masque est indisponible pendant qu’un brouillon de commentaire est ouvert. Un glisser qualifiant stocke un masque utilisateur en coordonnées de document afin qu’il suive le défilement de la page, et un clic sur cet overlay le retire. Les boîtes de champs automatiques du scan de confidentialité sont combinées à ces rectangles utilisateur avant la copie.",
            "Les régions combinées voyagent avec le message de capture afin d’être peintes sur le screenshot avant le presse-papiers ou le stockage. Une sanitization séparée rédige encore les secrets connus dans les URL, les valeurs de champs et le texte des pins ; les masques couvrent les pixels que ces règles de chaînes ne peuvent pas classer.",
          ],
          bullets: [
            "Les masques utilisateur utilisent un id unique et une catégorie manual afin de pouvoir être supprimés indépendamment des boîtes automatiques.",
            "Les masques de champs automatiques sont écartés plutôt que supprimés, afin que les scans ultérieurs puissent encore signaler le champ sous-jacent.",
            "`Escape` quitte le dessin de masque sans jeter les pins déjà placés sur la page.",
          ],
        },
      ],
    },
    "copy-and-view": {
      title: "Copier et afficher une session",
      summary:
        "Révisez toutes les captures et annotations d’une session enregistrée dans un seul élément du workspace.",
      sections: [
        {
          heading: "Commandes du visualiseur",
          paragraphs: [
            "Le visualiseur de session permet le déplacement, le zoom à la molette ancré au pointeur, le double-clic et des commandes de 50 % à 800 %. Sélectionner un pin ouvre une boîte de dialogue de détails avec le fil de commentaires et un Aperçu qui affiche le Markdown stocké du pin et les preuves techniques capturées.",
          ],
          bullets: [
            "Ouvrez le screenshot de la capture dans un nouvel onglet depuis la boîte de dialogue du pin, ou copiez le Markdown de la session depuis le visualiseur.",
            "Utilisez le lien de la page d’origine pour examiner le site actuel séparément.",
            "L’Aperçu affiche le Markdown stocké du pin ; la section des preuves techniques n’apparaît que lorsque la capture a stocké des preuves.",
            "Une session groupée garde toutes les captures sur la même surface de déplacement et zoom.",
            "Le lien de la page d’origine s’ouvre séparément sans modifier la session enregistrée.",
          ],
        },
        {
          heading: "Copier depuis le visualiseur",
          paragraphs: [
            "Copier le prompt écrit le paquet Markdown corrélé de toute la session groupée. Ouvrir le prompt *.md ouvre le Markdown public lorsque le partage est disponible.",
          ],
        },
      ],
    },
    "send-to-agent": {
      title: "Envoyer le contexte visuel à un agent",
      summary:
        "Collez le paquet Pinar complet afin que l’agent voie le commentaire, la cible, la géométrie et l’image partagée ensemble.",
      sections: [
        {
          heading: "Quoi coller",
          paragraphs: [
            "Pinar écrit du Markdown simple et du HTML dans le presse-papiers. Le texte inclut des annotations lisibles plus un bloc JSON pinar-visual-context délimité. Collez les deux comme une unité ; le bloc structuré est la source de vérité lisible par machine.",
          ],
        },
        {
          heading: "Screenshot et avertissements",
          paragraphs: [
            "Si le paquet liste un chemin Screenshot absolu, l’agent local doit ouvrir cette image unique ; les badges numérotés sont des overlays. Des avertissements tels que `screenshot_missing`, `helper_unavailable` ou `viewer_unavailable` décrivent une livraison dégradée mais n’invalident pas les commentaires ni le contexte DOM.",
          ],
        },
        {
          heading: "Comment livrer le paquet copié à un agent",
          paragraphs: [
            "L’extension Chrome ne tape jamais dans le composer de l’agent. En mode Prompt, après `Command+Enter` / `Alt+Enter`, collez vous-même le presse-papiers dans Cursor, Claude, Codex ou Grok. Le texte commence en indiquant que les notes des pins peuvent demander un changement ou une explication, et à traiter sélecteur et chemin DOM comme des localisateurs complémentaires, suivies d’un bloc JSON pinar-visual-context délimité. Si une URL Viewer est incluse, ne la récupérez que lorsque ces détails ne suffisent pas. En mode Lien, l’agent reçoit seulement le lien de la session et doit pouvoir accéder à ce `.md` (les liens Pinar Cloud sont privés et exigent une API key ou MCP) ; Désactivé enregistre sans copier.",
            "Traitez `captureId` et `pinId` comme des identités, pas des libellés à réécrire. Visual Context encode actuellement schemaVersion 1 ; parseVisualCapture rejette un `captureId` manquant et tout schemaVersion autre que 1 ou l’héritage 0. Suivez seulement ce que les pins décrivent. Si la personne n’a jamais collé, demandez-lui de copier à nouveau depuis Pinar plutôt que de reconstruire les pins de mémoire.",
          ],
          bullets: [
            "Collez tout le presse-papiers dans l’agent ; ne retapez pas les commentaires et n’inventez pas un nouveau `captureId`.",
            "Confirmez que le texte collé contient encore une clôture pinar-visual-context fermée avant de commencer à modifier le code.",
            "Si rien n’a été collé, demandez `Command+Enter` / `Alt+Enter` dans Pinar et suivez seulement les notes des pins.",
          ],
        },
        {
          heading: "Laisser un agent travailler avec Pinar via MCP",
          paragraphs: [
            "Pinar expose aussi ses sessions stockées via le Model Context Protocol. Un client MCP peut lister projets, collections, lots, sessions, pins et commentaires de pins, et peut les créer, les commenter, les renommer, les déplacer, les réorganiser et les supprimer.",
            "Le service Pinar local expose MCP sur votre propre machine, sans compte, connexion ni clé API. Pinar Cloud exige une clé API avec l’autorisation nécessaire, et le périmètre de ressources de la clé borne ce que l’agent peut lire, commenter ou modifier.",
            "Pour la configuration du client, y compris le point d’accès, l’en-tête d’authentification et les détails du protocole, consultez le [guide d’accès des agents](https://github.com/djalmajr/pinar/blob/main/docs/cloud-agent-access.md) dans le dépôt Pinar.",
          ],
          bullets: [
            "Une session créée par un agent stocke les métadonnées de la page sans capture, et un pin d’agent stocke le commentaire avec un localisateur facultatif au lieu d’une géométrie mesurée.",
            "MCP ne réhydrate ni ne synchronise le brouillon du navigateur ; l’extension reste l’autrice du brouillon actif, et un enregistrement explicite ultérieur remplace la session stockée sous le même identifiant.",
            "Le partage reste explicite : publiez un partage depuis le workspace, ou laissez un agent doté de l’autorisation de partage le publier ou le révoquer.",
          ],
        },
        {
          heading: "Connecter un agent à l’application locale",
          paragraphs: [
            "L’application Pinar locale offre la même surface Model Context Protocol aux agents qui s’exécutent sur le même ordinateur, et elle est ouverte par conception : aucun compte, connexion ni clé API n’est en cause. Pointez le client MCP de votre agent vers le point d’accès décrit dans la [section d’accès des agents aux sessions](https://github.com/djalmajr/pinar/blob/main/README.md#agent-access-to-sessions-mcp) du README Pinar.",
            "La [section des outils MCP locaux](https://github.com/djalmajr/pinar/blob/main/README.md#local-mcp-tools) du README liste chaque outil avec ses arguments et sa valeur de retour. Les outils de liste paginent leurs résultats, jusqu’à 50 éléments par page, afin qu’un agent parcoure un grand workspace une page à la fois. Les outils de réorganisation attendent la liste complète des éléments et rejettent une liste partielle avant que quoi que ce soit ne bouge.",
          ],
          bullets: [
            "Parce que la connexion est locale, l’agent ne travaille qu’avec les captures stockées sur cet ordinateur et n’a jamais besoin de Pinar Cloud.",
            "La plus grande partie de la surface d’outils cloud est disponible localement ; les extras réservés au cloud concernent les clés d’agents et la publication de partages.",
          ],
        },
        {
          heading: "Créer et gérer des clés API d’agent",
          paragraphs: [
            "Pinar Cloud permet aux comptes Pro d’émettre des clés d’agent dédiées. Ouvrez Paramètres → « Accès des agents » dans le workspace pour en créer une : donnez un nom à la clé, choisissez une autorisation — « Lecture », « Gestion », « Partage » ou « Complète » — et une expiration de 7, 30 ou 90 jours. Une clé « Lecture » peut se limiter à tout le compte ou à un projet, collection, session ou lot. Les autres autorisations agissent sur tout le compte.",
            "La clé n’est affichée qu’une seule fois, juste après sa création, alors copiez-la avant que la boîte de dialogue ne se ferme — Pinar ne conserve qu’un court préfixe et ne peut pas afficher la clé à nouveau. Jusqu’à 20 clés actives peuvent exister à la fois. Chaque clé listée affiche son périmètre, son autorisation, son expiration et son dernier usage, et « Révoquer » la met fin immédiatement. Une demande d’une ressource hors du périmètre de la clé est répondue comme si la ressource n’existait pas, de sorte qu’une clé ne révèle jamais ce qui se trouve au-delà de son périmètre. Le [guide d’accès des agents cloud](https://github.com/djalmajr/pinar/blob/main/docs/cloud-agent-access.md) documente la matrice d’autorisations et la surface complète d’outils derrière chaque clé.",
          ],
          bullets: [
            "Donnez à chaque agent ou automatisation sa propre clé, afin que révoquer l’une ne dérange pas les autres.",
            "Les clés fonctionnent avec les clients MCP qui gèrent des en-têtes personnalisés et avec les liens Markdown privés ; le panneau « Accès des agents » explique comment la clé est utilisée.",
          ],
        },
      ],
    },
    "handoff-formats": {
      title: "Formats de handoff et destinations",
      summary:
        "Choisissez un contexte compact ou complet et une présentation spécifique à l’agent sans changer l’identité de la capture.",
      sections: [
        {
          heading: "Compact et full",
          paragraphs: [
            "Le mode compact retire le bruit redondant de localisateur et de géométrie tout en conservant la corrélation. Le mode full conserve la charge utile intégrale. Une préférence distincte inclut ou omet les screenshots ; les désactiver préserve les métadonnées, pins, localisateurs, relecture et handoff tout en évitant le stockage d’images. Les données d’image inline sont retirées des charges textuelles pour éviter des prompts trop volumineux. La boîte de dialogue Paramètres du workspace synchronise ces préférences de livraison avec le backend actif.",
          ],
        },
        {
          heading: "Adaptateurs d’agents",
          paragraphs: [
            "Pinar peut adapter le préambule et la forme Markdown pour Claude, Codex, Grok et d’autres destinations d’agents de code prises en charge. Le contrat sous-jacent `captureId`, `pinId` et visual-context reste le même.",
          ],
        },
        {
          heading:
            "Choisir le mode de livraison dans les options de l’extension avant de copier",
          paragraphs: [
            "Dans les options de l’extension, un interrupteur définit handoffMode à full lorsqu’il est coché et compact lorsqu’il est décoché. Compact est la valeur par défaut stockée et ne conserve chaque fait utile qu’une fois : `pinId`, comment, cssSelector, domPath et innerText, plus box ou coords uniquement pour les pins de zone ou les pins sans localisateur. Full conserve la capture intégrale. Les deux projections retirent encore les URL de screenshot data: du JSON ; une image inline est stockée comme une URL null et un avertissement screenshot_inline afin que le prompt reste borné.",
            "Cliquez Enregistrer afin que preferences:set écrive handoffMode et `includeScreenshot` vers le backend actif et chrome.storage.sync. Les valeurs handoffMode inconnues se rabattent sur compact ; `includeScreenshot` vaut true par défaut. Les destinations d’adaptateur sont cursor, claude, codex et grok : chacune préfixe son propre préambule, mais `captureId`, pinIds et commentaires restent identiques. L’interrupteur copy-viewer-content est désactivé dès que includeViewer est off.",
          ],
          bullets: [
            "Réglez l’interrupteur compact/full et l’interrupteur `includeScreenshot`, puis cliquez Enregistrer avant la prochaine copie.",
            "Laissez `includeScreenshot` activé sauf si vous voulez volontairement les métadonnées, pins, localisateurs et le handoff sans stockage d’image.",
            "Après l’enregistrement, copiez une fois et confirmez que chaque collage d’adaptateur partage encore le même `captureId` et les mêmes pinIds.",
          ],
        },
      ],
    },
    "ai-features": {
      title: "Fonctions d’IA et comment les tester",
      summary: "Testez la transcription vocale, transformez un parcours enregistré dans le navigateur en étapes rédigées concises et voyez où intervient l’assistant.",
      sections: [
        {
          heading: "Posez vos questions à l’assistant",
          paragraphs: [
            "L’assistant est un chat qui répond aux questions sur vos projets, sessions et épingles et les organise une fois chaque proposition confirmée. L’application locale le fait fonctionner avec l’IA que vous avez configurée ; dans Pinar Cloud, il fait partie de Pro et chaque message utilise 3 crédits IA. [Posez vos questions à l’assistant](/help/agents/assistant) explique son fonctionnement.",
          ],
        },
        {
          heading: "La reproduction dans Pinar Cloud",
          paragraphs: [
            "Dans Pinar Cloud, la reproduction est proposée aux comptes connectés éligibles, et chaque génération des étapes rédigées utilise 1 crédit IA ; une génération qui échoue le rend. [Crédits IA Pinar Cloud pour la voix et l’assistant](/help/cloud/ai-credits) détaille les soldes et les remboursements.",
          ],
        },
        {
          heading: "Transcrire un commentaire vocal",
          paragraphs: [
            "Commencez le commentaire d’une épingle et choisissez le microphone. Enregistrez jusqu’à 120 secondes, puis arrêtez pour insérer la transcription dans le commentaire ou envoyez-la directement. Dans Pinar Cloud, la transcription vocale nécessite un compte Pro et utilise des crédits IA ; le guide Crédits IA Pinar Cloud pour la voix et l’assistant détaille les paliers de facturation et les remboursements. Dans l’application locale, la voix utilise le modèle de transcription défini dans Paramètres → Assistant IA sur votre propre endpoint compatible OpenAI, sans crédits. La clé API de l’endpoint doit autoriser la transcription audio.",
          ],
        },
        {
          heading: "Générer des étapes de reproduction rédigées",
          paragraphs: [
            "Ouvrez la barre de capture et appuyez sur `G` pour enregistrer. Utilisez la page, rouvrez Pinar, ajoutez une épingle et terminez avec `Command+Enter` sous macOS ou `Alt+Enter` sous Windows et Linux. L’extension enregistre la navigation, les clics, les valeurs saisies, les touches et les défilements utiles ; les valeurs sensibles restent masquées.",
            "Ouvrez la session enregistrée. Reproduction affiche la chronologie brute, modifiable avant de choisir Générer les étapes rédigées. L’IA transforme cette chronologie et les commentaires en instructions concises, enregistrées avec la session et incluses dans la remise à votre agent local.",
          ],
          bullets: [
            "Modifiez ou supprimez les événements parasites de la chronologie avant la génération.",
            "Relisez les instructions générées avant de les remettre à votre agent local.",
            "Laissez l’agent local créer des tests automatisés adaptés avec le dépôt et ses conventions en contexte.",
          ],
        },
        {
          heading: "Utiliser votre propre IA dans l’application locale",
          paragraphs: [
            "L’application locale peut transcrire les commentaires vocaux, les nettoyer et faire fonctionner l’assistant avec une IA que vous fournissez au lieu de Pinar Cloud. Ouvrez Paramètres → Assistant IA et choisissez un mode : « Désactivée » désactive l’IA, « IA locale » utilise un serveur sur le même ordinateur, et « BYOK » connecte directement à un fournisseur distant avec votre propre clé. Les deux modes actifs prennent un endpoint compatible OpenAI et le modèle exact qu’il expose, plus un modèle de transcription facultatif : laissez ce champ vide pour garder la voix désactivée.",
            "Avec « BYOK », la clé API est stockée dans le coffre de credentials de votre système d’exploitation, pas dans les préférences de Pinar. « Tester la connexion » et « Enregistrer » vérifient le modèle et le modèle de transcription avant de se terminer. Si seul le modèle de transcription échoue, le message dit pourquoi — par exemple que la clé manque d’autorisation audio — et l’enregistrement fonctionne toujours pour les fonctions qui n’ont pas besoin de la voix. Les commentaires vocaux nécessitent un endpoint qui autorise la transcription audio. Le [guide d’IA locale et BYOK](https://github.com/djalmajr/pinar/blob/main/docs/local-ai.md) couvre la configuration, la confidentialité et les exigences de modèle.",
          ],
          bullets: [
            "La transcription vocale, le nettoyage et l’assistant dans l’application locale utilisent directement votre fournisseur et aucun crédit Pinar Cloud. L’action « Générer les étapes rédigées » du visualiseur n’est proposée que dans Pinar Cloud.",
            "Les requêtes vont de l’application locale uniquement vers votre endpoint ; elles ne basculent jamais d’elles-mêmes vers Pinar Cloud.",
          ],
        },
        {
          heading: "Nettoyer la transcription avec l’IA",
          paragraphs: [
            "Par défaut, un commentaire vocal enregistré place la transcription brute dans le pin. L’interrupteur « Nettoyer la transcription avec l’IA » dans les options de l’extension — et l’interrupteur « Nettoyer les transcriptions vocales » dans Paramètres → « Utilisation de l’IA » dans Pinar Cloud — envoient la transcription d’abord par le modèle d’IA, afin que le pin reçoive le commentaire que vous aviez à l’esprit : les mots de remplissage et les faux départs sont retirés, et le modèle peut ajouter de courts critères d’acceptation à côté du commentaire.",
            "Avec l’interrupteur désactivé, la transcription sert directement de commentaire, dans la limite de longueur du commentaire, sans réécriture par l’IA. Dans l’application locale, le nettoyage utilise le modèle que vous avez configuré dans Paramètres → Assistant IA. Dans Pinar Cloud, il s’exécute avec les mêmes crédits IA que la transcription vocale utilise déjà.",
          ],
          bullets: [
            "Avant d’enregistrer le pin, relisez la transcription d’origine dans le panneau vocal ou choisissez « Utiliser la transcription » pour l’insérer dans le commentaire. La transcription d’origine est aussi copiée dans le presse-papiers ; elle n’est pas enregistrée séparément avec le pin.",
            "Le nettoyage est désactivé par défaut. Activez-le dans les options de l’extension pour les captures locales, ou dans Paramètres → « Utilisation de l’IA » pour Pinar Cloud.",
          ],
        },
      ],
    },
    assistant: {
      title: "Posez vos questions à l’assistant",
      summary: "Interrogez un chat sur vos projets, sessions et épingles, et laissez l’assistant les organiser une fois chaque changement confirmé.",
      sections: [
        {
          heading: "Ce qu’est l’assistant",
          paragraphs: [
            "L’assistant est un chat intégré à Pinar, dans l’application locale et dans Pinar Cloud. Il répond aux questions sur vos projets, collections, sessions, lots et épingles, y compris sur ce qui apparaît dans la capture d’écran d’une épingle.",
            "Il peut aussi organiser votre travail : créer, renommer, déplacer et supprimer des éléments, commenter des épingles, les conclure ou les rouvrir. Il le fait toujours par une proposition, et rien ne change tant que vous ne l’avez pas confirmée.",
          ],
        },
        {
          heading: "Ouvrir l’assistant",
          paragraphs: [
            "Dans le workspace, choisissez le bouton « Assistant » en haut de la page pour ouvrir le panneau du chat. Écrivez dans « Posez une question à l’assistant… » et appuyez sur `Enter` pour envoyer ; `Shift+Enter` commence une nouvelle ligne.",
            "Si l’IA n’est pas encore configurée dans l’application locale, le panneau affiche « Ouvrir les paramètres IA ». Dans Pinar Cloud sans Pro, il affiche « Voir les offres ».",
          ],
        },
        {
          heading: "Ce que vous pouvez demander",
          paragraphs: [
            "Posez vos questions avec vos propres mots, sur tout ce que vous avez capturé. Voici quelques exemples de questions et de demandes :",
          ],
          bullets: [
            "« Quelles épingles de la collection Checkout sont encore ouvertes ? »",
            "« Que montre la capture d’écran de l’épingle 3 ? »",
            "« Déplacez les sessions sur l’en-tête vers la collection Design. »",
            "« Concluez l’épingle 2 et commentez que la correction est en ligne. »",
          ],
        },
        {
          heading: "Rien ne change sans votre confirmation",
          paragraphs: [
            "Quand vous demandez un changement, l’assistant répond par une carte qui le décrit. Rien ne change tant que vous n’avez pas choisi « Confirmer » ; choisissez « Refuser » pour l’écarter. Une carte qui attend trop longtemps expire, et vous pouvez redemander.",
            "Certaines actions peuvent être annulées depuis la même carte : une fois exécutées, la carte affiche « Annuler » et pendant combien de temps c’est encore possible. Les actions irréversibles sont signalées par « Impossible à annuler » avant votre confirmation.",
          ],
        },
        {
          heading: "Dans l’application locale",
          paragraphs: [
            "L’application locale utilise l’IA que vous avez configurée dans Paramètres → Assistant IA et ne dépense aucun crédit Pinar. Sans modèle de recherche sémantique, l’assistant cherche dans vos épingles d’après leur texte.",
          ],
        },
        {
          heading: "Dans Pinar Cloud : Pro et crédits",
          paragraphs: [
            "Dans Pinar Cloud, l’assistant fait partie de Pro. Chaque message que vous envoyez utilise 3 crédits IA, et une réponse qui échoue les rend. Confirmer ou annuler une proposition n’utilise aucun crédit. Quand un message répondu par votre propre endpoint échoue, le panneau montre la cause et deux boutons : « Réessayer » et « Utiliser les crédits Pinar » ; le second envoie seulement ce message par les fournisseurs de Pinar, avec crédits.",
            "Ce sont les mêmes crédits que ceux de la transcription vocale, et les packs de crédits ne peuvent être achetés qu’avec Pro. [Crédits IA Pinar Cloud pour la voix et l’assistant](/help/cloud/ai-credits) détaille les soldes et les remboursements.",
          ],
        },
        {
          heading: "Laisser Pinar choisir la collection",
          paragraphs: [
            "Dans Paramètres → « Capture », activez « Choisir la collection automatiquement ». Pinar choisit alors une collection pour chaque nouvelle capture parmi celles que vous avez déjà ; en cas de doute, la capture va dans la « Boîte de réception ». Les captures d’un même lot restent ensemble. L’option a besoin d’une IA disponible. Si l’option reste activée sans IA disponible, les nouvelles captures vont dans la « Boîte de réception » ; pour choisir vous-même la destination, désactivez l’option. Dans Pinar Cloud, chaque capture dont l’IA choisit la collection utilise 1 crédit IA ; un choix en échec ou expiré le rend, et sans solde l’IA n’est pas appelée et la capture va dans la « Boîte de réception ». [Crédits IA Pinar Cloud pour la voix et l’assistant](/help/cloud/ai-credits) détaille les soldes et les remboursements.",
          ],
          bullets: [
            "Une session classée ainsi affiche une petite marque. Survolez-la ou donnez-lui le focus pour lire « Classée automatiquement. Déplacez-la pour corriger. »",
            "Si la collection ne convient pas, déplacez la session vers la bonne. Cela corrige le choix et retire la marque.",
          ],
        },
        {
          heading: "Confidentialité",
          paragraphs: [
            "Les commentaires et les captures d’écran utilisés par l’assistant vont au fournisseur d’IA que vous avez configuré dans l’application locale, ou aux fournisseurs d’IA de Pinar dans Pinar Cloud, où la capture d’écran sert aussi à décrire l’épingle et à la retrouver par la recherche ; [Où vivent vos données](/help/privacy/where-data-lives) donne le détail.",
          ],
        },
      ],
    },
    "closed-loop-review": {
      title: "Clôturer le cycle de relecture de l’agent",
      summary:
        "Suivez ce qu’un agent a changé, vérifiez-le en tant qu’humain, et ne rouvrez que lorsqu’une autre correction est nécessaire.",
      sections: [
        {
          heading: "Retour de l’agent",
          paragraphs: [
            "Un agent peut signaler chaque pin comme changed, blocked, not applicable ou not located, avec un résumé, une raison, des fichiers modifiés, un commit et une pull request. Une livraison répétée avec la même clé d’idempotence est sûre ; un contenu conflictuel sous cette clé est rejeté.",
          ],
        },
        {
          heading: "Vérification humaine",
          paragraphs: [
            "Un résultat changed fait passer un pin open ou reopened à correction ready. Seul un humain peut accepter une correction ou rouvrir un pin accepté. Les agents ne peuvent pas accepter leur propre travail, et les transitions d’état invalides sont rejetées.",
          ],
          bullets: [
            "Flux normal : open → correction ready → accepted.",
            "Si la vérification échoue : accepted → reopened → correction ready.",
          ],
        },
        {
          heading: "Enregistrer une exécution et l’accepter en tant qu’humain",
          paragraphs: [
            "Un agent signale le travail par rapport au `captureId` de la capture et à chaque `pinId`. Ne répétez une livraison avec la même clé que lorsque le résultat est inchangé ; un résumé, des fichiers ou un statut différent nécessitent une nouvelle clé. Les pins ou captures inconnus sont rejetés sans renvoyer les commentaires privés.",
            "Une personne accepte une correction ou rouvre un pin accepté depuis l’interface de relecture. Les agents ne peuvent pas accepter leur propre travail. Après une réouverture humaine, la nouvelle tentative prévue est un second résultat changed. Laissez les métriques de boucle anonymes désactivées sauf si vous y adhérez.",
          ],
          bullets: [
            "Publiez un résultat changed pour le même `captureId` et `pinId`, puis confirmez que le visualiseur affiche le pin comme prêt à accepter.",
            "Réutilisez une clé de livraison uniquement lorsque le résultat est identique ; créez une nouvelle clé lorsque les fichiers, le résumé ou le statut ont réellement changé.",
            "Si la vérification échoue, rouvrez en tant qu’humain, publiez un second résultat, acceptez à nouveau, et conservez les identifiants de capture avant et après.",
          ],
        },
      ],
    },
    "handoff-troubleshooting": {
      title: "Dépanner les avertissements de copie et de handoff",
      summary:
        "Récupérez d’un échec de presse-papiers, de helper, de screenshot ou de visualiseur sans perdre les annotations.",
      sections: [
        {
          heading: "Récupération du presse-papiers",
          paragraphs: [
            "Pinar utilise d’abord l’API presse-papiers du navigateur via un document offscreen, puis se rabat sur une sélection de texte cachée lorsque la permission ou le focus le bloque. Si tous les mécanismes de copie échouent, l’overlay est restauré afin que vos pins et commentaires restent modifiables.",
          ],
        },
        {
          heading: "Dégradé ne veut pas dire non corrélé",
          paragraphs: [
            "`screenshot_missing` signifie que l’image n’a pas pu être persistée. `helper_unavailable` signifie que le service local n’a pas été joint. `viewer_unavailable` signifie qu’aucune URL de visualiseur n’a été produite. Continuez à partir du commentaire, du chemin DOM, du sélecteur, des coordonnées de pin, de `captureId` et de `pinId`, puis ne réessayez que la couche manquante.",
          ],
        },
        {
          heading:
            "Parcourir le chemin de copie lorsque la barre d’outils signale un échec",
          paragraphs: [
            "La copie exige un commentaire enregistré et au moins un pin. La barre d’outils affiche « Enregistrement de la session… », masque les overlays, capture le cliché, puis demande au document offscreen d’écrire text/html et text/plain. Offscreen essaie d’abord navigator.clipboard.write puis se rabat sur un événement copy plus execCommand. Si cette écriture n’est pas ok, le content script tente encore writePlainText sur la charge plain renvoyée : clipboard.writeText, puis une sélection textarea cachée.",
            "Lorsque tous les chemins de copie échouent, la page envoie overlays:hidden avec hidden false, affiche brièvement « Échec de la copie », et laisse les pins modifiables. Une copie réussie affiche « Copié avec succès ! », ou « Copié avec succès ! » plus « pas de capture », « assistant indisponible » ou « pas de visionneuse », puis termine la session. Ces suffixes correspondent à `screenshot_missing`, `helper_unavailable` et `viewer_unavailable`. screenshot_inline n’est pas l’un des avertissements de handoff dégradé. Un collage sans clôture pinar-visual-context fermée ne peut pas être analysé comme JSON.",
          ],
          bullets: [
            "Si la barre d’outils indique « Écrivez un commentaire » ou « Ajoutez une épingle », terminez ce pin et appuyez à nouveau sur `Command+Enter` / `Alt+Enter`.",
            "Si « Échec de la copie » apparaît, confirmez que les pins sont encore sur la page, accordez la permission du presse-papiers si elle est demandée, et réessayez la copie.",
            "Lisez le suffixe « Copié avec succès ! » : « pas de capture », « assistant indisponible » et « pas de visionneuse » nomment la couche manquante à réessayer sans jeter les commentaires.",
          ],
        },
        {
          heading: "Messages lors de la fin de session",
          paragraphs: [
            "Lorsque la fin de session échoue parce que le screenshot final ne peut pas être capturé, la barre d’outils affiche l’un de ces messages au lieu d’une erreur générique, et la session reste sur la page pour un nouvel essai. Chaque message nomme la cause et la correction :",
          ],
          bullets: [
            "« Un pin est hors de la zone visible · ramenez-le dans la zone visible et réessayez » — faites défiler jusqu’à ce que l’élément épinglé soit visible, puis terminez la session à nouveau.",
            "« La page a changé pendant la capture · restez dessus et réessayez » — terminez à nouveau depuis la page annotée sans en sortir.",
            "« L'onglet annoté n'était pas actif · revenez-y et réessayez » — revenez à l’onglet annoté et terminez à nouveau.",
            "« Capture d'écran non réalisée · revenez à la page annotée et réessayez » — revenez à la page annotée et terminez à nouveau.",
          ],
        },
      ],
    },
    "organize-projects": {
      title: "Organiser les projets et les sessions",
      summary:
        "Déplacez les captures sans les perdre et conservez Personal comme repli protégé.",
      sections: [
        {
          heading: "Projets et repli",
          paragraphs: [
            "Les projets regroupent collections et sessions. Personal est le projet par défaut protégé et Inbox est sa collection protégée. Supprimer un autre projet promeut ses sessions vers le repli au lieu de les détruire.",
          ],
        },
        {
          heading: "Déplacer et ordonner",
          paragraphs: [
            "Faites glisser des sessions entre collections pour les réordonner, ou utilisez Déplacer vers en lot pour un ensemble sélectionné.",
          ],
        },
        {
          heading: "Confirmer où atterrit une session déplacée",
          paragraphs: [
            "Ouvrez une collection pour voir et modifier l’ordre manuel enregistré en faisant glisser une session sur sa voisine. Lorsqu’aucune collection n’est sélectionnée, la liste trie par date de création au lieu de cet ordre enregistré.",
            "Un glisser commence depuis la carte ou la ligne de tableau, pas depuis la recherche, les cases à cocher ou le menu d’actions (`data-no-dnd`). Si la session glissée est déjà sélectionnée avec d’autres, chaque id sélectionné voyage avec elle ; sinon seule cette session se déplace. Déplacer vers demande un projet, puis une collection dans l’arbre aplati de ce projet ; changer de projet vide le champ collection, et un projet sans collections est désactivé. La session est ajoutée à la position suivante dans la cible. Supprimer Personal est refusé ; supprimer un autre projet ajoute ses sessions à Inbox dans l’ordre existant et retire les collections de ce projet.",
          ],
          bullets: [
            "Pour changer l’ordre dans une collection, faites glisser une session sur sa voisine.",
            "Pour déplacer plusieurs sessions, sélectionnez-les d’abord, puis faites glisser n’importe quelle carte sélectionnée ou ouvrez Déplacer vers ; glisser une carte non sélectionnée ne déplace que cette session.",
            "Après avoir supprimé un projet non Personal, ouvrez Personal / Inbox et parcourez la fin de la liste pour les sessions ajoutées avant de les classer à nouveau.",
          ],
        },
      ],
    },
    "nested-collections": {
      title: "Utiliser des collections imbriquées",
      summary:
        "Construisez une hiérarchie dans chaque projet et réorganisez-la sans aplatir les relations enfants.",
      sections: [
        {
          heading: "Arbre de collections",
          paragraphs: [
            "Les collections peuvent avoir des collections parentes et enfants. Glisser une branche préserve la profondeur et les relations descendantes tout en la déplaçant dans le même arbre de projet. Les cycles, les parents inconnus et l’imbrication sous un conteneur protégé sont rejetés. Supprimer un parent promeut ses collections enfants au niveau parent dans leur ordre existant.",
          ],
        },
        {
          heading: "Destinations depuis la capture",
          paragraphs: [
            "L’extension peut cibler un projet ou une collection avant d’enregistrer dans le cloud. Si une destination sélectionnée n’est plus disponible, le repli protégé Personal/Inbox conserve la session accessible.",
          ],
        },
        {
          heading: "Indenter une branche, puis vérifier le parent",
          paragraphs: [
            "Pendant le glisser d’une collection, le décalage horizontal est mesuré en pas d’indentation de 18 pixels. La profondeur projetée est bornée afin de ne pas aller plus profond qu’un niveau sous le frère précédent, ni plus superficielle que le frère suivant. Déposer une branche sur l’un de ses descendants est ignoré et l’arbre reste en place. Les collections protégées restent à la profondeur 0, et la liste triable traite les enfants d’une collection protégée comme des racines afin qu’ils ne puissent pas rester imbriqués sous ce conteneur protégé.",
            "Dans le sélecteur de destination de l’extension, `destination:get` renvoie un CaptureDestination (`projectId` et `collectionId`) plus l’arbre de projet, avec les collections imbriquées indentées de 16 pixels par profondeur. Changer de projet enregistre immédiatement la collection protégée de ce projet s’il en existe une, sinon sa première collection. Si `destination:set` échoue, la page d’options affiche l’erreur destination-unavailable et recharge `destination:get` afin qu’une collection manquante ne reste pas sélectionnée. Un arbre vide affiche un placeholder Inbox désactivé.",
          ],
          bullets: [
            "Faites glisser une collection vers la droite pour l’imbriquer sous le frère précédent, ou vers la gauche vers la racine ; si le dépôt est rejeté, la liste parentId est inchangée.",
            "Ne repliez un parent que lorsque vous avez besoin d’une barre latérale plus courte ; les descendants masqués restent dans l’arbre et se déplacent encore avec la branche glissée.",
            "Après une erreur d’enregistrement de destination, rouvrez les options de l’extension et confirmez que le projet et la collection correspondent à une entrée d’arbre live avant la prochaine capture cloud.",
          ],
        },
      ],
    },
    "find-manage-share": {
      title: "Trouver, gérer et partager des sessions",
      summary:
        "Recherchez chaque champ utile, filtrez le travail de relecture, agissez en lot et ne publiez que ce que vous voulez.",
      sections: [
        {
          heading: "Recherche et vues",
          paragraphs: [
            "La recherche correspond au titre de page, à l’URL, à la description, aux commentaires de pins et aux sélecteurs CSS. Les filtres de nombre de pins et de statut de relecture peuvent être combinés. Basculez entre grille de cartes et tableau ; le tableau offre 15, 30, 60 ou 100 lignes par page et mémorise la vue localement.",
          ],
        },
        {
          heading: "Actions en lot et de partage",
          paragraphs: [
            "Sélectionnez des sessions dans l’une ou l’autre vue pour les déplacer ou les supprimer ensemble. Supprimer une session est définitif : cela retire le screenshot plus les exécutions d’agents, les résultats de pins, les relectures et les événements de relecture. Les visualiseurs publics de sessions, projets et collections sont non listés plutôt que contrôlés par accès ; quiconque a un lien actif peut en ouvrir un. Les visualiseurs agrégés peuvent copier le Markdown combiné de chaque session incluse.",
          ],
        },
        {
          heading: "Combiner les filtres, puis copier le Markdown public",
          paragraphs: [
            "La recherche retire les espaces et correspond comme une sous-chaîne insensible à la casse. Une requête uniquement composée d’espaces laisse chaque session éligible jusqu’à ce que les filtres de nombre de pins ou de statut de relecture les excluent. Les cases de nombre de pins sont des seaux de 1, 2–5 et 6 ou plus ; une session doit correspondre à au moins un seau sélectionné. Les filtres de statut de relecture s’appliquent aux reviewCounts stockés ; si ces totaux manquent, chaque pin est traité comme open. Changer la recherche, l’un ou l’autre filtre, la collection ou le projet réinitialise la pagination à la première page.",
            "Tout sélectionner en grille ne s’applique qu’à la page courante de cartes ; tout sélectionner en tableau utilise la page de tableau courante. Le choix grille ou tableau est mémorisé dans ce navigateur. La suppression en lot demande une confirmation, puis retire chaque session sélectionnée. Un visualiseur public de projet ou de collection copie le Markdown combiné depuis la page de partage. Si ce partage a disparu, le visualiseur affiche un état introuvable au lieu d’une liste.",
          ],
          bullets: [
            "Après avoir appliqué la recherche ou les filtres, confirmez que la pagination est passée à la page 1 afin de ne pas lire une page périmée d’un ancien jeu de résultats.",
            "N’utilisez Déplacer vers ou Supprimer de la barre en lot qu’après que les cases correspondent aux sessions visées ; Effacer la sélection vide l’ensemble sans changer le stockage.",
            "Sur un visualiseur agrégé, Copier le Markdown doit coller un titre, une URL de visualiseur `/p/` ou `/c/`, puis chaque session comme un titre `/v/{id}` avec Page, Markdown, Screenshot optionnel et commentaires de pins numérotés ; si la copie échoue avec Unable to load Markdown, ouvrez la même URL `.md` dans le navigateur.",
          ],
        },
      ],
    },
    "account-and-sign-in": {
      title: "Compte et connexion sans mot de passe",
      summary:
        "Connectez l’extension, ouvrez le workspace web et comprenez l’expiration des codes et des sessions.",
      sections: [
        {
          heading: "Code e-mail pour Free et Pro",
          paragraphs: [
            "Créez votre compte sur pinar.dev avec votre e-mail. Le code à six chiffres expire après dix minutes et se bloque après cinq essais incorrects, et un nouveau compte Free est créé seulement après confirmation du code. L’extension se connecte à un compte existant uniquement : si l’adresse n’a pas encore de compte, elle vous demande de le créer d’abord sur le site web Pinar. Les fournisseurs temporaires sont bloqués pour les nouveaux comptes ; les domaines personnalisés sont acceptés.",
          ],
        },
        {
          heading: "Sessions",
          paragraphs: [
            "Les sessions web durent 30 jours et les appareils d’extension authentifiés durent 180 jours. Les codes expirent pour des raisons de sécurité.",
          ],
        },
        {
          heading: "Se connecter depuis l’onglet Préférences de l’extension",
          paragraphs: [
            "Ouvrez les options de l’extension et restez sur l’onglet Préférences. Choisissez Serveur Distant comme stockage, saisissez votre e-mail, demandez un code et entrez le code reçu pour relier cette extension à votre compte. Les captures d’une ancienne installation anonyme sont transférées au compte lors de la vérification.",
            "La demande affiche la même réponse pour les adresses inconnues ou bloquées, sans révéler si un compte existe. La déconnexion termine la session actuelle de l’extension.",
          ],
          bullets: [
            "Si aucun e-mail n’arrive, attendez avant de réessayer ; les codes expirent, et trop de tentatives sont retardées.",
            "Utilisez un code reçu par e-mail.",
            "Utilisez Se déconnecter dans l’onglet Préférences de l’extension, ou dans le menu de compte de la page web, lorsque vous devez terminer immédiatement la session courante de l’extension ou de la page web.",
          ],
        },
      ],
    },
    "plans-and-billing": {
      title: "Free, Pro et facturation",
      summary:
        "Comparez les droits produit, gérez un abonnement et traitez la page tarifs comme la source de prix actuelle.",
      sections: [
        {
          heading: "Forme des plans",
          paragraphs: [
            "L’application locale et un serveur auto-hébergé restent gratuits. Pinar Cloud hébergé suit l’offre actuelle et l’éligibilité de ce compte : un nouveau compte peut recevoir une évaluation temporaire, et un compte antérieur peut conserver une éligibilité héritée. Il n’y a pas une seule échéance pour tous les comptes. Pro est un plan annuel payant, avec 2 Go et une allocation unique de 500 crédits IA lors du premier abonnement du compte. Dans Pinar Cloud, la transcription vocale reste un avantage Pro ; l’application locale peut transcrire la voix avec votre propre endpoint IA. La page Plans et les droits du compte indiquent l’offre et le quota qui s’appliquent maintenant. Les captures déjà stockées dans le cloud restent soumises à la rétention et à l’export.",
          ],
        },
        {
          heading: "Facturation et disponibilité",
          paragraphs: [
            "Les prix régionaux BRL ou mondiaux USD et les offres actuelles appartiennent à la page Plans. Le portail client Stripe gère les changements de plan, l’annulation, les moyens de paiement et les factures.",
          ],
        },
        {
          heading:
            "Lancer Checkout avec les politiques actuelles et la bonne devise",
          paragraphs: [
            "Payer sur Plans accepte les Conditions, la Politique de confidentialité et l’Utilisation acceptable en vigueur. Le Brésil utilise les prix en BRL ; les autres pays utilisent l’USD.",
            "Après un paiement réussi, l’offre est accordée au compte connecté et vous revenez au workspace. Le portail de facturation est disponible après un checkout payant. Lorsqu’un abonnement Pro se termine, ces sessions cloud entrent dans une fenêtre de récupération .",
          ],
          bullets: [
            "Poursuivre un checkout payant sur Plans accepte les versions de politique courantes.",
            "Les avantages Pro nécessitent un abonnement actif ; acheter une option n’active pas Pro.",
            "Si Gérer l’abonnement est indisponible, terminez d’abord un Checkout payant, puis ouvrez-le depuis un compte connecté.",
          ],
        },
        {
          heading: "Lorsqu’une évaluation prend fin",
          paragraphs: [
            "Lorsqu’une évaluation temporaire prend fin, les nouvelles captures dans Pinar Cloud sont en pause jusqu’à ce que le compte s’abonne. Les captures déjà stockées restent disponibles et demeurent soumises à la rétention et à l’export, comme décrit dans Stockage, rétention et récupération.",
          ],
        },
      ],
    },
    "ai-credits": {
      title: "Crédits IA Pinar Cloud pour la voix et l’assistant",
      summary: "Comprenez comment la voix, l’assistant, la reproduction et le choix automatique de la collection dépensent les crédits Pinar Cloud, quand ils sont rendus et comment en acheter.",
      sections: [
        {
          heading: "Ce qui utilise des crédits",
          paragraphs: [
            "Dans Pinar Cloud, la transcription vocale et l’assistant utilisent des crédits IA. Un enregistrement vocal jusqu’à 60 secondes réserve 1 crédit ; de 61 à 120 secondes, 2 crédits. En cas de succès, la réservation est consommée. Une transcription échouée la rembourse et une réservation non soldée après cinq minutes est remboursée automatiquement.",
            "Chaque message envoyé à l’assistant dans Pinar Cloud utilise 3 crédits, et une réponse qui échoue les rend. Confirmer ou annuler une proposition n’utilise aucun crédit. Dans l’application locale, l’assistant utilise l’IA que vous avez configurée et aucun crédit Pinar.",
            "Dans Pinar Cloud, générer les étapes rédigées de reproduction utilise 1 crédit IA par génération, et une génération qui échoue le rend.",
            "Avec le choix automatique de la collection activé, chaque capture dont l’IA choisit la collection utilise 1 crédit, même quand le choix est la « Boîte de réception » ; un choix en échec ou expiré le rend, et sans solde l’IA n’est pas appelée et la capture va dans la « Boîte de réception ».",
            "Avec votre propre endpoint, une fonction est servie par lui, sans crédits Pinar Cloud, quand sa capacité a passé le test de connexion ; [Utiliser votre propre endpoint d’IA dans Pinar Cloud](/help/cloud/own-ai-endpoint) explique le test et ce que chaque fonction utilise, avec l’exception de la recherche dans vos pins d’une réponse servie par votre endpoint, qui n’utilise pas les crédits des fournisseurs de Pinar.",
          ],
        },
        {
          heading: "Soldes",
          paragraphs: [
            "Le premier abonnement Pro du compte accorde 500 crédits une seule fois. Un renouvellement, une réactivation ou un changement de plan ne les accorde pas de nouveau. Les packs Pinar Cloud achetés ajoutent 500 crédits pour 12 mois et ne peuvent être achetés qu’avec Pro. La voix, l’assistant, la reproduction et le choix automatique de la collection puisent dans le même solde.",
          ],
        },
        {
          heading: "Relancer une demande et consulter l’historique",
          paragraphs: [
            "Dans Pinar Cloud, si une transcription est déjà en cours, attendez sa fin au lieu de renvoyer l’enregistrement. Les requêtes échouées remboursent la réservation lorsque c’est possible. Si le solde est trop faible, l’extension conserve le commentaire saisi et indique qu’il faut davantage de crédits.",
            "Le solde qui expire le plus tôt est utilisé en premier. Le menu du compte affiche les crédits restants ; il n’y a pas de recharge mensuelle ou annuelle.",
          ],
          bullets: [
            "Si une transcription est déjà en cours, attendez sa fin au lieu de renvoyer le même enregistrement.",
            "Si une réservation expire ou est remboursée, enregistrez ou envoyez de nouveau le commentaire vocal.",
            "Si une réponse de l’assistant échoue, ses crédits sont rendus ; renvoyez le message quand vous le souhaitez.",
            "Si le workspace affiche zéro crédit, vérifiez le solde avant d’acheter un autre pack de 500 crédits.",
            "Si vous envoyez trop de requêtes IA dans la même minute, la requête est refusée temporairement ; attendez une minute et réessayez.",
          ],
        },
      ],
    },
    "own-ai-endpoint": {
      title: "Utiliser votre propre endpoint d’IA dans Pinar Cloud",
      summary: "Enregistrez votre propre endpoint dans Pinar Cloud Pro, testez ses capacités et voyez quelles fonctions il sert sans crédits.",
      sections: [
        {
          heading: "Ce que c’est",
          paragraphs: [
            "Votre propre endpoint est un avantage Pinar Cloud qui demande le Pro. Le fournisseur d’IA est choisi et contracté par vous, ses termes s’appliquent à ce traitement, et Pinar ne fait que transférer vos demandes vers lui. Contrairement à l’application locale, où l’IA que vous configurez ne passe pas par Pinar, ici la demande passe par Pinar Cloud en chemin vers votre endpoint.",
            "Il se trouve dans Paramètres → « Assistant IA », dans le bloc « Votre propre endpoint ». Une fonction utilise votre endpoint, sans crédits Pinar Cloud, quand sa capacité a passé le test de connexion ; une fonction dont la capacité n’a pas passé continue d’utiliser les fournisseurs de Pinar, avec crédits, comme aujourd’hui, avec une exception : la recherche dans vos pins d’une réponse servie par votre endpoint ne va jamais aux fournisseurs de Pinar. La section « Ce qui utilise votre endpoint et ce qui continue d’utiliser des crédits » explique la destination de chaque fonction.",
          ],
        },
        {
          heading: "Enregistrer l’endpoint",
          paragraphs: [
            "Dans Paramètres → « Assistant IA », ouvrez le bloc « Votre propre endpoint ». Saisissez l’« Endpoint » — l’URL de base compatible OpenAI, généralement terminée par /v1 — et la « Clé API ». Les trois champs de modèle — « Modèle de chat », « Modèle d’embedding » et « Modèle de transcription » — sont facultatifs : avec l’un vide, les fonctions qui en dépendent suivent ce que la section « Ce qui utilise votre endpoint et ce qui continue d’utiliser des crédits » explique.",
            "L’URL de base doit être en HTTPS, sans utilisateur ni mot de passe dans l’URL et sans adresse privée ou locale ; le reste est refusé avant l’enregistrement.",
          ],
        },
        {
          heading: "Le test de connexion et les capacités",
          paragraphs: [
            "« Tester et enregistrer » teste les valeurs saisies et n’enregistre l’endpoint que si au moins une capacité passe ; si aucune ne passe, rien n’est enregistré, la configuration précédente reste en place et la liste affiche le résultat du test comme non enregistré. Avec l’endpoint enregistré et sans modification, le bouton « Tester la connexion » teste de nouveau l’endpoint enregistré. Le test vérifie quatre capacités : « Chat avec outils », « Vision », « Embeddings » et « Transcription ».",
            "Chaque capacité affiche un des trois états : « Votre endpoint » quand elle a passé ; « Crédits Pinar » quand elle n’a pas passé, avec la cause courte ; ou « Non testé ». Il y a une limite de tests en série ; quand vous l’atteignez, attendez un instant et réessayez.",
          ],
        },
        {
          heading: "Ce qui utilise votre endpoint et ce qui continue d’utiliser des crédits",
          paragraphs: [
            "Chaque fonction est servie par votre endpoint, sans crédits Pinar Cloud, quand sa capacité a passé le test. Une fonction dont la capacité n’a pas passé continue d’utiliser les fournisseurs de Pinar, avec crédits, comme aujourd’hui, avec une exception : dans la recherche dans vos pins d’une réponse servie par votre endpoint, la recherche utilise la vision et les Embeddings de l’endpoint quand ils passent, ou le texte seul quand ils ne passent pas, et rien ne va aux fournisseurs de Pinar.",
          ],
          bullets: [
            "L’assistant : avec le chat avec outils approuvé, la réponse va à l’endpoint ; sans lui, elle va par les fournisseurs de Pinar, avec crédits. Dans la recherche dans vos pins d’une réponse de l’endpoint, la recherche utilise la vision et les Embeddings de l’endpoint quand ils passent ; sans eux, la recherche est par texte seulement, et rien ne va aux fournisseurs de Pinar.",
            "La voix sur un pin : la transcription décide. Avec la transcription approuvée, l’enregistrement va à l’endpoint, et la structuration du texte va au chat de l’endpoint quand il est approuvé ; sans lui, elle va aux fournisseurs de Pinar dans Pinar Cloud, avec 1 crédit. Sans la transcription approuvée, la voix garde le chemin d’aujourd’hui, avec crédits.",
            "Les étapes rédigées de reproduction : avec le chat approuvé, elles vont à l’endpoint ; sans lui, elles gardent le chemin d’aujourd’hui, avec crédits.",
            "Le choix automatique de la collection : avec les Embeddings approuvés, il utilise l’endpoint ; sans eux, il garde le chemin d’aujourd’hui, avec crédits. Quand l’endpoint échoue sur une demande, la capture reste à la destination par défaut, sans crédits Pinar Cloud.",
          ],
        },
        {
          heading: "Quand l’endpoint échoue sur une demande",
          paragraphs: [
            "L’assistant et les étapes rédigées de reproduction montrent la cause et deux boutons : « Réessayer » et « Utiliser les crédits Pinar » ; le second envoie seulement cette demande par les fournisseurs de Pinar, avec crédits. Dans l’extension, une transcription vocale en échec montre la cause et propose de renvoyer le même enregistrement vocal avec crédits.",
          ],
        },
        {
          heading: "La clé et votre vie privée",
          paragraphs: [
            "La clé API est chiffrée dans Pinar Cloud, et l’écran n’affiche que ses quatre derniers caractères ; elle est déchiffrée en mémoire seulement au moment de chaque appel, n’est jamais écrite dans un journal, et elle est supprimée quand vous supprimez l’endpoint ou votre compte. [Où vivent vos données](/help/privacy/where-data-lives) donne les détails.",
          ],
        },
      ],
    },
    "storage-and-retention": {
      title: "Stockage, rétention et récupération",
      summary:
        "Comprenez les quotas, les options expirantes, les envois bloqués et la fenêtre de récupération.",
      sections: [
        {
          heading: "Quota et options",
          paragraphs: [
            "Le quota cloud hébergé est le stockage que le compte connecté inclut actuellement, plus toute option encore active. Pro inclut 2 Go. Les options de 1 Go et 5 Go durent 12 mois. Si une option expire au-dessus du quota, les envois sont suspendus ; l’excédent bénéficie de 30 jours de grâce et reste récupérable jusqu’au jour 90 avant de pouvoir être supprimé. L’achat d’une option dépend de l’offre actuelle ; consultez la page Plans et les droits du compte.",
          ],
        },
        {
          heading: "Après l’expiration des droits",
          paragraphs: [
            "Si un droit expirant laisse le compte au-delà du quota, Pinar accorde une période de grâce de 30 jours suivie d’un accès de récupération jusqu’au jour 90. Ensuite, les données en excès deviennent éligibles au nettoyage. La suppression automatique n’est actuellement pas activée, donc l’éligibilité n’est pas une promesse de suppression immédiate.",
          ],
        },
        {
          heading:
            "Faire tenir les remplacements sous le quota et utiliser l’horloge de récupération de 90 jours",
          paragraphs: [
            "Le quota est le stockage inclus de votre plan plus toute option encore active. Remplacer un screenshot plus lourd par un plus petit peut réussir lorsqu’une capture entièrement nouvelle échouerait. Les envois s’interrompent dès que le compte est au quota ou au-dessus, y compris pendant la grâce et la récupération.",
            "Les sessions déjà stockées sur une éligibilité Free et non marquées permanentes deviennent éligibles au nettoyage après 30 jours. Le contenu Pro au-dessus du quota Free suit la grâce de 30 jours et la fenêtre de récupération de 90 jours après la fin de l’éligibilité payante. L’historique uniquement local sur cet ordinateur n’est jamais supprimé à distance. L’éligibilité n’est pas une promesse de retrait immédiat.",
          ],
          bullets: [
            "Lorsque de nouvelles captures s’interrompent, libérez de l’espace en supprimant des sessions ou en remplaçant un screenshot lourd. Achetez une option de douze mois de 1 Go ou 5 Go seulement lorsque la page Plans et les droits du compte affichent cet achat.",
            "Si le compte est en grâce ou en récupération, exportez ce dont vous avez encore besoin avant le jour 90 ; l’éligibilité ne fait que marquer le dépassement, elle ne supprime pas elle-même.",
            "N’attendez pas que la désinstallation de l’app de bureau purge les objets cloud, et n’attendez pas que le cloud efface l’historique local sur cet ordinateur.",
          ],
        },
      ],
    },
    "sharing-links": {
      title: "Partager des sessions, des projets et des collections",
      summary:
        "Utilisez les visualiseurs non listés et les projections Markdown avec les bonnes attentes de confidentialité.",
      sections: [
        {
          heading: "Liens publics non listés",
          paragraphs: [
            "Les sessions, les projets et les collections de Pinar Cloud restent privés jusqu’à ce que vous publiiez un partage : le Markdown privé ne s’ouvre qu’avec votre compte ou une clé autorisée. Un partage publié est un visualiseur non répertorié pour une session, un lot, un projet ou une collection. Il est public pour quiconque a le lien et n’est pas indexé comme une navigation normale. Ne traitez pas une URL non listée comme une authentification pour du contenu sensible.",
          ],
        },
        {
          heading: "Collaborer sur une collection",
          paragraphs: [
            "Collaborer sur une collection est proposé par Pinar Cloud aux propriétaires Pro. Depuis le menu de la collection, choisissez « Collaborateurs », puis invitez des personnes par e-mail avec le bouton « Inviter ». L’onglet liste chaque collaborateur avec le statut « En attente » ou « Accepté », et « Révoquer l’accès » en retire un.",
          ],
          bullets: [
            "Une personne invitée voit un avis « Invitations en attente » dans le workspace. « Voir les invitations » ouvre la boîte de dialogue « Invitations à des collections », où « Accepter l’invitation » accepte l’invitation et « Ouvrir la collection » ouvre la collection.",
            "Les collections acceptées apparaissent dans la section « Collections partagées » de la barre latérale, avec le nom du propriétaire et le nombre de sessions.",
            "Dans le visualiseur public de collection, une personne qui arrive par invitation est marquée d’un badge « Partagée avec vous ».",
            "Une collection partagée est suspendue pendant que l’abonnement Pro du propriétaire est inactif. Dans la barre latérale, elle affiche alors un badge « Suspendue » et ne peut pas s’ouvrir, et la page de la collection affiche « Accès à la collection suspendu » avec une note indiquant que l’accès reprend automatiquement lorsque Pro est rétabli.",
          ],
        },
        {
          heading: "Markdown pour les agents",
          paragraphs: [
            "La projection .md d’une session inclut les métadonnées, les références de screenshot, les localisateurs, les résultats d’agents et l’historique de relecture. Les projections de projet et de collection combinent leurs sessions. Des données partagées expirées ou indisponibles renvoient une réponse introuvable plutôt que des détails de compte privés.",
          ],
        },
        {
          heading:
            "Copier la projection Markdown publique et savoir ce qu’elle expose",
          paragraphs: [
            "Chaque session, projet ou collection a une page non listée et une copie Markdown. Copier le Markdown place ce texte dans le presse-papiers, et chaque carte de session ouvre son propre visualiseur. Un lien manquant ou invalide affiche une page introuvable plutôt que l’e-mail du propriétaire, le plan ou d’autres champs de compte.",
            "Le Markdown de session inclut le paquet de handoff plus les résultats d’agents et les relectures de pins. Le Markdown de projet et de collection liste chaque session imbriquée avec l’URL de page, les commentaires de pins, `pinId` et les localisateurs. Les lignes Screenshot n’apparaissent que lorsque le propriétaire autorise la livraison de screenshots. Quiconque peut ouvrir le lien peut copier ce qu’il voit, donc une URL non listée n’est pas une autorisation.",
          ],
          bullets: [
            "Avant d’envoyer un lien de projet ou de collection, ouvrez une fois Copier le Markdown et vérifiez que chaque session imbriquée, commentaire de pin et ligne de screenshot est sûre à publier.",
            "Désactivez la livraison de screenshots sur le compte du propriétaire si le Markdown partagé doit garder les URL d’images hors du contenu.",
            "Si un chemin partagé affiche introuvable, traitez le lien comme disparu ou invalide ; cette page n’ajoute pas de détails de compte privés.",
          ],
        },
      ],
    },
    "where-data-lives": {
      title: "Où vivent vos données",
      summary:
        "Séparez les fichiers locaux, la persistance cloud, les préférences du navigateur et les projections publiques.",
      sections: [
        {
          heading: "Frontière locale",
          paragraphs: [
            "Les screenshots et l’historique locaux restent sur cet ordinateur. Les préférences du navigateur telles que la vue, la langue, le thème et les réglages de livraison restent dans ce navigateur, sauf si une fonction connectée les synchronise explicitement.",
          ],
        },
        {
          heading: "Frontière cloud",
          paragraphs: [
            "Les enregistrements de compte cloud, les métadonnées de capture et les images sont stockés dans le service hébergé. Stripe traite la facturation, et le service d’e-mail envoie les codes de connexion. La page Sous-traitants est la liste actuelle des rôles de services externes.",
          ],
        },
        {
          heading: "Déplacer vos données entre l’application locale et Pinar Cloud",
          paragraphs: [
            "Paramètres → Données déplace les captures entre les deux magasins. Dans l’application locale, « Exporter les données » télécharge un .zip avec vos projets, collections, captures et screenshots. Dans Pinar Cloud, « Importer depuis l’app locale » reçoit ce fichier : choisissez-le avec « Choisir un fichier », suivez la progression par session et arrêtez à tout moment avec « Annuler l’importation ». Lorsque l’importation se termine, Pinar signale le résultat, y compris les importations partielles et les fichiers qui ne sont pas une exportation Pinar.",
          ],
          bullets: [
            "Reimporter la même exportation met à jour ce qui a déjà été importé au lieu de le dupliquer.",
            "Pour le comportement complet de l’export et de l’import, y compris l’endroit où les sessions exportées atterrissent dans le compte cloud, consultez [déplacer les données locales vers Pinar Cloud](https://github.com/djalmajr/pinar/blob/main/README.md#move-local-data-to-pinar-cloud) dans le README Pinar.",
          ],
        },
        {
          heading: "Confirmer quel magasin détient réellement chaque capture",
          paragraphs: [
            "Les screenshots locaux sont stockés comme fichiers PNG, et l’historique de session reste sur cet ordinateur. Le thème est une préférence uniquement navigateur dans l’onglet Interface. La langue et les interrupteurs de livraison Capture vivent dans la même boîte de dialogue de paramètres ; un compte cloud connecté peut conserver ces choix de livraison dans le workspace hébergé.",
            "Les captures hébergées conservent les métadonnées et les images dans le service cloud. Les visualiseurs non listés et les copies Markdown sont disponibles sans session de workspace. Les codes de connexion par e-mail expirent, et le formulaire ne révèle pas si un compte existe. La page Sous-traitants nomme les fournisseurs hébergés actuels, et Pinar ne reçoit pas les détails complets de carte. Les versions de politique en vigueur sont publiées sur les pages juridiques.",
          ],
          bullets: [
            "Si l’historique local ne peut pas s’ouvrir, Pinar récupère un catalogue utilisable sur cet ordinateur au lieu de planter.",
            "Ouvrez un screenshot hébergé depuis sa page de partage ou son visualiseur Markdown ; une image manquante affiche introuvable plutôt que des détails de compte.",
            "Dans les paramètres, confirmez le thème Interface localement, puis distinguez les interrupteurs de livraison Capture des choix de livraison synchronisés dans le cloud lorsque vous êtes connecté.",
          ],
        },
      ],
    },
    "automatic-sanitization": {
      title: "Sanitization automatique",
      summary:
        "Voyez quelles données d’URL, de DOM, d’identifiants et d’images inline Pinar retire avant le handoff ou le stockage.",
      sections: [
        {
          heading: "Champs sensibles et URL",
          paragraphs: [
            "Pinar rédige les champs password, payment, token et OTP ; retire les fragments d’URL ; et enlève les clés de requête sensibles connues telles que access_token, api_key, auth, password, secret, token et jwt. Vous pouvez ajouter d’autres noms de clés de requête dans les paramètres de l’extension.",
          ],
        },
        {
          heading: "Handoff structuré",
          paragraphs: [
            "L’analyseur visual-context accepte les versions de schéma prises en charge et rédige les erreurs d’analyse internes plutôt que d’exposer des secrets bruts. Les données de screenshot inline sont retirées des handoffs textuels ; le paquet utilise à la place une référence de chemin ou d’URL bornée.",
          ],
        },
        {
          heading:
            "Observer le rapport de rédaction et les images inline abandonnées",
          paragraphs: [
            "Pinar rédige les champs password, payment, token et code à usage unique, puis nettoie l’URL de la page. Les valeurs de requête qui ressemblent à des secrets connus sont remplacées par [redacted]. Les noms supplémentaires que vous ajoutez dans les paramètres sont inclus. Les sous-chaînes correspondantes sont aussi retirées du titre, de la description, de l’URL et des pins.",
            "Le bloc visual-context copié conserve `captureId` même si le reste de la charge utile ne peut pas être analysé. Les octets de screenshot inline sont retirés du paquet texte afin que la copie conserve un chemin de fichier ou une URL de visualiseur. Si certaines régions n’ont pas pu être inspectées, le collage inclut un avertissement de confidentialité.",
          ],
          bullets: [
            "Après une copie, lisez les avertissements de confidentialité dans le collage ; certaines régions peuvent être marquées comme non inspectées.",
            "Ajoutez des noms de clés de requête supplémentaires comme jetons séparés par des virgules, des espaces ou des points-virgules ; la correspondance est insensible à la casse.",
            "Si le JSON de handoff collé contient encore une URL de screenshot data:, recapturez afin que le paquet texte conserve un chemin ou une URL de visualiseur.",
          ],
        },
      ],
    },
    "local-security-and-recovery": {
      title: "Sécurité locale et récupération",
      summary:
        "Comprenez les jetons de capacité, les origines de confiance, les migrations locales et la récupération de démarrage sûre.",
      sections: [
        {
          heading: "Confiance de l’API locale",
          paragraphs: [
            "L’API locale accepte le loopback et l’origine d’extension publiée, puis vérifie un secret de capacité stocké avec des permissions de fichier restrictives. La rotation de jeton conserve le secret précédent valable 24 heures afin que les processus actifs puissent adopter la nouvelle valeur ; la révocation retire le fichier et force une réautorisation.",
          ],
        },
        {
          heading: "Récupération sûre",
          paragraphs: [
            "Un verrou PID de barre de menus périmé est remplacé, tandis qu’une instance live reste intacte. Arrêter et redémarrer utilisent d’abord le chemin gracieux du helper ; sur macOS, un écouteur coincé n’est terminé qu’après qu’il reste réactif au-delà de l’attente. Un JSON d’historique de repli corrompu se réinitialise à un schéma vide avec Personal et Inbox protégés. Les screenshots hérités sous un chemin shots/shots imbriqué sont migrés sans écraser les conflits de noms.",
          ],
        },
        {
          heading:
            "Présenter le secret de capacité et récupérer un magasin local cassé",
          paragraphs: [
            "Le workspace local n’accepte que l’application Pinar et l’extension officielle. La rotation conserve le secret précédent valable assez longtemps pour que les processus en cours rattrapent ; la révocation force une nouvelle autorisation.",
            "Si une autre instance Pinar est déjà en cours d’exécution, cette instance reste en place. Les dossiers de screenshots imbriqués sont migrés sans écraser les conflits de noms. Si l’historique local ne peut pas s’ouvrir, Pinar récupère un projet Personal et une Inbox utilisables au lieu de planter.",
          ],
          bullets: [
            "Continuez à utiliser l’extension officielle et l’application Pinar ; d’autres sites ne peuvent pas parler au workspace local.",
            "Après avoir révoqué l’accès local, redémarrez Pinar afin que le workspace puisse s’autoriser à nouveau.",
            "Si l’historique local ne peut pas s’ouvrir, attendez un projet Personal et une Inbox récupérés plutôt qu’un plantage.",
          ],
        },
      ],
    },
    "telemetry-and-policies": {
      title: "Télémétrie, consentement et politiques",
      summary:
        "Sachez ce qui est optionnel, quelles politiques conditionnent l’usage cloud, et ce que Fair Source signifie ici.",
      sections: [
        {
          heading: "Métriques de boucle fermée",
          paragraphs: [
            "Les métriques de boucle sont désactivées sauf si vous y adhérez. Lorsqu’elles sont désactivées, les envois sont jetés. Lorsqu’elles sont activées, le filtre autorise les événements opérationnels, la durée, l’agent et la confiance de relocalisation, mais rejette les commentaires, titres, URL, chemins DOM, sélecteurs, screenshots, balisage et contenu brut.",
          ],
        },
        {
          heading: "Consentement et licence",
          paragraphs: [
            "La persistance distante et le checkout enregistrent l’acceptation des Conditions, de la Politique de confidentialité et de la Politique d’utilisation acceptable courantes. La rétention, les remboursements, Fair Source et les sous-traitants ont des documents publiés distincts. Pinar est Fair Source / source disponible sous la licence du dépôt, pas Open Source approuvé OSI dans les versions actuelles.",
          ],
        },
        {
          heading:
            "Vérifier les charges d’adhésion et l’ensemble de politiques publié",
          paragraphs: [
            "Les métriques de boucle restent désactivées sauf si vous y adhérez. Lorsqu’elles sont activées, seuls les événements opérationnels sont envoyés. Les commentaires, titres, URL, sélecteurs, screenshots et contenus similaires sont rejetés.",
            "Le checkout et l’enregistrement Free distant consignent les versions de politique acceptées. Les Conditions, la Confidentialité, l’Utilisation acceptable, la Rétention, les Remboursements, Fair Source et les Sous-traitants sont publiés à https://pinar.dev/legal/. Un usage uniquement local qui ne contacte jamais le service hébergé n’a pas besoin de compte hébergé. Les questions vont à contact@pinar.dev ou contato@pinar.dev.",
          ],
          bullets: [
            "Laissez les métriques de boucle désactivées sauf si vous visez à y adhérer ; un réglage désactivé ne transmet pas de lot.",
            "Avant la persistance hébergée ou le checkout, ouvrez Conditions, Confidentialité et Utilisation acceptable depuis https://pinar.dev/legal/terms, /privacy et /acceptable-use.",
            "Traitez la licence publiée comme déterminante pour les limites Fair Source ; les sous-traitants hébergés actuellement nommés sont Cloudflare et Stripe.",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
