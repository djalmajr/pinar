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
    "getting-started": {
      alt: "Page d’accueil publique de Pinar avec le flux local d’abord, l’entrée du workspace et la navigation des plans.",
      caption:
        "Partez de l’entrée publique Pinar pour ouvrir le workspace local, comprendre le flux de capture ou comparer les plans cloud.",
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
  },
  articles: {
    "install-pinar": {
      title: "Installer Pinar",
      summary:
        "Ajoutez l’extension Chrome officielle et connectez le produit local pris en charge pour votre plateforme.",
      sections: [
        {
          heading: "Extension de navigateur",
          paragraphs: [
            "Installez Pinar depuis le Chrome Web Store. C’est le chemin d’installation officiel du navigateur ; un checkout GitHub ou un dossier d’extension unpacked n’est pas nécessaire pour un usage normal.",
          ],
          bullets: [
            "Épinglez l’icône Pinar depuis le menu des extensions de Chrome pour qu’elle reste visible.",
            "L’extension prend en charge l’origine publiée pinar.dev et les serveurs Pinar locaux.",
          ],
        },
        {
          heading: "Produit local",
          paragraphs: [
            "Sur macOS, Pinar.app vit dans la barre de menus, exécute le helper intégré, enregistre les hooks d’agents pris en charge et consulte GitHub Releases pour les mises à jour. Windows et Linux utilisent actuellement l’installateur du helper autonome plutôt qu’une application de bureau.",
          ],
          bullets: [
            "Les screenshots se trouvent normalement dans `~/.pinar/shots` et l’historique dans `~/.pinar/history.db`. L’action Ouvrir le dossier de la barre de menus ouvre ce répertoire ; PINAR_HOME peut le remplacer.",
            "Le helper parcourt les ports 17373 à 17382 de 127.0.0.1 et reconnaît Pinar via GET `/api/health`. PINAR_PORT fige la découverte sur un seul port.",
            "Ouvrir à la connexion utilise un LaunchAgent utilisateur sur macOS. Pinar se rabat sur le chemin launchctl historique sur les systèmes plus anciens et conserve les journaux dans le répertoire d’accueil Pinar.",
            "Si le helper local est indisponible, les recadrages d’image se rabattent sur Downloads/pinar.",
          ],
        },
        {
          heading: "Confirmer le helper et ouvrir le workspace",
          paragraphs: [
            "Une fois l’extension épinglée, installez le produit local correspondant via le chemin documenté en une étape : glissez l’image disque macOS dans ~/Applications, exécutez l’installateur PowerShell sur Windows, ou l’installateur curl sur Linux. Ces scripts placent le helper dans ~/.pinar/bin (ou %USERPROFILE%\\.pinar\\bin), ajoutent ce répertoire au PATH et exécutent pinar install-hooks pour que les agents de code puissent recevoir les captures collées.",
            "Sur macOS, Pinar.app masque l’icône du Dock, conserve une instance unique de barre de menus via ~/.pinar/tray.pid et démarre le helper avec pinar ensure si GET `/api/health` ne renvoie pas encore ok true et service pinar. Utilisez le contrôle Démarrer ou Redémarrer de la barre de menus lorsque l’état est Off, puis Ouvrir le workspace pour charger http://127.0.0.1:<port>/app. Relancez pinar install-hooks depuis le helper si un agent ne voit plus les instructions de collage.",
          ],
          bullets: [
            "Installation Windows : irm https://pinar.dev/install.ps1 | iex. Installation Linux : curl -fsSL https://pinar.dev/install.sh | sh. Le script a besoin de curl ou wget pour télécharger le binaire.",
            "Un helper sain répond à GET `/api/health` avec ok true et service pinar. Sur macOS, Ouvrir le workspace utilise ce port découvert sur le chemin de workspace /app.",
            "L’extension Chrome ne peut pas écrire `~/.pinar/shots` toute seule. Si les recadrages manquent ce dossier, démarrez d’abord le produit local, puis recapturez.",
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
            "Ouvrez la page, sélectionnez l’extension Pinar, puis cliquez un élément ou faites glisser une zone libre. Rédigez le commentaire et appuyez sur Enter pour ajouter le pin.",
          ],
          bullets: [
            "Répétez la sélection pour placer plusieurs pins numérotés dans une même capture.",
            "Shift+Enter ajoute un saut de ligne ; Escape ferme le brouillon sans supprimer les autres pins.",
          ],
        },
        {
          heading: "Copier le paquet",
          paragraphs: [
            "Appuyez sur Command+Enter sur macOS ou Ctrl+Enter ailleurs. Pinar copie du Markdown lisible, du HTML et un bloc JSON pinar-visual-context qui se réfèrent au même screenshot et aux mêmes identités de pins.",
          ],
        },
        {
          heading: "Terminer la copie et conserver les identités",
          paragraphs: [
            "Command/Ctrl+Enter ne copie qu’après qu’au moins un pin a un commentaire. L’overlay affiche Copying…, masque le chrome des pins pour le screenshot, puis Copied, et la barre d’outils se ferme. Un clic ultérieur sur l’icône de l’extension n’affiche ou ne masque que l’overlay ; il ne supprime pas les pins déjà posés. Si tous les chemins du presse-papiers échouent, l’overlay est restauré pour que vous puissiez réessayer.",
            "Traitez le contenu du presse-papiers comme une unité : des instructions lisibles, une URL de visualiseur optionnelle, et un bloc JSON pinar-visual-context délimité avec `captureId`, `pinId`, URL de page, localisateurs (cssSelector, domPath, innerText), et une URL de screenshot lorsque le helper a stocké un fichier. Les badges numérotés sur l’image sont des overlays d’annotation, pas l’UI de la page. Ne réécrivez pas `captureId` ni `pinId` en collant vers un agent. Une ligne Screenshot: /path/to/file.png, lorsqu’elle est présente, est le recadrage unique qui contient tous les pins.",
          ],
          bullets: [
            "Un composer vide ou une capture sans pins interrompt la copie et affiche brièvement Write a comment first ou Add a pin first.",
            "Les copies dégradées collent encore les commentaires et les localisateurs, mais la barre d’outils peut ajouter no screenshot, helper unavailable ou no viewer après Copied.",
            "Préférez un helper en cours d’exécution pour que les recadrages PNG atterrissent dans `~/.pinar/shots` et que le paquet puisse inclure un lien de visualiseur /v/<id>.md pour le contexte complet.",
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
            "Le mode local conserve l’historique dans SQLite et les screenshots sur votre machine. L’API loopback n’accepte que des origines locales ou d’extension de confiance et utilise un jeton de capacité protégé par le système de fichiers.",
          ],
        },
        {
          heading: "Cloud",
          paragraphs: [
            "Le mode cloud stocke les données de compte dans D1 et les screenshots dans R2. Il active l’accès distant au workspace, la rétention gérée, les résumés IA, la facturation et les liens de partage non listés. Un consentement juridique est requis avant toute persistance distante.",
          ],
        },
        {
          heading: "Comment les sessions locales et cloud s’ouvrent réellement",
          paragraphs: [
            "L’historique local appartient toujours au owner local. À la première utilisation, la base crée un projet protégé Personal et une collection protégée Inbox, qui ne peuvent pas être imbriqués ni supprimés comme ceux créés par l’utilisateur. Les captures enregistrées sont marquées isPermanent true avec plan free, les fichiers PNG sont écrits dans le répertoire shots de l’accueil Pinar, et l’API loopback les présente à /shots/<id>.png et /v/<id>.md. Muter cette API exige le secret de capacité de ~/.pinar/local-capability.json, envoyé comme x-pinar-capability ou un jeton Authorization Bearer. Le fichier est écrit en mode 0600 ; la rotation conserve le secret précédent valable 24 heures, sauf si PINAR_CAPABILITY_GRACE_MS en dispose autrement.",
            "La persistance cloud est bloquée jusqu’à l’acceptation des versions courantes des Conditions, de la Confidentialité et de l’Utilisation acceptable ; l’API renvoie HTTP 428 avec le code legal_acceptance_required. Remote Free enregistre ensuite une installation et peut émettre un code d’association à usage unique de cinq minutes pour ouvrir /app. Les comptes payants ou précédemment payants peuvent aussi vérifier un code e-mail à six chiffres. Les cookies de navigateur durent 30 jours ; les appareils d’extension authentifiés durent 180 jours. Le Markdown non listé reste public à /v/, /p/ et /c/, et les screenshots à /shots/.",
          ],
          bullets: [
            "Le GET /api/local/capability local renvoie le jeton courant ; rotate et revoke sont des points de terminaison POST sur le même préfixe /api/local/capability.",
            "SQLite vit dans `history.db` du répertoire d’accueil Pinar ; si SQLite ne peut pas s’ouvrir, l’historique se rabat sur `history.json` dans le même accueil.",
            "Les liens de partage cloud n’exigent pas de session de workspace : quiconque a l’URL non listée peut lire le Markdown ou le PNG à /v/, /p/, /c/ ou /shots/.",
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
            "Enter épingle l’élément survolé ; Arrow Up sélectionne son parent et Arrow Down revient à un enfant.",
            "M bascule le dessin du masque de confidentialité. Escape annule un brouillon ou un masque ; sans brouillon, il efface les pins et masque la barre d’outils.",
            "Command/Ctrl+Enter copie le paquet terminé.",
            "Alt+Shift+P affiche ou masque la barre d’outils sans annuler la session, et vous pouvez le réattribuer dans `chrome://extensions/shortcuts`. Les raccourcis du navigateur restent inertes sur les pages `chrome://`, sur le Chrome Web Store et avant l’injection de l’overlay.",
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
            "Les raccourcis de capture ne sont détenus que pendant que l’overlay est actif. L’icône de l’extension bascule cet overlay ; elle ne supprime pas les pins. Survoler la barre d’outils sans brouillon ouvert la rend passante, afin que vous puissiez encore cliquer ou faire glisser la page en dessous. Shift+Enter insère un saut de ligne dans le composer, et les raccourcis de la page hôte tapés là sont empêchés de quitter le champ de commentaire.",
            "Arrow Up remonte à l’élément parent et mémorise l’enfant que vous quittez, de sorte qu’Arrow Down revient à ce nœud mémorisé s’il est encore un enfant ; sinon il utilise le premier enfant. En mode masque, faites glisser une région pour la cacher et cliquez un masque existant pour le restaurer. Le défilement clavier fonctionne encore sur le document, mais les touches destinées aux contrôles de page focalisés sont bloquées afin qu’elles ne puissent pas activer des boutons ni taper dans le formulaire hôte.",
          ],
          bullets: [
            "Command/Ctrl+Enter enregistre un brouillon ouvert, puis copie ; sans commentaire, il affiche Write a comment first au lieu d’envoyer un pin vide.",
            "Après Escape ou une copie, Pinar conserve la propriété de cette touche physique jusqu’au keyup, afin que la page hôte ne traite pas la même frappe comme sa propre annulation ou soumission.",
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
            "Cliquez un nœud, ou appuyez sur Enter sur le contour courant, pour ouvrir un pin d’élément. Faites glisser un rectangle d’au moins six pixels pour ouvrir un pin de zone à la place. Le premier appui sur un élément iframe ou frame est ignoré afin que le document à l’intérieur de ce cadre puisse prendre la sélection.",
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
            "Escape quitte le dessin de masque sans jeter les pins déjà placés sur la page.",
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
          heading: "Relire sur la page d’origine",
          paragraphs: [
            "Relire sur la page ouvre l’origine capturée et réhydrate les pins. Pinar rejette une divergence d’origine, préserve chaque ancre et boîte historiques, enregistre l’historique de relocalisation, et vous laisse repositionner manuellement un pin non résolu.",
          ],
        },
        {
          heading:
            "Presse-papiers depuis le visualiseur et filtrage de réouverture",
          paragraphs: [
            "Copier la page dans le visualiseur écrit le même paquet Markdown corrélé utilisé sur la page live, en utilisant le handoff compact ou full des préférences enregistrées, et `captureId` se rabattant sur l’id de session. Le menu d’actions ouvre le Markdown public à /v/{id}.md, ou lance ChatGPT ou Claude avec un prompt qui pointe vers cette URL.",
            "Relire sur la page envoie un événement de réouverture avec l’id de session. Le helper n’hydrate que depuis une URL d’app Pinar de confiance lorsque cet id correspond à l’id de session ou au `captureId` et que l’origine de l’onglet égale encore l’origine de la page capturée. Naviguer l’onglet hors de cette origine rompt le lien au lieu d’injecter des pins sur le mauvais site.",
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
            "L’extension Chrome ne tape jamais dans le composer de l’agent. Après Command/Ctrl+Enter, collez vous-même le presse-papiers dans Cursor, Claude, Codex ou Grok. Le texte commence par des instructions pour implémenter les commentaires des pins et traiter selector et chemin DOM comme des localisateurs complémentaires, suivies d’un bloc JSON pinar-visual-context délimité. Si une URL Viewer est incluse, ne la récupérez que lorsque ces détails ne suffisent pas.",
            "Traitez `captureId` et `pinId` comme des identités, pas des libellés à réécrire. Visual Context encode actuellement schemaVersion 1 ; parseVisualCapture rejette un `captureId` manquant et tout schemaVersion autre que 1 ou l’héritage 0. Ne changez que ce que les pins décrivent. Si la personne n’a jamais collé, demandez-lui de copier à nouveau depuis Pinar plutôt que de reconstruire les pins de mémoire.",
          ],
          bullets: [
            "Collez tout le presse-papiers dans l’agent ; ne retapez pas les commentaires et n’inventez pas un nouveau `captureId`.",
            "Confirmez que le texte collé contient encore une clôture pinar-visual-context fermée avant de commencer à modifier le code.",
            "Si rien n’a été collé, demandez Command/Ctrl+Enter dans Pinar et n’implémentez que les commentaires des pins.",
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
            "POST /api/agent-executions avec agent égal à claude, codex, cursor ou grok, le `captureId` de la capture, un idempotencyKey de 8 à 128 caractères correspondant à [A-Za-z0-9_-], et un tableau results non vide. Chaque résultat a besoin d’un `pinId` qui existe déjà sur cette capture, d’un status et d’un summary d’au plus 2000 caractères ; les files optionnels sont limités à 50 chemins, et pullRequest doit être une URL http(s). Une empreinte conflictuelle sous la même clé est idempotency_conflict (409). Un `pinId` inconnu est pin_not_found (400) sans renvoyer les commentaires de la capture ; un `captureId` inconnu est capture_not_found (404).",
            "La relecture humaine est un POST distinct vers /api/sessions/{id}/pins/{`pinId`}/review avec action accept ou reopen. humanActionsForStatus n’offre accept que dans correction_ready et reopen que dans accepted ; open et reopened n’exposent aucune action humaine, et toute autre transition est invalid_transition (409). Après un reopen humain, une seconde exécution changed est la nouvelle tentative prévue. Laissez Share anonymous loop metrics désactivé sauf si vous y adhérez : commentaires, URL, sélecteurs et screenshots sont rejetés comme forbidden_fields même lorsque optIn est true.",
          ],
          bullets: [
            "Publiez un résultat changed pour le même `captureId` et `pinId`, puis confirmez que le visualiseur affiche correction_ready avant d’accepter.",
            "Réutilisez un idempotencyKey uniquement avec la même empreinte ; créez une nouvelle clé lorsque les fichiers, le résumé ou le status ont réellement changé.",
            "Si la vérification échoue, rouvrez en tant qu’humain, publiez un second résultat, acceptez à nouveau, et conservez les capture ids avant et après.",
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
            "session:reopen n’est accepté que depuis une origine d’app Pinar de confiance : https sur pinar.dev ou un hôte *.pinar.dev, ou http sur les ports loopback 17373 à 17382. Le helper récupère /api/sessions/{id} et ouvre un nouvel onglet à l’URL de page enregistrée. Tout autre site reçoit untrusted_app. Un id demandé qui ne correspond ni à session.id ni à `captureId` est session_mismatch ; une capture sans page.url est missing_page. Après le chargement, l’hydratation s’injecte dans chaque cadre et ne conserve que les pins dont le chemin DOM appartient à ce cadre.",
            "L’hydratation continue seulement tant que l’origine de l’onglet correspond encore à la capture. Naviguer ailleurs rompt le lien et affiche This page is not the original capture URL ; about:blank est traité comme transitoire et ne le rompt pas. Les correspondances de localisateur ambiguës ou non résolues laissent la boîte live inchangée au lieu de s’accrocher à un sosie. Cliquez un pin en attente, puis l’élément correct : sélecteur, chemin et empreinte restent figés, location devient exact avec evidence manual-reposition, et locationHistory ajoute une entrée exacte manuelle.",
          ],
          bullets: [
            "Lancez Relire sur la page depuis l’app Pinar afin que seule cette session s’hydrate sur l’origine capturée.",
            "Si l’overlay indique This page is not the original capture URL, revenez à l’origine capturée au lieu de placer des pins.",
            "Pour un pin non résolu, cliquez le marqueur, cliquez l’élément live, puis confirmez que locationHistory a gagné une entrée exacte manuelle.",
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
            "La copie exige un commentaire enregistré et au moins un pin. La barre d’outils affiche Copying…, masque les overlays, capture le cliché, puis demande au document offscreen d’écrire text/html et text/plain. Offscreen essaie d’abord navigator.clipboard.write puis se rabat sur un événement copy plus execCommand. Si cette écriture n’est pas ok, le content script tente encore writePlainText sur la charge plain renvoyée : clipboard.writeText, puis une sélection textarea cachée.",
            "Lorsque tous les chemins de copie échouent, la page envoie overlays:hidden avec hidden false, affiche brièvement Copy failed, et laisse les pins modifiables. Une copie réussie affiche Copied, ou Copied plus no screenshot, helper unavailable ou no viewer, puis termine la session. Ces suffixes correspondent à `screenshot_missing`, `helper_unavailable` et `viewer_unavailable`. screenshot_inline n’est pas l’un des avertissements de handoff dégradé. Un collage sans clôture pinar-visual-context fermée ne peut pas être analysé comme JSON.",
          ],
          bullets: [
            "Si la barre d’outils indique Write a comment first ou Add a pin first, terminez ce pin et appuyez à nouveau sur Command/Ctrl+Enter.",
            "Si Copy failed apparaît, confirmez que les pins sont encore sur la page, accordez la permission du presse-papiers si elle est demandée, et réessayez la copie.",
            "Lisez le suffixe Copied : no screenshot, helper unavailable et no viewer nomment la couche manquante à réessayer sans jeter les commentaires.",
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
            "Faites glisser des sessions entre collections, réordonnez-les, ou utilisez Déplacer vers en lot pour un ensemble sélectionné. Dans une collection, Déplacer plus tôt et Déplacer plus tard ajustent l’ordre manuel enregistré.",
          ],
        },
        {
          heading: "Confirmer où atterrit une session déplacée",
          paragraphs: [
            "Ouvrez une collection avant d’utiliser Déplacer plus tôt ou Déplacer plus tard. Ces éléments n’apparaissent que dans une vue de collection, échangent la session avec son voisin dans la liste de positions enregistrée, et ne font rien à la première ou à la dernière ligne. Le tableau de bord envoie ensuite cette liste d’id complète en POST à `/api/collections/{id}/sessions/reorder`. Lorsqu’aucune collection n’est sélectionnée, la liste trie par date de création au lieu de cet ordre enregistré.",
            "Un glisser commence depuis la carte ou la ligne de tableau, pas depuis la recherche, les cases à cocher ou le menu d’actions (`data-no-dnd`). Si la session glissée est déjà sélectionnée avec d’autres, chaque id sélectionné voyage avec elle ; sinon seule cette session se déplace. Déplacer vers demande un projet, puis une collection dans l’arbre aplati de ce projet ; changer de projet vide le champ collection, et un projet sans collections est désactivé. La session est ajoutée à la position suivante dans la cible. Supprimer Personal est refusé ; supprimer un autre projet ajoute ses sessions à Inbox dans l’ordre existant et retire les collections de ce projet.",
          ],
          bullets: [
            "Sélectionnez une collection, puis n’utilisez Déplacer plus tôt ou Déplacer plus tard que lorsqu’un voisin existe ; la première ligne ne peut pas avancer et la dernière ne peut pas reculer.",
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
            "Tout sélectionner en grille ne s’applique qu’à la page courante de cartes ; tout sélectionner en tableau utilise la page de tableau courante. Le choix grille ou tableau est stocké dans localStorage comme `pinar-history-view`. La suppression en lot ouvre une boîte de confirmation, puis DELETE `/api/history/{id}` pour chaque id sélectionné. Un visualiseur public de projet ou de collection charge `/api/public/projects/{id}` ou `/api/public/collections/{id}` et copie le Markdown combiné depuis `/p/{id}.md` ou `/c/{id}.md`. Si cette récupération publique n’est pas ok, le visualiseur affiche un état introuvable au lieu d’une liste.",
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
            "Les installations Remote Free peuvent ouvrir l’app web avec un code d’extension à usage unique de cinq minutes. Créer un nouveau code de huit caractères invalide le précédent encore actif ; la génération autorise 10 demandes par cinq minutes par IP et compte, et l’échange autorise 20 tentatives par cinq minutes par IP. Les comptes payants et précédemment payants peuvent aussi demander un code e-mail à six chiffres ; il expire après dix minutes et se verrouille après cinq tentatives invalides.",
          ],
        },
        {
          heading: "Sessions",
          paragraphs: [
            "Les sessions web durent 30 jours et les appareils d’extension authentifiés durent 180 jours. Le serveur stocke des hachages des codes et des jetons de session plutôt que les valeurs secrètes d’origine.",
          ],
        },
        {
          heading:
            "Terminer l’association depuis l’onglet Compte de l’extension",
          paragraphs: [
            "Sur une installation Remote Free, ouvrez l’onglet Compte des options de l’extension, générez-y le code temporaire, puis copiez-le. Ouvrez la page de connexion hébergée depuis ce même onglet ; le lien cible /sign-in avec returnTo=/app afin qu’un échange réussi atterrisse dans le workspace web. Régénérer demande d’abord une confirmation parce que le serveur supprime chaque code inutilisé de ce owner avant d’insérer la nouvelle valeur de huit caractères. Collez le code sur pinar.dev plutôt que sur loopback : le helper local redirige /sign-in vers l’origine hébergée et n’émet pas lui-même de sessions cloud.",
            "Demander un code e-mail signale toujours accepted avec une indication de dix minutes, y compris pour des adresses inconnues, des comptes non payants, ou lorsque le service de mail est absent, afin que le formulaire ne soit pas un oracle de compte. Un véritable message à six chiffres n’est envoyé qu’à un compte ever-paid ; si la livraison lève une exception, cette ligne de challenge est supprimée. Les demandes e-mail autorisent 10 essais par IP et 5 par adresse par 15 minutes ; la vérification autorise 20 par IP et 10 par adresse par 15 minutes. Soumettre le code avec l’identité d’installation migre ce workspace Remote Free sur le compte payant et émet un jeton d’appareil de 180 jours. Se déconnecter révoque le cookie pinar_session et tout bearer d’appareil présenté sur la même requête.",
          ],
          bullets: [
            "Si aucun e-mail n’arrive, attendez la fenêtre de demande de 15 minutes avant de réessayer ; un 429 signifie que la limite d’IP ou d’adresse a été atteinte, tandis qu’une réponse accepted silencieuse peut signifier que l’adresse n’est pas payante ou est inconnue.",
            "Confirmez la boîte de régénération avant d’invalider un code que vous comptez encore saisir sur la page de connexion hébergée.",
            "Utilisez Se déconnecter dans l’onglet Compte, ou POST /api/auth/logout, lorsque vous devez révoquer immédiatement le cookie web courant ou la session d’appareil de l’extension.",
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
            "Free inclut un usage local permanent, 250 Mo de quota cloud, une rétention cloud de sept jours et cinq crédits IA initiaux. Pro est mensuel ou annuel avec 5 Go et 200 crédits IA non reportables rechargés chaque mois. Founder est une cohorte limitée unique avec 5 Go et 500 crédits initiaux ; il n’inclut pas de recharge mensuelle de crédits.",
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
            "POST /api/stripe/checkout refuse l’offre jusqu’à l’acceptation des versions courantes des Conditions, de la Politique de confidentialité et de l’Utilisation acceptable. Un pays Cloudflare BR sélectionne le catalogue BRL et les identifiants Stripe Price du Brésil ; tout autre pays utilise USD. Le checkout Founder insère d’abord une réservation de capacité indexée par l’id de requête de checkout et le hachage de claim, puis attache l’id de session Stripe ; créer la session Stripe sans réservation attachable libère le créneau. FOUNDER_SALES_ENABLED doit être true avec un FOUNDER_CAPACITY_LIMIT positif, sinon le gestionnaire renvoie 503 ; une cohorte pleine ou une discordance de claim sur un id de requête réutilisé renvoie 409.",
            "L’URL de succès porte session_id et claim ; l’activation hache ce claim contre les métadonnées Stripe et n’accorde l’offre qu’ensuite. GET /api/pricing expose founderState comme closed, sold_out ou available afin que la page Plans puisse masquer une cohorte que le checkout rejetterait. Le portail de facturation exige un compte authentifié qui a déjà un stripeCustomerId et revient à /app. Lorsque la facturation Pro cesse d’être active, les sessions de ce plan reçoivent un retention_expires_at 90 jours après la fin de l’éligibilité payante ; les comptes Founder et lifetime hérités conservent les sessions marquées permanente au lieu d’entrer dans ce chemin d’expiration.",
          ],
          bullets: [
            "Acceptez les versions de politique courantes dans le flux Plans hébergé avant de payer ; une acceptation manquante renvoie legal_acceptance_required au lieu d’une URL Stripe.",
            "Si le checkout Founder renvoie 409, rechargez /api/pricing : closed ou sold_out signifie attendre une réservation libérée ou choisir Pro plutôt que de réessayer le même claim avec un nouvel id de requête.",
            "Si le portail renvoie 401 ou 404 No Stripe customer found, terminez d’abord un Checkout payant afin qu’un id client existe, puis rouvrez Gérer l’abonnement depuis une session de compte.",
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
            "POST /api/ai/session-summary exige un requestId unique plus une session que vous possédez. Réutiliser le même requestId sur cette session renvoie la charge de succès stockée ou 409 ai_request_in_progress pendant que l’inférence est encore réservée. Après le délai de réservation de cinq minutes, l’usage est remboursé comme reservation_timeout et le prochain appel doit utiliser un nouveau requestId ; une relance expirée qui ne peut pas encore rembourser renvoie 503 ai_refund_pending. Une inférence échouée ou abandonnée rembourse immédiatement lorsque c’est possible. Un solde trop faible renvoie 402 insufficient_ai_credits avec le solde live. Workers AI manquant renvoie 503 ai_unavailable.",
            "Le sélecteur de grant dépense d’abord les soldes non achetés, puis le grant qui expire le plus tôt, afin que les crédits mensuels inclus qui expirent au prochain mois UTC soient utilisés avant un pack acheté. Un pack acheté de 1 000 crédits est stocké avec un expires_at de 12 mois et sort de la requête de solde une fois cet horodatage passé. GET /api/account/entitlements renvoie les crédits restants additionnés, nextExpiryAt et nextRefillAt pour les comptes Founder et pour les comptes Pro dont billing_status est active. La langue de résumé demandée doit être de, en, es, fr, ja, pt ou zh ; toute autre valeur est écrite en anglais.",
          ],
          bullets: [
            "Sur 409 ai_request_in_progress, attendez la fin du requestId en cours au lieu d’ouvrir un second résumé sur la même session.",
            "Sur ai_request_refunded ou reservation_timeout, soumettez un nouveau requestId ; rejouer l’id expiré ne lancera pas une autre inférence.",
            "Si le workspace affiche zéro crédit, appelez /api/account/entitlements et comparez nextExpiryAt aux packs achetés avant d’acheter une autre offre de 1 000 crédits.",
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
            "Le quota est `baseBytes` plus les octets d’options encore actives. `canStoreBytes` traite un écrasement comme `usedBytes` moins les octets déjà stockés pour cette session plus la taille entrante, donc remplacer un PNG plus lourd par un plus petit peut réussir lorsqu’une capture entièrement nouvelle dépasserait le quota. `uploadAllowed` est false dès que `usedBytes` est déjà égal ou supérieur au quota. Le dépassement de quota sans horodatage `latestExpiredAt` est l’état over_quota sans horloge de grâce. Lorsque `latestExpiredAt` est défini depuis une option expirée ou depuis `paidEligibilityEndedAt`, le compte est en grâce pendant 30 jours, récupérable jusqu’au jour 90, puis cleanup_eligible ; les envois restent interdits dans les trois états.",
            "Les sessions cloud Free non permanentes deviennent éligibles à la suppression après sept jours. Le contenu Pro au-dessus du quota Free suit la grâce de 30 jours et la fenêtre de récupération de 90 jours après la fin de l’éligibilité payante. Le contenu Founder et lifetime hérité n’est pas rendu éligible à la suppression simplement parce qu’il n’y a pas d’abonnement récurrent ; il reste limité par le quota acheté, la suppression utilisateur, les gels d’abus et juridiques, la clôture de compte et l’arrêt du service. L’historique uniquement local sur l’appareil n’est jamais supprimé à distance. L’éligibilité à la suppression n’est pas une promesse de retrait immédiat, et la suppression automatique hébergée n’est volontairement pas activée.",
          ],
          bullets: [
            "Lorsque de nouvelles captures s’interrompent, réduisez `usedBytes` sous le quota restant en supprimant des sessions ou en remplaçant un screenshot lourd, ou achetez une option de douze mois de 5 Go ou 20 Go.",
            "Si l’état de droit est grace ou recoverable, exportez ce dont vous avez encore besoin avant le jour 90 après `latestExpiredAt` ; cleanup_eligible ne marque que le dépassement, il ne supprime pas lui-même.",
            "N’attendez pas que la désinstallation de l’app de bureau purge les objets cloud, et n’attendez pas que le cloud efface l’historique local ~/.pinar.",
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
            "Le HTML non listé vit à /v/{id} pour une session, /p/{id} pour un projet et /c/{id} pour une collection. La projection Markdown est le même chemin avec un suffixe .md. Le visualiseur agrégé charge /api/public/projects/{id} ou /api/public/collections/{id} sans cookie d’auth ; Copier le Markdown fait ensuite GET /p/{id}.md ou /c/{id}.md et écrit le texte dans le presse-papiers, et chaque carte de session ouvre /v/{id}. Un id manquant ou malformé renvoie Session not found, Project not found ou Collection not found plutôt que l’e-mail du owner, le plan ou d’autres champs de compte.",
            "Le Markdown de session est construit à partir du paquet de handoff plus les sections agent-result et pin-review. Le Markdown de projet et de collection liste chaque session imbriquée avec l’URL de page, /v/{id}.md, une URL de screenshot optionnelle, les commentaires de pins, `pinId`, le chemin DOM, le sélecteur et le texte intérieur. Les lignes Screenshot n’apparaissent que lorsque la préférence de livraison `includeScreenshot` du owner les autorise. Le Markdown et le JSON public sont mis en cache comme public max-age=60 ; les PNG de clichés sont mis en cache 86400 secondes. Quiconque peut ouvrir le lien peut copier ce qu’il voit, donc une URL non listée n’est pas une autorisation ni une minimisation des données.",
          ],
          bullets: [
            "Avant d’envoyer /p/{id} ou /c/{id}, ouvrez une fois Copier le Markdown et vérifiez que chaque session imbriquée, commentaire de pin et ligne de screenshot est sûre à publier.",
            "Désactivez la livraison de screenshots sur le compte owner si la projection doit garder les URL d’images hors du contenu ; attendez au moins 60 secondes que le cache Markdown public expire.",
            "Si un chemin partagé affiche introuvable, traitez l’id comme disparu ou invalide ; les gestionnaires publics n’ajoutent jamais de diagnostics de compte privés à cette réponse.",
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
            "Les screenshots locaux sont des fichiers sous `~/.pinar/shots` et l’historique local est SQLite sous `~/.pinar/history.db`, avec un repli JSON lorsque SQLite est indisponible. Les préférences du navigateur telles que la vue, la langue, le thème et les réglages de livraison restent dans le stockage local du navigateur, sauf si une fonction les synchronise explicitement.",
          ],
        },
        {
          heading: "Frontière cloud",
          paragraphs: [
            "Les enregistrements de compte cloud et les métadonnées de capture utilisent Cloudflare D1 ; les images utilisent R2. Stripe traite la facturation, le service d’e-mail configuré envoie les codes de connexion, et Workers AI gère les résumés demandés. La page Sous-traitants est la liste actuelle des rôles de services externes.",
          ],
        },
        {
          heading: "Confirmer quel magasin détient réellement chaque capture",
          paragraphs: [
            "Commencez dans le répertoire d’accueil du helper et vérifiez quel fichier est live. Les screenshots sont écrits comme fichiers PNG dans le dossier shots ; l’historique de session préfère SQLite à `history.db`, et `history.json` n’est ouvert qu’après que `SqliteHistoryDb` n’a pas pu être construit. Une ouverture SQLite réussie réécrit aussi les préfixes de chemin shots/shots imbriqués vers le répertoire shots canonique. Le thème reste une préférence uniquement navigateur : l’onglet Interface stocke dark ou light sous la clé localStorage pinar-theme et supprime cette clé pour system. La langue plus les interrupteurs de l’onglet Capture pour le mode de handoff (full versus compact) et include-screenshot sont édités dans la même boîte de dialogue de paramètres, mais un compte cloud connecté peut persister handoff_mode et include_screenshot dans D1 owner_preferences via GET et PATCH /api/preferences.",
            "Les captures hébergées conservent les métadonnées dans D1 et les octets PNG dans R2. Les projections publiques non authentifiées sont GET /shots/{id}.png (Cache-Control max-age 86400), GET /v/{id}.md, et les routes de projet et de collection /p/ et /c/. POST /api/auth/email-codes ne stocke qu’un hachage dans email_challenges, expire le challenge après dix minutes, et renvoie 202 avec { accepted: true, expiresInSeconds: 600 } même lorsque EMAIL est manquant ou que le compte n’est pas everPaid, afin que la réponse ne révèle pas si le mail a été envoyé (429 est l’exception de limite de débit). Les résumés demandés appellent le modèle Workers AI @cf/meta/llama-3.1-8b-instruct-fp8 à POST /api/ai/session-summary. La page Sous-traitants nomme Cloudflare pour D1, R2, Workers AI et l’e-mail transactionnel, et Stripe pour Checkout, en notant que Pinar ne reçoit pas les détails complets de carte. GET /api/legal/current signale la version de politique 2026-08-25.",
          ],
          bullets: [
            "Si `history.db` est manquant ou que SQLite n’a pas pu s’ouvrir, traitez ~/.pinar/history.json comme le catalogue local live et attendez un avertissement de console sur le repli JSON.",
            'Ouvrez un screenshot hébergé à /shots/{id}.png et sa projection markdown à /v/{id}.md ; un objet R2 manquant renvoie JSON { error: "shot not found" } avec le statut 404.',
            "Dans les paramètres, confirmez le thème Interface via pinar-theme, puis distinguez les interrupteurs de livraison Capture de handoff_mode et include_screenshot synchronisés dans D1 lorsque vous êtes connecté.",
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
            "sanitizeCapture classe les champs password, otp, payment et token à partir du type d’entrée, de l’autocomplete et du haystack name/id/ariaLabel/role, puis sanitise l’URL de la page. Les clés de requête de l’ensemble sensible, ou les valeurs qui lookLikeSecret (longueur d’au moins 12 correspondant à un JWT ou des préfixes tels que sk_live_, ghp_, github_pat_ et AIza), sont remplacées par [redacted] et étiquetées secret-query ou token ; les paramètres de hash utilisent secret-hash. Les noms supplémentaires dans extraQueryKeys et extraHashKeys sont mis en minuscules, découpés sur les espaces, virgules ou points-virgules, et unis à DEFAULT_SENSITIVE_QUERY_KEYS, qui inclut aussi authorization, refresh_token, session, session_id, client_secret, bearer et des noms liés au-delà de la courte liste d’aperçu. Les secrets collectés remplacent ensuite les sous-chaînes correspondantes dans title, description, URL et pins. Les valeurs de moins de quatre caractères ne sont pas utilisées comme secrets de remplacement même lorsque le champ a été classé, et une URL qui ne s’analyse pas est renvoyée inchangée.",
            "parseVisualCapture accepte schemaVersion 1 ou l’héritage 0 et lève VisualContextError avec le message stable invalid visual context et les codes unsupported_schema, invalid_payload, invalid_pin ou missing_capture_id au lieu d’échoer le corps brut. decodeVisualCaptureJson se rétablit d’un échec JSON ou de schéma en renvoyant ce `captureId` avec des pins vides. screenshotFrom et captureForHandoffJson définissent screenshot.url à null pour les URL data: ; le chemin de handoff ajoute l’avertissement screenshot_inline lorsqu’il a retiré des octets inline, afin que le paquet texte conserve un chemin de système de fichiers ou une référence http(s) plutôt que la charge d’image. Définir input.unevaluated à true enregistre unevaluated sur le rapport de confidentialité et ajoute l’avertissement privacy_unevaluated.",
          ],
          bullets: [
            "Après sanitizeCapture, lisez privacy.redacted plus les avertissements privacy_redacted ou privacy_unevaluated ; unevaluated true signifie que certaines régions n’ont pas été inspectées.",
            "Ajoutez des noms de clés de requête supplémentaires comme jetons séparés par des virgules, des espaces ou des points-virgules ; la correspondance est insensible à la casse contre l’ensemble intégré, y compris authorization, session et refresh_token.",
            "Si le JSON de handoff collé contient encore une URL de screenshot data:, la capture a sauté captureForHandoffJson ; le chemin pris en charge met url à null et peut ajouter screenshot_inline.",
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
            'Le helper persiste un magasin version-1 à local-capability.json en utilisant un fichier temporaire 0o600 et un rename. Envoyez le secret courant dans l’en-tête x-pinar-capability ou comme jeton Authorization Bearer. GET /api/local/capability peut omettre le secret lorsque Origin est vide, HTTP loopback sur 127.0.0.1, localhost ou ::1, ou chrome-extension:// avec un id alphanumérique ; toute autre Origin est hostile et reçoit 401 { error: "unauthorized" } avec Cache-Control no-store. Le loopback HTTPS n’est pas traité comme loopback. POST /api/local/capability/rotate et /revoke exigent un secret correspondant. La rotation écrit un nouveau secret current et conserve previous.secret jusqu’à expiresAt (24 heures par défaut, surchargeable avec PINAR_CAPABILITY_GRACE_MS ; zéro abandonne previous). Révoquer supprime le fichier ; le prochain readOrCreateLocalCapability crée un nouveau magasin. Les requêtes loopback ordinaires sautent le secret ; les requêtes chrome-extension ont besoin d’une correspondance. Les entrées classées public-min ou local-public-projection sautent cette porte.',
            "claimInstanceLock laisse un PID étranger live en place et appelle onDuplicate ; un verrou manquant ou illisible est traité comme périmé et écrasé avec l’id de ce processus. migrateNestedShots déplace les fichiers de shots/shots vers shots et saute les noms qui existent déjà à la destination ; il retire le répertoire imbriqué seulement lorsque la liste de conflits est vide. Les ids de clichés sont réduits à A–Z, a–z, 0–9, underscore et trait d’union, avec un maximum de 80 caractères, sinon le fichier est pin.png. Si `SqliteHistoryDb` lève une exception, openHistoryDb avertit et ouvre `history.json`. Un fichier JSON corrompu s’analyse en tableaux vides, puis _ensureDefaults recrée le projet protégé Personal et la collection Inbox pour owner local. Une écriture JSON échouée consigne un avertissement et n’interrompt pas le démarrage. Lorsque `history.db` est absent, migrateLegacyHistoryDb peut renommer un history.sqlite restant de bin/ ou shots/ en `history.db`.",
          ],
          bullets: [
            "Envoyez x-pinar-capability ou Bearer sur les appels chrome-extension ; GET /api/local/capability s’amorce depuis HTTP loopback ou chrome-extension, et les autres Origin reçoivent 401 unauthorized.",
            "Après revoke, local-capability.json a disparu ; le prochain démarrage du helper crée un nouveau secret, et les clients doivent le relire avant que rotate ou revoke ne réussissent à nouveau.",
            "Si `history.db` ne peut pas s’ouvrir, attendez `history.json` ; un fichier JSON corrompu devient un catalogue vide, puis Personal et Inbox pour owner local, sans faire planter le helper.",
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
            "Les métriques de boucle sont désactivées sauf si vous y adhérez. Lorsqu’elles sont désactivées, les envois sont jetés. Lorsqu’elles sont activées, le sanitizer autorise les événements opérationnels, la durée, l’agent et la confiance de relocalisation, mais rejette les commentaires, titres, URL, chemins DOM, sélecteurs, screenshots, balisage et contenu brut.",
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
            "Les métriques de boucle sont désactivées par défaut parce que DEFAULT_LOOP_METRICS_OPT_IN est false. planLoopMetricRequest renvoie send false avec la raison opt_in_off sauf si optIn est strictement true, et loopMetricHttpStatus mappe ce code vers HTTP 200. Lorsqu’elles sont activées, chaque objet d’événement ne peut contenir que agent, degraded, durationMs, event et locationConfidence. Des clés inconnues, des clés interdites telles que url, title, comment, screenshot, selector, path, `captureId`, sessionId, html, markdown, content, pin et page, ou des valeurs de chaîne qui ressemblent à des URL http(s), des URI data:, ou contiennent { ou <, deviennent forbidden_fields (HTTP 400). event doit être accepted, correction_ready, handoff, relocation_failed ou reopened ; agent doit être claude, codex, cursor ou grok ; locationConfidence doit être exact, probable, ambiguous ou unresolved ; durationMs doit être un entier non négatif d’au plus 86 400 000. Une valeur events vide ou non tableau est invalid_payload et n’est pas envoyée.",
            "Le README indique que le checkout et l’enregistrement Remote Free consignent les versions de politique acceptées et publie les Conditions, Confidentialité, Utilisation acceptable, Rétention, Remboursements, Fair Source et Sous-traitants à https://pinar.dev/legal/. legal-documents fige CURRENT_LEGAL_VERSION à 2026-08-25 pour les sept ids de documents. Les Conditions disent qu’un usage uniquement local qui ne contacte jamais le service hébergé n’a pas besoin de compte hébergé ; la Confidentialité dit que les données uniquement locales qui ne quittent jamais l’appareil sont hors de la politique hébergée. LICENSE est Functional Source License, Version 1.1, MIT Conversion : deux ans après la première publication, la Change License est MIT, et jusqu’à la Change Date vous ne pouvez pas offrir un service commercial hébergé concurrent d’annotation visuelle, d’aperçu de screenshot ou de persistance cloud. L’avis Fair Source s’en remet à LICENSE et n’est pas Open Source approuvé OSI. Les questions vont à contact@pinar.dev ou contato@pinar.dev.",
          ],
          bullets: [
            "Laissez les métriques de boucle désactivées sauf si vous visez optIn true ; un plan désactivé renvoie send false avec opt_in_off et ne transmet pas le lot.",
            "Avant la persistance hébergée ou le checkout, ouvrez Conditions, Confidentialité et Utilisation acceptable à la version 2026-08-25 depuis https://pinar.dev/legal/terms, /privacy et /acceptable-use.",
            "Traitez LICENSE comme déterminant pour les limites de concurrence FSL-1.1-MIT et la Change Date ; les sous-traitants hébergés actuellement nommés sont Cloudflare et Stripe.",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
