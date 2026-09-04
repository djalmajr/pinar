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
    "sign-in-extension": {
      alt: "Écran de connexion Pinar avec le flux de code d’association de l’extension de navigateur sélectionné.",
      caption:
        "Le flux de l’extension accepte le code d’association temporaire affiché par Pinar et connecte ce navigateur sans mot de passe.",
    },
    "capture-workspace": {
      alt: "Workspace Pinar avec des cartes de sessions annotées, des compteurs de pins, des projets, des collections, la recherche et les contrôles de compte.",
      caption:
        "Le workspace rassemble les pages capturées, les compteurs de pins, les projets, les collections, la recherche et l’état du compte dans une vue opérationnelle.",
    },
    "capture-toolbar": {
      alt: "Overlay de capture Pinar avec la barre supérieure, des pins numérotés, une région sélectionnée et un masque de confidentialité sur la page.",
      caption:
        "La barre de l’overlay reste sur la page avec les raccourcis pin, sélection, copier, masquer, région et annuler pendant l’annotation.",
    },
    "capture-review": {
      alt: "Overlay Pinar en relecture d’une session enregistrée, avec un pin en attente qui demande un placement manuel sur la page active.",
      caption:
        "Réviser sur la page replace les pins sur l’URL d’origine. Les pins non résolus restent en attente jusqu’à un clic sur le marqueur, puis sur l’élément correct.",
    },
    "capture-copy-failed": {
      alt: "Barre d’overlay Pinar indiquant Échec de la copie, avec les pins numérotés encore modifiables sur la page.",
      caption:
        "Quand tous les chemins du presse-papiers échouent, la barre affiche Échec de la copie et restaure les pins pour réessayer sans perdre les commentaires.",
    },
    "capture-full-page": {
      alt: "Overlay Pinar sur un long document qui continue sous le premier viewport, prêt pour une capture pleine page assemblée.",
      caption:
        "La capture pleine page fait défiler et assemble le document pour que le screenshot copié inclue le contenu sous la ligne de flottaison.",
    },
    "capture-viewer": {
      alt: "Visionneuse de capture Pinar avec le screenshot annoté, des pins numérotés, les contrôles de zoom et les actions de session.",
      caption:
        "La visionneuse rassemble le screenshot partagé, les commentaires des pins et les actions copier ou réouvrir après la capture.",
    },
    "extension-options": {
      alt: "Options de l’extension Pinar sur l’onglet Stockage, avec Serveur Local, Serveur Distant et l’acceptation juridique du service hébergé.",
      caption:
        "L’onglet Stockage choisit un serveur local ou distant et exige d’accepter Conditions, Confidentialité et Utilisation acceptable avant la capture cloud.",
    },
    "extension-preferences": {
      alt: "Options de l’extension Pinar sur l’onglet Préférences, avec le détail compact ou complet de la copie IA et l’interrupteur d’inclusion de screenshot.",
      caption:
        "Préférences définit la livraison compacte ou complète et si la copie suivante inclut un screenshot ; Enregistrer écrit ces choix avant la copie suivante.",
    },
    "help-navigation": {
      alt: "Article d’aide Pinar avec navigation par catégorie, liens d’articles liés, sections structurées et navigation dans la page.",
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
      alt: "Page tarifaire Pinar comparant Free, Pro annuel, Founder, les options de stockage et les crédits IA.",
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
      alt: "Barre d’overlay Pinar indiquant Copié avec succès après l’arrivée du paquet annoté dans le presse-papiers.",
      caption:
        "Une copie réussie affiche Copié avec succès puis ferme l’overlay pour coller le même paquet dans un agent.",
    },
    "install-pinar": {
      alt: "Onglet Stockage de l’extension Pinar avec le bouton Télécharger Pinar à côté de l’option Serveur Local.",
      caption:
        "L’onglet Stockage propose le téléchargement de l’application Pinar à côté de Serveur Local pour démarrer l’assistant sur cet ordinateur.",
    },
    "options-local": {
      alt: "Onglet Stockage de l’extension Pinar avec Serveur Local sélectionné et les captures restant sur cet ordinateur.",
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
      alt: "Onglet Préférences de l’extension Pinar montrant les métriques de cycle facultatives et les clés d’URL supplémentaires à masquer.",
      caption:
        "Les préférences de confidentialité ajoutent des clés de requête extra retirées des URL capturées et gardent les métriques de cycle désactivées jusqu’à l’opt-in.",
    },
    "pricing-credits": {
      alt: "Carte d’option tarifaire Pinar pour 1 000 crédits IA, avec achat et validité de douze mois.",
      caption:
        "Les crédits IA sont vendus en option avec une validité de douze mois, séparés du stockage du plan et de la cadence de facturation.",
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
      ],
    },
    "first-capture": {
      title: "Faire votre première capture",
      summary:
        "Épinglez un élément ou une zone visible, rédigez le feedback et copiez un seul paquet corrélé.",
      sections: [
        {
          heading: "Épingler la page",
          paragraphs: [
            "Ouvrez la page, sélectionnez l’extension Pinar, puis cliquez un élément ou faites glisser une zone libre. Rédigez le commentaire et appuyez sur `Enter` pour ajouter le pin.",
          ],
          bullets: [
            "Répétez la sélection pour placer plusieurs pins numérotés dans une même capture.",
            "`Shift+Enter` ajoute un saut de ligne ; `Escape` ferme le brouillon sans supprimer les autres pins.",
          ],
        },
        {
          heading: "Copier le paquet",
          paragraphs: [
            "Appuyez sur `Command+Enter` sur macOS ou `Ctrl+Enter` ailleurs. Pinar copie du Markdown lisible, du HTML et un bloc JSON pinar-visual-context qui se réfèrent au même screenshot et aux mêmes identités de pins.",
          ],
        },
        {
          heading: "Terminer la copie et conserver les identités",
          paragraphs: [
            "`Command/Ctrl+Enter` ne copie qu’après qu’au moins un pin a un commentaire. L’overlay affiche « Enregistrement des annotations… », masque les pins pour le screenshot, puis « Copié avec succès ! », et la barre d’outils se ferme. Un clic ultérieur sur l’icône de l’extension n’affiche ou ne masque que l’overlay ; il ne supprime pas les pins déjà posés. Si tous les chemins du presse-papiers échouent, l’overlay est restauré pour que vous puissiez réessayer.",
            "Traitez le contenu du presse-papiers comme une unité : des instructions lisibles, une URL de visualiseur optionnelle, et un bloc JSON pinar-visual-context délimité avec `captureId`, `pinId`, URL de page, localisateurs (cssSelector, domPath, innerText), et une URL de screenshot lorsque le helper a stocké un fichier. Les badges numérotés sur l’image sont des overlays d’annotation, pas l’UI de la page. Ne réécrivez pas `captureId` ni `pinId` en collant vers un agent. Une ligne Screenshot: /path/to/file.png, lorsqu’elle est présente, est le recadrage unique qui contient tous les pins.",
          ],
          bullets: [
            "Un composer vide ou une capture sans pins interrompt la copie et affiche brièvement « Écrivez un commentaire » ou « Ajoutez une épingle ».",
            "Les copies dégradées collent encore les commentaires et les localisateurs, mais la barre d’outils peut ajouter « pas de capture », « assistant indisponible » ou « pas de visionneuse » après « Copié avec succès ! ».",
            "Préférez un Pinar local en cours d’exécution pour que la copie puisse inclure un screenshot et un lien de visualiseur pour le contexte complet.",
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
            "Le mode cloud active l’accès distant au workspace, la rétention gérée, les résumés IA, la facturation et les liens de partage non listés. Vous acceptez les politiques en vigueur avant que quoi que ce soit ne soit stocké à distance.",
          ],
        },
        {
          heading: "Comment les sessions locales et cloud s’ouvrent réellement",
          paragraphs: [
            "L’historique local commence avec un projet protégé « Personal » et une collection « Inbox », que vous ne pouvez pas imbriquer ni supprimer comme des dossiers ordinaires. Les captures restent sur cet ordinateur, et vous pouvez les ouvrir depuis le workspace local.",
            "Le stockage cloud attend que vous acceptiez les « Conditions », la « Confidentialité » et l’« Utilisation acceptable » en vigueur. Ensuite, les comptes « Free » peuvent associer l’extension avec un code à courte durée de vie, et les comptes payants peuvent aussi confirmer un code e-mail à six chiffres. Les liens de partage restent lisibles par quiconque possède l’URL non listée.",
          ],
          bullets: [
            "Le workspace local reste sur cet ordinateur et n’a pas besoin de compte cloud.",
            "Si l’historique local ne peut pas ouvrir son magasin habituel, Pinar récupère un catalogue utilisable au lieu de planter.",
            "Les liens de partage cloud n’exigent pas de session de workspace : quiconque a l’URL non listée peut lire le Markdown ou l’image.",
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
            "`Command/Ctrl+Enter` copie le paquet terminé.",
            "`Alt+Shift+P` affiche ou masque la barre d’outils sans annuler la session, et vous pouvez le réattribuer dans `chrome://extensions/shortcuts`. Les raccourcis du navigateur restent inertes sur les pages `chrome://`, sur le Chrome Web Store et avant l’injection de l’overlay.",
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
            "`Command/Ctrl+Enter` enregistre un brouillon ouvert, puis copie ; sans commentaire, il affiche « Écrivez un commentaire » au lieu d’envoyer un pin vide.",
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
        "Comprenez comment un pin suit un élément après un changement de page et pourquoi Pinar peut demander un placement manuel.",
      sections: [
        {
          heading: "Empreintes résilientes",
          paragraphs: [
            "Un pin d’élément combine un sélecteur stable, un chemin DOM, une balise, un id, un name, un test id, un role, des classes, du texte, un label et la géométrie. À la réouverture, Pinar évalue le sélecteur, la structure, la sémantique et la géométrie, plutôt que de se fier à un chemin fragile unique.",
          ],
        },
        {
          heading: "Confiance et ambiguïté",
          paragraphs: [
            "Une correspondance peut être exacte, probable, ambiguë ou non résolue. Lorsque deux candidats sont trop similaires, Pinar conserve des alternatives au lieu d’accrocher le pin au mauvais élément. Les cibles d’iframe cross-origin peuvent rester non résolues.",
          ],
        },
        {
          heading: "Repli de sélecteur et correspondances concurrentes",
          paragraphs: [
            "Au moment de la capture, Pinar préfère un sélecteur qui correspond de façon unique au nœud par id, data-testid ou data-test, ou tag plus name. Si aucun n’est unique, il stocke à la place un chemin CSS structurel. Les noms de classe qui semblent générés sont retirés de l’empreinte afin que les modules CSS hachés ne deviennent pas le seul signal.",
            "À la réouverture, les candidats des stratégies stable-selector, structure, semantic et geometry sont fusionnés et classés. Une confiance exacte exige un sélecteur stable ou un hit de structure à score élevé ; les correspondances sémantiques et géométriques restent probables. Lorsque les deux meilleurs scores viables diffèrent de moins d’une marge étroite, le résultat est ambigu et aucun élément n’est choisi.",
          ],
          bullets: [
            "Un sélecteur positionnel :nth-of-type est moins bien noté lorsque d’autres nœuds partagent la même balise, le même texte et les mêmes classes.",
            "Les pins de zone sont rejetés comme cibles d’élément et restent non résolus pendant le scoring du localisateur.",
            "Lorsqu’un iframe contentDocument est illisible, la relocalisation s’arrête avec un avertissement cross-origin-frame au lieu de deviner.",
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
    "copy-and-reopen": {
      title: "Copier, voir et rouvrir une capture",
      summary:
        "Passez de la page live au workspace et revenez sans perdre les ancres d’origine.",
      sections: [
        {
          heading: "Contrôles du visualiseur",
          paragraphs: [
            "Le visualiseur de capture prend en charge le panoramique au pointeur, le zoom à la molette ancré sur le curseur, le zoom par double-clic, et des contrôles de 50 % à 800 %. Sélectionner un pin ouvre les onglets Preview rendu et Markdown Raw verbatim.",
          ],
          bullets: [
            "Téléchargez le screenshot ou copiez le Markdown de la session depuis le visualiseur.",
            "Ouvrez le Markdown public dans ChatGPT ou Claude depuis le menu d’actions du visualiseur lorsque le partage est disponible.",
          ],
        },
        {
          heading: "Revoir sur la page d’origine",
          paragraphs: [
            "« Revoir sur la page » ouvre l’origine capturée et réhydrate les pins. Pinar rejette une divergence d’origine, préserve chaque ancre et boîte historiques, enregistre l’historique de relocalisation, et vous laisse repositionner manuellement un pin non résolu.",
          ],
        },
        {
          heading:
            "Presse-papiers depuis le visualiseur et filtrage de réouverture",
          paragraphs: [
            "Copier la page dans le visualiseur écrit le même paquet Markdown corrélé utilisé sur la page live, en utilisant le handoff compact ou full des préférences enregistrées, et `captureId` se rabattant sur l’id de session. Le menu d’actions ouvre le Markdown public à /v/{id}.md, ou lance ChatGPT ou Claude avec un prompt qui pointe vers cette URL.",
            "« Revoir sur la page » envoie un événement de réouverture avec l’id de session. Le helper n’hydrate que depuis une URL de l’application Pinar de confiance lorsque cet id correspond à l’id de session ou au `captureId` et que l’origine de l’onglet égale encore l’origine de la page capturée. Naviguer l’onglet hors de cette origine rompt le lien au lieu d’injecter des pins sur le mauvais site.",
          ],
          bullets: [
            "Si aucun résultat de réouverture n’arrive, le visualiseur affiche un indice de helper manquant au lieu d’attendre indéfiniment.",
            "Les visualiseurs publics ou plus anciens qui ne peuvent pas lire les préférences copient encore en handoff compact.",
            "Un onglet encore en about:blank conserve le lien d’hydratation ; seule une origine différente le rompt.",
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
            "L’extension Chrome ne tape jamais dans le composer de l’agent. Après `Command/Ctrl+Enter`, collez vous-même le presse-papiers dans Cursor, Claude, Codex ou Grok. Le texte commence en indiquant que les notes des pins peuvent demander un changement ou une explication, et à traiter sélecteur et chemin DOM comme des localisateurs complémentaires, suivies d’un bloc JSON pinar-visual-context délimité. Si une URL Viewer est incluse, ne la récupérez que lorsque ces détails ne suffisent pas.",
            "Traitez `captureId` et `pinId` comme des identités, pas des libellés à réécrire. Visual Context encode actuellement schemaVersion 1 ; parseVisualCapture rejette un `captureId` manquant et tout schemaVersion autre que 1 ou l’héritage 0. Suivez seulement ce que les pins décrivent. Si la personne n’a jamais collé, demandez-lui de copier à nouveau depuis Pinar plutôt que de reconstruire les pins de mémoire.",
          ],
          bullets: [
            "Collez tout le presse-papiers dans l’agent ; ne retapez pas les commentaires et n’inventez pas un nouveau `captureId`.",
            "Confirmez que le texte collé contient encore une clôture pinar-visual-context fermée avant de commencer à modifier le code.",
            "Si rien n’a été collé, demandez `Command/Ctrl+Enter` dans Pinar et suivez seulement les notes des pins.",
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
    "reopen-and-relocate": {
      title: "Rouvrir et relocaliser les pins",
      summary:
        "Relisez l’implémentation sur la page live même après que son DOM a changé.",
      sections: [
        {
          heading: "Réhydratation sûre",
          paragraphs: [
            "Pinar ouvre la page enregistrée et n’hydrate que lorsque l’origine de l’onglet actif correspond exactement à la capture. Les origines d’app de confiance peuvent demander une réouverture, mais un site non lié ne peut pas injecter une session dans l’extension.",
          ],
        },
        {
          heading: "Correction manuelle",
          paragraphs: [
            "Si une cible est ambiguë ou non résolue, repositionnez le pin manuellement. L’ancre et la boîte d’origine restent figées dans l’historique, et chaque relocalisation automatisée ou manuelle est enregistrée pour une relecture ultérieure.",
          ],
        },
        {
          heading: "Ouvrir l’URL d’origine et placer les pins en attente",
          paragraphs: [
            "« Revoir sur la page » ne s’ouvre que depuis l’application Pinar, sur l’URL de capture d’origine. Un autre site ne peut pas injecter une session enregistrée dans l’extension. Après le chargement, chaque cadre n’affiche que les pins qui lui appartiennent.",
            "L’overlay reste lié seulement tant que l’onglet est encore le site capturé. Naviguer ailleurs affiche « Cette page n’est pas l’URL de capture d’origine ». Les correspondances ambiguës conservent la boîte d’origine au lieu de s’accrocher à un sosie. Cliquez un pin en attente, puis l’élément correct, pour le placer.",
          ],
          bullets: [
            "Lancez « Revoir sur la page » depuis l’application Pinar afin que seule cette session s’hydrate sur l’origine capturée.",
            "Si l’overlay indique « Cette page n’est pas l’URL de capture d’origine », revenez à l’origine capturée au lieu de placer des pins.",
            "Pour un pin non résolu, cliquez le marqueur, puis cliquez l’élément live pour le placer.",
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
            "La copie exige un commentaire enregistré et au moins un pin. La barre d’outils affiche « Enregistrement des annotations… », masque les overlays, capture le cliché, puis demande au document offscreen d’écrire text/html et text/plain. Offscreen essaie d’abord navigator.clipboard.write puis se rabat sur un événement copy plus execCommand. Si cette écriture n’est pas ok, le content script tente encore writePlainText sur la charge plain renvoyée : clipboard.writeText, puis une sélection textarea cachée.",
            "Lorsque tous les chemins de copie échouent, la page envoie overlays:hidden avec hidden false, affiche brièvement « Échec de la copie », et laisse les pins modifiables. Une copie réussie affiche « Copié avec succès ! », ou « Copié avec succès ! » plus « pas de capture », « assistant indisponible » ou « pas de visionneuse », puis termine la session. Ces suffixes correspondent à `screenshot_missing`, `helper_unavailable` et `viewer_unavailable`. screenshot_inline n’est pas l’un des avertissements de handoff dégradé. Un collage sans clôture pinar-visual-context fermée ne peut pas être analysé comme JSON.",
          ],
          bullets: [
            "Si la barre d’outils indique « Écrivez un commentaire » ou « Ajoutez une épingle », terminez ce pin et appuyez à nouveau sur `Command/Ctrl+Enter`.",
            "Si « Échec de la copie » apparaît, confirmez que les pins sont encore sur la page, accordez la permission du presse-papiers si elle est demandée, et réessayez la copie.",
            "Lisez le suffixe « Copié avec succès ! » : « pas de capture », « assistant indisponible » et « pas de visionneuse » nomment la couche manquante à réessayer sans jeter les commentaires.",
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
          heading: "Deux flux de code",
          paragraphs: [
            "Les installations Free distantes peuvent ouvrir l’app web avec un code d’extension à usage unique de cinq minutes. Créer un nouveau code de huit caractères invalide le précédent encore actif ; la génération autorise 10 demandes par cinq minutes par IP et compte, et l’échange autorise 20 tentatives par cinq minutes par IP. Les comptes payants et précédemment payants peuvent aussi demander un code e-mail à six chiffres ; il expire après dix minutes et se verrouille après cinq tentatives invalides.",
          ],
        },
        {
          heading: "Sessions",
          paragraphs: [
            "Les sessions web durent 30 jours et les appareils d’extension authentifiés durent 180 jours. Les codes expirent pour des raisons de sécurité.",
          ],
        },
        {
          heading:
            "Terminer l’association depuis l’onglet Compte de l’extension",
          paragraphs: [
            "Sur une installation Free distante, ouvrez l’onglet Compte des options de l’extension, générez-y le code temporaire, puis copiez-le. Ouvrez la page de connexion hébergée depuis ce même onglet afin qu’un échange réussi atterrisse dans le workspace web. Régénérer demande d’abord une confirmation parce que les codes inutilisés de ce compte sont remplacés. Collez le code sur pinar.dev plutôt que sur une page de workspace local.",
            "Demander un code e-mail a toujours la même apparence, y compris pour des adresses inconnues, afin que le formulaire ne révèle pas si un compte existe. Un véritable message à six chiffres n’est envoyé qu’à un compte payant éligible. Se déconnecter dans l’onglet Compte termine les sessions web et d’extension courantes.",
          ],
          bullets: [
            "Si aucun e-mail n’arrive, attendez avant de réessayer ; les codes expirent, et trop de tentatives sont retardées.",
            "Confirmez la boîte de régénération avant d’invalider un code que vous comptez encore saisir sur la page de connexion hébergée.",
            "Utilisez Se déconnecter dans l’onglet Compte lorsque vous devez terminer immédiatement la session web ou d’extension courante.",
          ],
        },
      ],
    },
    "plans-and-billing": {
      title: "Free, Pro, Founder et facturation",
      summary:
        "Comparez les droits produit, gérez un abonnement et traitez la page tarifs comme la source de prix actuelle.",
      sections: [
        {
          heading: "Forme des plans",
          paragraphs: [
            "Free inclut un usage local permanent, 250 Mo de quota cloud et une rétention cloud de sept jours. Pro est mensuel ou annuel avec 5 Go et 200 crédits IA non reportables rechargés chaque mois. Founder est une cohorte limitée unique avec 5 Go et 500 crédits initiaux ; il n’inclut pas de recharge mensuelle de crédits.",
          ],
        },
        {
          heading: "Facturation et disponibilité",
          paragraphs: [
            "Les prix régionaux BRL ou mondiaux USD, la disponibilité Founder et les offres actuelles appartiennent à la page Plans. Stripe Checkout réserve un créneau Founder pendant 15 minutes et le libère lorsque le paiement est abandonné. Le portail client Stripe gère les changements de plan, l’annulation, les moyens de paiement et les factures.",
          ],
        },
        {
          heading:
            "Lancer Checkout avec les politiques actuelles et la bonne devise",
          paragraphs: [
            "Le checkout ne démarre qu’après l’acceptation des Conditions, de la Politique de confidentialité et de l’Utilisation acceptable en vigueur. Le Brésil utilise les prix en BRL ; les autres pays utilisent l’USD. Le checkout Founder réserve un créneau limité et le libère si vous partez sans payer. Lorsque la cohorte est pleine ou que les ventes sont en pause, la page Plans masque cette offre.",
            "Après un paiement réussi, l’offre est accordée au compte connecté et vous revenez au workspace. Le portail de facturation est disponible après un checkout payant. Lorsqu’un abonnement Pro se termine, ces sessions cloud entrent dans une fenêtre de récupération ; les comptes Founder et lifetime hérités restent permanents à la place.",
          ],
          bullets: [
            "Acceptez les versions de politique courantes dans le flux Plans hébergé avant de payer.",
            "Si le checkout Founder est indisponible, attendez un créneau ou choisissez Pro plutôt que de réessayer le même checkout.",
            "Si Gérer l’abonnement est indisponible, terminez d’abord un Checkout payant, puis ouvrez-le depuis un compte connecté.",
          ],
        },
      ],
    },
    "ai-credits": {
      title: "Résumés IA et crédits",
      summary:
        "Sachez quand les crédits sont réservés, dépensés, rechargés ou remboursés.",
      sections: [
        {
          heading: "Coût du résumé",
          paragraphs: [
            "Un résumé de session réserve 100 crédits IA avant l’inférence du modèle. En cas de succès, la réservation est consommée. Une inférence échouée ou abandonnée la rembourse immédiatement ; une réservation laissée non soldée plus de cinq minutes est remboursée automatiquement. Les résumés autorisent 10 requêtes par minute par compte et 30 par minute par IP ; une requête en double pour la même session attend la fin de la requête active.",
          ],
        },
        {
          heading: "Soldes",
          paragraphs: [
            "Les packs achetés ajoutent 1 000 crédits. L’allocation mensuelle de 200 crédits de Pro ne se reporte pas. Les 500 crédits de Founder sont un solde d’activation, pas une allocation mensuelle. Le menu du compte affiche le solde actif et la prochaine date de recharge applicable.",
          ],
        },
        {
          heading:
            "Relancer les résumés avec un nouvel id de requête et lire le grand livre",
          paragraphs: [
            "Un résumé ne s’exécute que sur une session que vous possédez. Si un résumé est déjà en cours, attendez qu’il se termine au lieu d’en lancer un autre. Les résumés échoués ou abandonnés remboursent la réservation lorsque c’est possible. Si le solde est trop faible, le workspace affiche les crédits restants en direct.",
            "Les crédits mensuels inclus sont utilisés avant les packs achetés, et le solde qui expire le plus tôt est utilisé en premier. Un pack acheté de 1 000 crédits dure jusqu’à 12 mois. Le menu du compte affiche les crédits restants et la prochaine date de recharge pour les comptes Pro et Founder actifs. Les résumés utilisent la langue du workspace lorsqu’elle fait partie des sept langues prises en charge.",
          ],
          bullets: [
            "Si un résumé est déjà en cours sur cette session, attendez qu’il se termine au lieu d’en lancer un second.",
            "Si une réservation expire ou est remboursée, lancez un nouveau résumé plutôt que de réessayer la même requête.",
            "Si le workspace affiche zéro crédit, vérifiez les packs restants et la prochaine date de recharge avant d’acheter une autre offre de 1 000 crédits.",
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
            "Free a 250 Mo de stockage cloud de base ; Pro et Founder ont 5 Go. Les options de stockage optionnelles de 5 Go et 20 Go durent 12 mois, avec des e-mails de rappel sept jours et un jour avant l’expiration. Les envois de screenshots doivent être des fichiers PNG valides et passer un contrôle de quota atomique avant le stockage. Les envois s’interrompent lorsque les octets résultants dépassent le quota courant.",
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
            "Les sessions cloud Free qui ne sont pas marquées permanentes deviennent éligibles au nettoyage après sept jours. Le contenu Pro au-dessus du quota Free suit la grâce de 30 jours et la fenêtre de récupération de 90 jours après la fin de l’éligibilité payante. Le contenu Founder et lifetime hérité n’est pas rendu éligible simplement parce qu’il n’y a pas d’abonnement récurrent. L’historique uniquement local sur cet ordinateur n’est jamais supprimé à distance. L’éligibilité n’est pas une promesse de retrait immédiat.",
          ],
          bullets: [
            "Lorsque de nouvelles captures s’interrompent, libérez de l’espace en supprimant des sessions ou en remplaçant un screenshot lourd, ou achetez une option de douze mois de 5 Go ou 20 Go.",
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
            "Les visualiseurs cloud existent pour une session, un projet ou une collection. Ils sont publics pour quiconque a le lien et ne sont pas indexés comme une navigation normale. Ne traitez pas une URL non listée comme une authentification pour du contenu sensible.",
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
