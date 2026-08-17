import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getBestLanguage, translations, type SupportedLanguage } from "@pinar/shared";

export const SERVER_LANGUAGES: SupportedLanguage[] = ["en", "pt", "es", "fr", "de", "zh", "ja"];

type LocalizedMessage = Record<SupportedLanguage, string>;

const messages = {
  "common.pinarHome": { en: "Pinar home", pt: "Início do Pinar", es: "Inicio de Pinar", fr: "Accueil Pinar", de: "Pinar-Startseite", zh: "Pinar 首页", ja: "Pinar ホーム" },
  "common.primaryNavigation": { en: "Primary navigation", pt: "Navegação principal", es: "Navegación principal", fr: "Navigation principale", de: "Hauptnavigation", zh: "主导航", ja: "メインナビゲーション" },
  "common.home": { en: "Home", pt: "Início", es: "Inicio", fr: "Accueil", de: "Start", zh: "首页", ja: "ホーム" },
  "common.dashboard": { en: "Dashboard", pt: "Painel", es: "Panel", fr: "Tableau de bord", de: "Übersicht", zh: "控制面板", ja: "ダッシュボード" },
  "common.plans": { en: "Plans", pt: "Planos", es: "Planes", fr: "Forfaits", de: "Tarife", zh: "方案", ja: "プラン" },
  "common.signIn": { en: "Sign in", pt: "Entrar", es: "Entrar", fr: "Se connecter", de: "Anmelden", zh: "登录", ja: "ログイン" },
  "common.openApp": { en: "Open app", pt: "Abrir app", es: "Abrir app", fr: "Ouvrir l’app", de: "App öffnen", zh: "打开应用", ja: "アプリを開く" },
  "common.language": { en: "Language", pt: "Idioma", es: "Idioma", fr: "Langue", de: "Sprache", zh: "语言", ja: "言語" },
  "common.toggleTheme": { en: "Toggle theme", pt: "Alternar tema", es: "Cambiar tema", fr: "Changer de thème", de: "Theme wechseln", zh: "切换主题", ja: "テーマを切り替え" },
  "common.coffee": { en: "Coffee", pt: "Café", es: "Café", fr: "Café", de: "Kaffee", zh: "请喝咖啡", ja: "コーヒー" },
  "common.sponsor": { en: "Sponsor", pt: "Apoiar", es: "Patrocinar", fr: "Soutenir", de: "Unterstützen", zh: "赞助", ja: "スポンサー" },
  "common.upgradePro": { en: "Upgrade to Pro", pt: "Assinar o Pro", es: "Mejorar a Pro", fr: "Passer à Pro", de: "Auf Pro upgraden", zh: "升级到 Pro", ja: "Pro にアップグレード" },
  "common.subscribe": { en: "Subscribe", pt: "Assinar", es: "Suscribirse", fr: "S’abonner", de: "Abonnieren", zh: "订阅", ja: "購読" },
  "common.pro": { en: "Pro", pt: "Pro", es: "Pro", fr: "Pro", de: "Pro", zh: "Pro", ja: "Pro" },
  "common.copied": { en: "Copied", pt: "Copiado", es: "Copiado", fr: "Copié", de: "Kopiert", zh: "已复制", ja: "コピー済み" },
  "common.cancel": { en: "Cancel", pt: "Cancelar", es: "Cancelar", fr: "Annuler", de: "Abbrechen", zh: "取消", ja: "キャンセル" },
  "common.error": { en: "Error", pt: "Erro", es: "Error", fr: "Erreur", de: "Fehler", zh: "错误", ja: "エラー" },
  "common.loading": { en: "Loading page", pt: "Carregando página", es: "Cargando página", fr: "Chargement de la page", de: "Seite wird geladen", zh: "正在加载页面", ja: "ページを読み込み中" },
  "common.serverVersion": { en: "Pinar v{version}", pt: "Pinar v{version}", es: "Pinar v{version}", fr: "Pinar v{version}", de: "Pinar v{version}", zh: "Pinar v{version}", ja: "Pinar v{version}" },

  "app.workspace": { en: "Workspace", pt: "Workspace", es: "Espacio de trabajo", fr: "Espace de travail", de: "Arbeitsbereich", zh: "工作区", ja: "ワークスペース" },
  "app.allProjects": { en: "All projects", pt: "Todos os projetos", es: "Todos los proyectos", fr: "Tous les projets", de: "Alle Projekte", zh: "所有项目", ja: "すべてのプロジェクト" },
  "app.accountMenu": { en: "Account menu", pt: "Menu da conta", es: "Menú de la cuenta", fr: "Menu du compte", de: "Kontomenü", zh: "账户菜单", ja: "アカウントメニュー" },
  "app.local": { en: "Local server", pt: "Servidor local", es: "Servidor local", fr: "Serveur local", de: "Lokaler Server", zh: "本地服务器", ja: "ローカルサーバー" },
  "app.freeInstallation": { en: "Free installation", pt: "Instalação Free", es: "Instalación Free", fr: "Installation gratuite", de: "Kostenlose Installation", zh: "免费安装", ja: "無料インストール" },
  "app.manageBilling": { en: "Manage billing", pt: "Gerenciar cobrança", es: "Gestionar facturación", fr: "Gérer la facturation", de: "Abrechnung verwalten", zh: "管理账单", ja: "請求を管理" },
  "app.signOut": { en: "Sign out", pt: "Sair", es: "Salir", fr: "Se déconnecter", de: "Abmelden", zh: "退出登录", ja: "ログアウト" },

  "signIn.accountDescription": { en: "Paid and previously paid accounts receive a six-digit code by email.", pt: "Contas pagantes ou anteriormente pagantes recebem um código de seis dígitos por e-mail.", es: "Las cuentas pagadas o anteriormente pagadas reciben un código de seis dígitos por correo.", fr: "Les comptes payants ou anciennement payants reçoivent un code à six chiffres par e-mail.", de: "Zahlende und ehemals zahlende Konten erhalten einen sechsstelligen Code per E-Mail.", zh: "付费或曾付费账户会通过电子邮件收到六位数代码。", ja: "有料または以前有料だったアカウントには、6桁のコードがメールで届きます。" },
  "signIn.accountTab": { en: "Account", pt: "Conta", es: "Cuenta", fr: "Compte", de: "Konto", zh: "账户", ja: "アカウント" },
  "signIn.accountTitle": { en: "Sign in to your account", pt: "Entrar na sua conta", es: "Entrar en tu cuenta", fr: "Se connecter à votre compte", de: "Bei deinem Konto anmelden", zh: "登录账户", ja: "アカウントにログイン" },
  "signIn.changeEmail": { en: "Use another email", pt: "Usar outro e-mail", es: "Usar otro correo", fr: "Utiliser un autre e-mail", de: "Andere E-Mail verwenden", zh: "使用其他邮箱", ja: "別のメールを使う" },
  "signIn.codeInvalid": { en: "The code is invalid or expired.", pt: "O código é inválido ou expirou.", es: "El código no es válido o ha caducado.", fr: "Le code est invalide ou expiré.", de: "Der Code ist ungültig oder abgelaufen.", zh: "代码无效或已过期。", ja: "コードが無効か期限切れです。" },
  "signIn.emailSent": { en: "If this email belongs to an eligible account, a code is on its way.", pt: "Se este e-mail pertencer a uma conta elegível, o código está a caminho.", es: "Si este correo pertenece a una cuenta elegible, el código está en camino.", fr: "Si cet e-mail correspond à un compte éligible, un code est en route.", de: "Wenn diese E-Mail zu einem berechtigten Konto gehört, ist ein Code unterwegs.", zh: "如果该邮箱属于符合条件的账户，代码已发送。", ja: "このメールが対象アカウントのものであれば、コードが送信されます。" },
  "signIn.entering": { en: "Signing in…", pt: "Entrando…", es: "Entrando…", fr: "Connexion…", de: "Anmeldung…", zh: "正在登录…", ja: "ログイン中…" },
  "signIn.extensionPlaceholder": { en: "8-character code", pt: "Código de 8 caracteres", es: "Código de 8 caracteres", fr: "Code à 8 caractères", de: "8-stelliger Code", zh: "8 位代码", ja: "8文字のコード" },
  "signIn.extensionTab": { en: "Extension", pt: "Extensão", es: "Extensión", fr: "Extension", de: "Erweiterung", zh: "扩展程序", ja: "拡張機能" },
  "signIn.freeDescription": { en: "Free users can enter the temporary code shown by the Pinar extension.", pt: "Usuários Free podem inserir o código temporário exibido pela extensão Pinar.", es: "Los usuarios Free pueden ingresar el código temporal de la extensión Pinar.", fr: "Les utilisateurs gratuits peuvent saisir le code temporaire affiché par l’extension Pinar.", de: "Kostenlose Nutzer können den temporären Code aus der Pinar-Erweiterung eingeben.", zh: "免费用户可以输入 Pinar 扩展程序显示的临时代码。", ja: "無料ユーザーは Pinar 拡張機能に表示される一時コードを入力できます。" },
  "signIn.freeTitle": { en: "Continue with the extension", pt: "Continuar com a extensão", es: "Continuar con la extensión", fr: "Continuer avec l’extension", de: "Mit der Erweiterung fortfahren", zh: "使用扩展程序继续", ja: "拡張機能で続行" },
  "signIn.openApp": { en: "Open app", pt: "Abrir app", es: "Abrir app", fr: "Ouvrir l’app", de: "App öffnen", zh: "打开应用", ja: "アプリを開く" },
  "signIn.requestFailed": { en: "Unable to request a code.", pt: "Não foi possível solicitar o código.", es: "No se pudo solicitar el código.", fr: "Impossible de demander un code.", de: "Der Code konnte nicht angefordert werden.", zh: "无法请求代码。", ja: "コードをリクエストできませんでした。" },
  "signIn.sendCode": { en: "Send code", pt: "Enviar código", es: "Enviar código", fr: "Envoyer le code", de: "Code senden", zh: "发送代码", ja: "コードを送信" },
  "signIn.sending": { en: "Sending…", pt: "Enviando…", es: "Enviando…", fr: "Envoi…", de: "Wird gesendet…", zh: "正在发送…", ja: "送信中…" },
  "signIn.verifyCode": { en: "Verify and enter", pt: "Verificar e entrar", es: "Verificar y entrar", fr: "Vérifier et entrer", de: "Prüfen und anmelden", zh: "验证并登录", ja: "確認してログイン" },

  "landing.badge": { en: "Visual feedback for AI workflows", pt: "Feedback visual para fluxos com IA", es: "Feedback visual para flujos con IA", fr: "Retours visuels pour les flux IA", de: "Visuelles Feedback für KI-Workflows", zh: "面向 AI 工作流的视觉反馈", ja: "AI ワークフロー向けビジュアルフィードバック" },
  "landing.title": { en: "Point to the problem. Share the complete context.", pt: "Aponte o problema. Compartilhe todo o contexto.", es: "Señala el problema. Comparte todo el contexto.", fr: "Montrez le problème. Partagez tout le contexte.", de: "Zeige auf das Problem. Teile den vollständigen Kontext.", zh: "指出问题，分享完整上下文。", ja: "問題を示し、完全なコンテキストを共有。" },
  "landing.description": { en: "Pinar turns annotated screenshots into structured, Markdown-ready feedback that developers and AI agents can act on immediately.", pt: "O Pinar transforma capturas anotadas em feedback estruturado e pronto para Markdown, para desenvolvedores e agentes de IA agirem imediatamente.", es: "Pinar convierte capturas anotadas en feedback estructurado y listo para Markdown, para que desarrolladores y agentes de IA actúen de inmediato.", fr: "Pinar transforme les captures annotées en retours structurés, prêts pour Markdown, directement exploitables par les développeurs et agents IA.", de: "Pinar verwandelt kommentierte Screenshots in strukturiertes, Markdown-fertiges Feedback für Entwickler und KI-Agenten.", zh: "Pinar 将带注释的截图转化为结构化、可直接用于 Markdown 的反馈，便于开发者和 AI 代理立即处理。", ja: "Pinar は注釈付きスクリーンショットを、開発者や AI エージェントがすぐ扱える構造化された Markdown 向けフィードバックに変換します。" },
  "landing.openDashboard": { en: "Open dashboard", pt: "Abrir painel", es: "Abrir panel", fr: "Ouvrir le tableau de bord", de: "Übersicht öffnen", zh: "打开控制面板", ja: "ダッシュボードを開く" },
  "landing.viewPlans": { en: "View plans", pt: "Ver planos", es: "Ver planes", fr: "Voir les forfaits", de: "Tarife ansehen", zh: "查看方案", ja: "プランを見る" },
  "landing.howItWorks": { en: "How Pinar works", pt: "Como o Pinar funciona", es: "Cómo funciona Pinar", fr: "Comment fonctionne Pinar", de: "So funktioniert Pinar", zh: "Pinar 的工作方式", ja: "Pinar の仕組み" },
  "landing.pinTitle": { en: "Pin what matters", pt: "Marque o que importa", es: "Marca lo importante", fr: "Épinglez l’essentiel", de: "Markiere, was wichtig ist", zh: "标记关键内容", ja: "重要な箇所をピン留め" },
  "landing.pinDescription": { en: "Select an element or area and attach the feedback exactly where the problem appears, without losing the page context.", pt: "Selecione um elemento ou uma área e anexe o feedback exatamente onde o problema aparece, sem perder o contexto da página.", es: "Selecciona un elemento o área y adjunta el feedback exactamente donde aparece el problema, sin perder el contexto de la página.", fr: "Sélectionnez un élément ou une zone et placez le retour exactement là où le problème apparaît, sans perdre le contexte de la page.", de: "Wähle ein Element oder einen Bereich und platziere das Feedback genau an der Problemstelle, ohne den Seitenkontext zu verlieren.", zh: "选择元素或区域，将反馈准确附加到问题出现的位置，同时保留页面上下文。", ja: "要素や範囲を選び、ページのコンテキストを失わずに問題のある場所へ正確にフィードバックを付けます。" },
  "landing.contextTitle": { en: "Preserve the context", pt: "Preserve o contexto", es: "Conserva el contexto", fr: "Préservez le contexte", de: "Bewahre den Kontext", zh: "保留上下文", ja: "コンテキストを保持" },
  "landing.contextDescription": { en: "Every capture keeps the screenshot, comment, selector, DOM path, and coordinates together.", pt: "Cada captura mantém juntos o screenshot, comentário, seletor, caminho DOM e coordenadas.", es: "Cada captura conserva juntos la imagen, el comentario, el selector, la ruta DOM y las coordenadas.", fr: "Chaque capture conserve ensemble l’image, le commentaire, le sélecteur, le chemin DOM et les coordonnées.", de: "Jede Aufnahme hält Screenshot, Kommentar, Selektor, DOM-Pfad und Koordinaten zusammen.", zh: "每次捕获都会将截图、评论、选择器、DOM 路径和坐标保存在一起。", ja: "各キャプチャでスクリーンショット、コメント、セレクター、DOM パス、座標をまとめて保持します。" },
  "landing.aiTitle": { en: "Hand it to AI", pt: "Entregue para a IA", es: "Entrégaselo a la IA", fr: "Confiez-le à l’IA", de: "Übergib es an die KI", zh: "交给 AI", ja: "AI に渡す" },
  "landing.aiDescription": { en: "Copy one Markdown-ready link so an AI agent can move from report to implementation quickly.", pt: "Copie um único link pronto para Markdown para que um agente de IA passe rapidamente do relato à implementação.", es: "Copia un único enlace listo para Markdown para que un agente de IA pase rápidamente del informe a la implementación.", fr: "Copiez un lien prêt pour Markdown afin qu’un agent IA passe rapidement du signalement à l’implémentation.", de: "Kopiere einen Markdown-fertigen Link, damit ein KI-Agent schnell vom Bericht zur Umsetzung gelangt.", zh: "复制一个可用于 Markdown 的链接，让 AI 代理快速从报告进入实现。", ja: "Markdown 対応リンクを1つコピーし、AI エージェントが報告から実装へすばやく進めるようにします。" },
  "landing.privateTitle": { en: "Private by default", pt: "Privado por padrão", es: "Privado por defecto", fr: "Privé par défaut", de: "Standardmäßig privat", zh: "默认私密", ja: "デフォルトで非公開" },
  "landing.privateDescription": { en: "Run the local server with unlimited retention. Your screenshots and annotations remain on your device.", pt: "Execute o servidor local com retenção ilimitada. Seus screenshots e anotações permanecem no dispositivo.", es: "Ejecuta el servidor local con retención ilimitada. Tus capturas y anotaciones permanecen en el dispositivo.", fr: "Utilisez le serveur local avec une conservation illimitée. Vos captures et annotations restent sur l’appareil.", de: "Nutze den lokalen Server mit unbegrenzter Aufbewahrung. Screenshots und Anmerkungen bleiben auf deinem Gerät.", zh: "运行本地服务器即可无限期保留，截图和注释始终留在设备上。", ja: "ローカルサーバーなら無期限保存。スクリーンショットと注釈は端末内に残ります。" },
  "landing.privateNote": { en: "Ideal for private workflows with CLIs and AI agents running on your own machine.", pt: "Ideal para fluxos privados com CLIs e agentes de IA executados na sua própria máquina.", es: "Ideal para flujos privados con CLI y agentes de IA ejecutados en tu propio equipo.", fr: "Idéal pour les flux privés avec des CLI et des agents IA exécutés sur votre propre machine.", de: "Ideal für private Workflows mit CLIs und KI-Agenten, die auf deinem eigenen Rechner laufen.", zh: "非常适合在你自己的设备上运行 CLI 和 AI 代理的私密工作流。", ja: "自分のマシン上で CLI や AI エージェントを実行するプライベートなワークフローに最適です。" },
  "landing.openLocalDashboard": { en: "Open local dashboard", pt: "Abrir painel local", es: "Abrir panel local", fr: "Ouvrir le tableau local", de: "Lokale Übersicht öffnen", zh: "打开本地控制面板", ja: "ローカルダッシュボードを開く" },
  "landing.shareTitle": { en: "Share when you need to", pt: "Compartilhe quando precisar", es: "Comparte cuando lo necesites", fr: "Partagez quand nécessaire", de: "Teile bei Bedarf", zh: "按需分享", ja: "必要なときだけ共有" },
  "landing.shareDescription": { en: "Use the remote server for unlisted viewer and Markdown links, with seven-day free retention or permanent Pro storage.", pt: "Use o servidor remoto para links não listados do viewer e Markdown, com retenção gratuita de sete dias ou armazenamento Pro permanente.", es: "Usa el servidor remoto para enlaces no listados del visor y Markdown, con siete días gratuitos o almacenamiento Pro permanente.", fr: "Utilisez le serveur distant pour des liens non répertoriés du visualiseur et Markdown, avec sept jours gratuits ou un stockage Pro permanent.", de: "Nutze den Remote-Server für nicht gelistete Viewer- und Markdown-Links mit sieben Tagen kostenloser oder dauerhafter Pro-Speicherung.", zh: "使用远程服务器生成不公开列出的查看器和 Markdown 链接，可免费保留七天或使用 Pro 永久存储。", ja: "リモートサーバーでは非公開のビューアー／Markdown リンクを使え、無料は7日間、Pro は永久保存です。" },
  "landing.sameExperience": { en: "The same capture and viewer experience works locally and remotely.", pt: "A mesma experiência de captura e visualização funciona local e remotamente.", es: "La misma experiencia de captura y visualización funciona en local y remoto.", fr: "La même expérience de capture et de visualisation fonctionne en local comme à distance.", de: "Dieselbe Aufnahme- und Viewer-Erfahrung funktioniert lokal und remote.", zh: "本地与远程模式拥有相同的捕获和查看体验。", ja: "ローカルでもリモートでも同じキャプチャとビューアー体験です。" },
  "landing.comparePlans": { en: "Compare plans", pt: "Comparar planos", es: "Comparar planes", fr: "Comparer les forfaits", de: "Tarife vergleichen", zh: "比较方案", ja: "プランを比較" },
  "landing.footer": { en: "Visual annotations for developers and AI agents.", pt: "Anotações visuais para desenvolvedores e agentes de IA.", es: "Anotaciones visuales para desarrolladores y agentes de IA.", fr: "Annotations visuelles pour développeurs et agents IA.", de: "Visuelle Anmerkungen für Entwickler und KI-Agenten.", zh: "面向开发者和 AI 代理的视觉注释。", ja: "開発者と AI エージェントのためのビジュアル注釈。" },

  "dashboard.description": { en: "Review and reopen your visual feedback sessions.", pt: "Revise e reabra suas sessões de feedback visual.", es: "Revisa y vuelve a abrir tus sesiones de feedback visual.", fr: "Consultez et rouvrez vos sessions de retours visuels.", de: "Prüfe und öffne deine visuellen Feedback-Sitzungen erneut.", zh: "查看并重新打开视觉反馈会话。", ja: "ビジュアルフィードバックのセッションを確認し、再度開けます。" },
  "dashboard.search": { en: "Search...", pt: "Buscar...", es: "Buscar...", fr: "Rechercher...", de: "Suchen...", zh: "搜索...", ja: "検索..." },
  "dashboard.historyView": { en: "History view", pt: "Visualização do histórico", es: "Vista del historial", fr: "Affichage de l’historique", de: "Verlaufsansicht", zh: "历史视图", ja: "履歴表示" },
  "dashboard.gridView": { en: "Grid view", pt: "Visualização em grade", es: "Vista de cuadrícula", fr: "Vue en grille", de: "Rasteransicht", zh: "网格视图", ja: "グリッド表示" },
  "dashboard.tableView": { en: "Table view", pt: "Visualização em tabela", es: "Vista de tabla", fr: "Vue en tableau", de: "Tabellenansicht", zh: "表格视图", ja: "テーブル表示" },
  "dashboard.loading": { en: "Loading history…", pt: "Carregando histórico…", es: "Cargando historial…", fr: "Chargement de l’historique…", de: "Verlauf wird geladen…", zh: "正在加载历史记录…", ja: "履歴を読み込み中…" },
  "dashboard.emptyTitle": { en: "No annotation sessions found", pt: "Nenhuma sessão de anotação encontrada", es: "No se encontraron sesiones de anotación", fr: "Aucune session d’annotation trouvée", de: "Keine Anmerkungssitzungen gefunden", zh: "未找到注释会话", ja: "注釈セッションが見つかりません" },
  "dashboard.emptyDescription": { en: "Use the Pinar extension to annotate a page. New sessions will appear here.", pt: "Use a extensão Pinar para anotar uma página. As novas sessões aparecerão aqui.", es: "Usa la extensión Pinar para anotar una página. Las nuevas sesiones aparecerán aquí.", fr: "Utilisez l’extension Pinar pour annoter une page. Les nouvelles sessions apparaîtront ici.", de: "Nutze die Pinar-Erweiterung, um eine Seite zu annotieren. Neue Sitzungen erscheinen hier.", zh: "使用 Pinar 扩展为页面添加注释，新会话会显示在这里。", ja: "Pinar 拡張機能でページに注釈を付けると、新しいセッションがここに表示されます。" },
  "dashboard.untitled": { en: "Untitled page", pt: "Página sem título", es: "Página sin título", fr: "Page sans titre", de: "Unbenannte Seite", zh: "无标题页面", ja: "無題のページ" },
  "dashboard.session": { en: "Session", pt: "Sessão", es: "Sesión", fr: "Session", de: "Sitzung", zh: "会话", ja: "セッション" },
  "dashboard.created": { en: "Created", pt: "Criada em", es: "Creada", fr: "Créée", de: "Erstellt", zh: "创建时间", ja: "作成日時" },
  "dashboard.pins": { en: "Pins", pt: "Pins", es: "Pines", fr: "Pins", de: "Pins", zh: "标记", ja: "ピン" },
  "dashboard.actions": { en: "Actions", pt: "Ações", es: "Acciones", fr: "Actions", de: "Aktionen", zh: "操作", ja: "操作" },
  "dashboard.columns": { en: "Columns", pt: "Colunas", es: "Columnas", fr: "Colonnes", de: "Spalten", zh: "列", ja: "列" },
  "dashboard.clearFilter": { en: "Clear filter", pt: "Limpar filtro", es: "Limpiar filtro", fr: "Effacer le filtre", de: "Filter löschen", zh: "清除筛选", ja: "フィルターを解除" },
  "dashboard.nextPage": { en: "Next page", pt: "Próxima página", es: "Página siguiente", fr: "Page suivante", de: "Nächste Seite", zh: "下一页", ja: "次のページ" },
  "dashboard.pageStatus": { en: "Page {page} of {pageCount}", pt: "Página {page} de {pageCount}", es: "Página {page} de {pageCount}", fr: "Page {page} sur {pageCount}", de: "Seite {page} von {pageCount}", zh: "第 {page} 页，共 {pageCount} 页", ja: "{page} / {pageCount} ページ" },
  "dashboard.previousPage": { en: "Previous page", pt: "Página anterior", es: "Página anterior", fr: "Page précédente", de: "Vorherige Seite", zh: "上一页", ja: "前のページ" },
  "dashboard.resetFilters": { en: "Reset filters", pt: "Limpar filtros", es: "Restablecer filtros", fr: "Réinitialiser les filtres", de: "Filter zurücksetzen", zh: "重置筛选", ja: "フィルターをリセット" },
  "dashboard.sessionsPerPage": { en: "Sessions per page", pt: "Sessões por página", es: "Sesiones por página", fr: "Sessions par page", de: "Sitzungen pro Seite", zh: "每页会话数", ja: "1ページあたりのセッション数" },
  "dashboard.onePin": { en: "1 pin", pt: "1 pin", es: "1 pin", fr: "1 pin", de: "1 Pin", zh: "1 个标记", ja: "1 ピン" },
  "dashboard.twoToFivePins": { en: "2–5 pins", pt: "2–5 pins", es: "2–5 pines", fr: "2–5 pins", de: "2–5 Pins", zh: "2–5 个标记", ja: "2～5 ピン" },
  "dashboard.sixOrMorePins": { en: "6+ pins", pt: "6+ pins", es: "6+ pines", fr: "6+ pins", de: "6+ Pins", zh: "6 个以上标记", ja: "6 ピン以上" },
  "dashboard.filteredEmpty": { en: "No sessions match these filters.", pt: "Nenhuma sessão corresponde a estes filtros.", es: "Ninguna sesión coincide con estos filtros.", fr: "Aucune session ne correspond à ces filtres.", de: "Keine Sitzung entspricht diesen Filtern.", zh: "没有符合这些筛选条件的会话。", ja: "これらのフィルターに一致するセッションはありません。" },
  "dashboard.pinCount": { en: "{count} {label}", pt: "{count} {label}", es: "{count} {label}", fr: "{count} {label}", de: "{count} {label}", zh: "{count} 个{label}", ja: "{count} {label}" },
  "dashboard.pinSingular": { en: "pin", pt: "pin", es: "pin", fr: "pin", de: "Pin", zh: "标记", ja: "ピン" },
  "dashboard.pinPlural": { en: "pins", pt: "pins", es: "pines", fr: "pins", de: "Pins", zh: "标记", ja: "ピン" },
  "dashboard.moreActions": { en: "More session actions", pt: "Mais ações da sessão", es: "Más acciones de la sesión", fr: "Plus d’actions pour la session", de: "Weitere Sitzungsaktionen", zh: "更多会话操作", ja: "その他のセッション操作" },
  "dashboard.view": { en: "View", pt: "Visualizar", es: "Ver", fr: "Voir", de: "Ansehen", zh: "查看", ja: "表示" },
  "dashboard.markdown": { en: "Markdown", pt: "Markdown", es: "Markdown", fr: "Markdown", de: "Markdown", zh: "Markdown", ja: "Markdown" },
  "dashboard.copyPrompt": { en: "Copy prompt", pt: "Copiar prompt", es: "Copiar prompt", fr: "Copier le prompt", de: "Prompt kopieren", zh: "复制提示词", ja: "プロンプトをコピー" },
  "dashboard.deleteSession": { en: "Delete session", pt: "Excluir sessão", es: "Eliminar sesión", fr: "Supprimer la session", de: "Sitzung löschen", zh: "删除会话", ja: "セッションを削除" },
  "dashboard.openViewer": { en: "Open viewer", pt: "Abrir viewer", es: "Abrir visor", fr: "Ouvrir le visualiseur", de: "Viewer öffnen", zh: "打开查看器", ja: "ビューアーを開く" },
  "dashboard.screenshot": { en: "Screenshot", pt: "Screenshot", es: "Captura de pantalla", fr: "Capture d’écran", de: "Screenshot", zh: "截图", ja: "スクリーンショット" },
  "dashboard.deleteTitle": { en: "Delete this annotation session?", pt: "Excluir esta sessão de anotação?", es: "¿Eliminar esta sesión de anotación?", fr: "Supprimer cette session d’annotation ?", de: "Diese Anmerkungssitzung löschen?", zh: "删除此注释会话？", ja: "この注釈セッションを削除しますか？" },
  "dashboard.deleteDescription": { en: "The screenshot and its pins will be permanently removed.", pt: "O screenshot e seus pins serão removidos permanentemente.", es: "La captura y sus pines se eliminarán permanentemente.", fr: "La capture et ses pins seront définitivement supprimés.", de: "Der Screenshot und seine Pins werden dauerhaft entfernt.", zh: "截图及其标记将被永久删除。", ja: "スクリーンショットとピンは完全に削除されます。" },
  "dashboard.delete": { en: "Delete", pt: "Excluir", es: "Eliminar", fr: "Supprimer", de: "Löschen", zh: "删除", ja: "削除" },
  "dashboard.allSessions": { en: "All sessions", pt: "Todas as sessões", es: "Todas las sesiones", fr: "Toutes les sessions", de: "Alle Sitzungen", zh: "所有会话", ja: "すべてのセッション" },
  "dashboard.collection": { en: "collection", pt: "coleção", es: "colección", fr: "collection", de: "Sammlung", zh: "集合", ja: "コレクション" },
  "dashboard.collectionActions": { en: "Collection actions", pt: "Ações da coleção", es: "Acciones de la colección", fr: "Actions de la collection", de: "Sammlungsaktionen", zh: "集合操作", ja: "コレクション操作" },
  "dashboard.collectionMenu": { en: "Collection", pt: "Coleção", es: "Colección", fr: "Collection", de: "Sammlung", zh: "集合", ja: "コレクション" },
  "dashboard.collections": { en: "Collections", pt: "Coleções", es: "Colecciones", fr: "Collections", de: "Sammlungen", zh: "集合", ja: "コレクション" },
  "dashboard.create": { en: "Create", pt: "Criar", es: "Crear", fr: "Créer", de: "Erstellen", zh: "创建", ja: "作成" },
  "dashboard.deleteCollection": { en: "Delete collection", pt: "Excluir coleção", es: "Eliminar colección", fr: "Supprimer la collection", de: "Sammlung löschen", zh: "删除集合", ja: "コレクションを削除" },
  "dashboard.deleteContainerConfirm": { en: "Delete this {kind}? Its sessions will move to Personal / Inbox.", pt: "Excluir este item ({kind})? As sessões serão movidas para Personal / Inbox.", es: "¿Eliminar esta {kind}? Sus sesiones se moverán a Personal / Inbox.", fr: "Supprimer cette {kind} ? Ses sessions seront déplacées vers Personal / Inbox.", de: "Diese {kind} löschen? Die Sitzungen werden nach Personal / Inbox verschoben.", zh: "删除此{kind}？其中的会话将移至 Personal / Inbox。", ja: "この{kind}を削除しますか？セッションは Personal / Inbox に移動されます。" },
  "dashboard.deleteProject": { en: "Delete project", pt: "Excluir projeto", es: "Eliminar proyecto", fr: "Supprimer le projet", de: "Projekt löschen", zh: "删除项目", ja: "プロジェクトを削除" },
  "dashboard.editProject": { en: "Edit project", pt: "Editar projeto", es: "Editar proyecto", fr: "Modifier le projet", de: "Projekt bearbeiten", zh: "编辑项目", ja: "プロジェクトを編集" },
  "dashboard.moveToCollection": { en: "Move to collection", pt: "Mover para coleção", es: "Mover a colección", fr: "Déplacer vers une collection", de: "In Sammlung verschieben", zh: "移至集合", ja: "コレクションへ移動" },
  "dashboard.newCollection": { en: "New collection", pt: "Nova coleção", es: "Nueva colección", fr: "Nouvelle collection", de: "Neue Sammlung", zh: "新建集合", ja: "新しいコレクション" },
  "dashboard.newProject": { en: "New project", pt: "Novo projeto", es: "Nuevo proyecto", fr: "Nouveau projet", de: "Neues Projekt", zh: "新建项目", ja: "新しいプロジェクト" },
  "dashboard.newSubcollection": { en: "New nested collection", pt: "Nova subcoleção", es: "Nueva subcolección", fr: "Nouvelle sous-collection", de: "Neue Untersammlung", zh: "新建子集合", ja: "新しいサブコレクション" },
  "dashboard.name": { en: "Name", pt: "Nome", es: "Nombre", fr: "Nom", de: "Name", zh: "名称", ja: "名前" },
  "dashboard.project": { en: "project", pt: "projeto", es: "proyecto", fr: "projet", de: "Projekt", zh: "项目", ja: "プロジェクト" },
  "dashboard.projectActions": { en: "Project actions", pt: "Ações do projeto", es: "Acciones del proyecto", fr: "Actions du projet", de: "Projektaktionen", zh: "项目操作", ja: "プロジェクト操作" },
  "dashboard.projectIcon": { en: "Project icon", pt: "Ícone do projeto", es: "Icono del proyecto", fr: "Icône du projet", de: "Projektsymbol", zh: "项目图标", ja: "プロジェクトアイコン" },
  "dashboard.noProjectIcons": { en: "No icons found.", pt: "Nenhum ícone encontrado.", es: "No se encontraron iconos.", fr: "Aucune icône trouvée.", de: "Keine Symbole gefunden.", zh: "未找到图标。", ja: "アイコンが見つかりません。" },
  "dashboard.searchProjectIcons": { en: "Search icons...", pt: "Buscar ícones...", es: "Buscar iconos...", fr: "Rechercher des icônes...", de: "Symbole suchen...", zh: "搜索图标...", ja: "アイコンを検索..." },
  "dashboard.rename": { en: "Rename", pt: "Renomear", es: "Renombrar", fr: "Renommer", de: "Umbenennen", zh: "重命名", ja: "名前を変更" },
  "dashboard.renamePrompt": { en: "Rename {kind}", pt: "Renomear {kind}", es: "Renombrar {kind}", fr: "Renommer {kind}", de: "{kind} umbenennen", zh: "重命名{kind}", ja: "{kind}の名前を変更" },
  "dashboard.remove": { en: "Remove", pt: "Remover", es: "Quitar", fr: "Retirer", de: "Entfernen", zh: "移除", ja: "削除" },
  "dashboard.save": { en: "Save", pt: "Salvar", es: "Guardar", fr: "Enregistrer", de: "Speichern", zh: "保存", ja: "保存" },
  "dashboard.share": { en: "Share", pt: "Compartilhar", es: "Compartir", fr: "Partager", de: "Teilen", zh: "分享", ja: "共有" },

  "aggregate.copyMarkdown": { en: "Copy Markdown", pt: "Copiar Markdown", es: "Copiar Markdown", fr: "Copier le Markdown", de: "Markdown kopieren", zh: "复制 Markdown", ja: "Markdown をコピー" },
  "aggregate.loading": { en: "Loading…", pt: "Carregando…", es: "Cargando…", fr: "Chargement…", de: "Wird geladen…", zh: "正在加载…", ja: "読み込み中…" },
  "aggregate.noSessions": { en: "No sessions in this collection.", pt: "Nenhuma sessão nesta coleção.", es: "No hay sesiones en esta colección.", fr: "Aucune session dans cette collection.", de: "Keine Sitzungen in dieser Sammlung.", zh: "此集合中没有会话。", ja: "このコレクションにはセッションがありません。" },
  "aggregate.notFound": { en: "{kind} not found", pt: "{kind} não encontrado(a)", es: "No se encontró {kind}", fr: "{kind} introuvable", de: "{kind} nicht gefunden", zh: "未找到{kind}", ja: "{kind}が見つかりません" },
  "aggregate.open": { en: "Open", pt: "Abrir", es: "Abrir", fr: "Ouvrir", de: "Öffnen", zh: "打开", ja: "開く" },
  "aggregate.sessionCount": { en: "{count} {label}", pt: "{count} {label}", es: "{count} {label}", fr: "{count} {label}", de: "{count} {label}", zh: "{count} 个{label}", ja: "{count} {label}" },
  "aggregate.sessionPlural": { en: "sessions", pt: "sessões", es: "sesiones", fr: "sessions", de: "Sitzungen", zh: "会话", ja: "セッション" },
  "aggregate.sessionSingular": { en: "session", pt: "sessão", es: "sesión", fr: "session", de: "Sitzung", zh: "会话", ja: "セッション" },

  "viewer.loading": { en: "Loading viewer…", pt: "Carregando viewer…", es: "Cargando visor…", fr: "Chargement du visualiseur…", de: "Viewer wird geladen…", zh: "正在加载查看器…", ja: "ビューアーを読み込み中…" },
  "viewer.notFound": { en: "Annotation session not found", pt: "Sessão de anotação não encontrada", es: "Sesión de anotación no encontrada", fr: "Session d’annotation introuvable", de: "Anmerkungssitzung nicht gefunden", zh: "未找到注释会话", ja: "注釈セッションが見つかりません" },
  "viewer.backHistory": { en: "Back to dashboard", pt: "Voltar ao painel", es: "Volver al panel", fr: "Retour au tableau de bord", de: "Zurück zur Übersicht", zh: "返回控制面板", ja: "ダッシュボードに戻る" },
  "viewer.pageActions": { en: "Page actions", pt: "Ações da página", es: "Acciones de página", fr: "Actions de la page", de: "Seitenaktionen", zh: "页面操作", ja: "ページ操作" },
  "viewer.copyPage": { en: "Copy Page", pt: "Copiar página", es: "Copiar página", fr: "Copier la page", de: "Seite kopieren", zh: "复制页面", ja: "ページをコピー" },
  "viewer.moreActions": { en: "More page actions", pt: "Mais ações da página", es: "Más acciones de página", fr: "Plus d’actions pour la page", de: "Weitere Seitenaktionen", zh: "更多页面操作", ja: "その他のページ操作" },
  "viewer.hidePins": { en: "Hide pins sidebar", pt: "Ocultar lateral de pins", es: "Ocultar barra lateral de pins", fr: "Masquer la barre latérale des pins", de: "Pin-Seitenleiste ausblenden", zh: "隐藏标记侧栏", ja: "ピンサイドバーを非表示" },
  "viewer.showPins": { en: "Show pins sidebar", pt: "Exibir lateral de pins", es: "Mostrar barra lateral de pins", fr: "Afficher la barre latérale des pins", de: "Pin-Seitenleiste anzeigen", zh: "显示标记侧栏", ja: "ピンサイドバーを表示" },
  "viewer.viewMarkdown": { en: "View as Markdown", pt: "Ver como Markdown", es: "Ver como Markdown", fr: "Afficher en Markdown", de: "Als Markdown anzeigen", zh: "以 Markdown 查看", ja: "Markdown で表示" },
  "viewer.openChatGPT": { en: "Open in ChatGPT", pt: "Abrir no ChatGPT", es: "Abrir en ChatGPT", fr: "Ouvrir dans ChatGPT", de: "In ChatGPT öffnen", zh: "在 ChatGPT 中打开", ja: "ChatGPT で開く" },
  "viewer.openClaude": { en: "Open in Claude", pt: "Abrir no Claude", es: "Abrir en Claude", fr: "Ouvrir dans Claude", de: "In Claude öffnen", zh: "在 Claude 中打开", ja: "Claude で開く" },
  "viewer.annotation": { en: "Annotation", pt: "Anotação", es: "Anotación", fr: "Annotation", de: "Anmerkung", zh: "注释", ja: "注釈" },
  "viewer.retention": { en: "7-day retention", pt: "Retenção de 7 dias", es: "Retención de 7 días", fr: "Conservation de 7 jours", de: "7 Tage Aufbewahrung", zh: "保留 7 天", ja: "7日間保存" },
  "viewer.openZoom": { en: "Open screenshot zoom", pt: "Ampliar screenshot", es: "Ampliar captura", fr: "Agrandir la capture", de: "Screenshot vergrößern", zh: "放大截图", ja: "スクリーンショットを拡大" },
  "viewer.annotatedScreenshot": { en: "Annotated page screenshot", pt: "Screenshot anotado da página", es: "Captura anotada de la página", fr: "Capture annotée de la page", de: "Kommentierter Seiten-Screenshot", zh: "带注释的页面截图", ja: "注釈付きページスクリーンショット" },
  "viewer.screenshotUnavailable": { en: "Screenshot unavailable", pt: "Screenshot indisponível", es: "Captura no disponible", fr: "Capture indisponible", de: "Screenshot nicht verfügbar", zh: "截图不可用", ja: "スクリーンショットを利用できません" },
  "viewer.openPin": { en: "Open pin {number}", pt: "Abrir pin {number}", es: "Abrir pin {number}", fr: "Ouvrir le pin {number}", de: "Pin {number} öffnen", zh: "打开标记 {number}", ja: "ピン {number} を開く" },
  "viewer.areaSelection": { en: "Area selection", pt: "Seleção de área", es: "Selección de área", fr: "Sélection de zone", de: "Bereichsauswahl", zh: "区域选择", ja: "範囲選択" },
  "viewer.element": { en: "Element", pt: "Elemento", es: "Elemento", fr: "Élément", de: "Element", zh: "元素", ja: "要素" },
  "viewer.pinTitle": { en: "Pin {number}", pt: "Pin {number}", es: "Pin {number}", fr: "Pin {number}", de: "Pin {number}", zh: "标记 {number}", ja: "ピン {number}" },
  "viewer.completeContext": { en: "Complete annotation context", pt: "Contexto completo da anotação", es: "Contexto completo de la anotación", fr: "Contexte complet de l’annotation", de: "Vollständiger Anmerkungskontext", zh: "完整注释上下文", ja: "注釈の完全なコンテキスト" },
  "viewer.preview": { en: "Preview", pt: "Visualização", es: "Vista previa", fr: "Aperçu", de: "Vorschau", zh: "预览", ja: "プレビュー" },
  "viewer.raw": { en: "Raw", pt: "Markdown", es: "Markdown", fr: "Markdown", de: "Markdown", zh: "Markdown 源文", ja: "Markdown" },
  "viewer.reviewPrompt": { en: "Review this annotated page: {url}", pt: "Revise esta página anotada: {url}", es: "Revisa esta página anotada: {url}", fr: "Examinez cette page annotée : {url}", de: "Prüfe diese kommentierte Seite: {url}", zh: "请审查这个带注释的页面：{url}", ja: "この注釈付きページを確認してください: {url}" },

  "pricing.badge": { en: "Pinar Pro & Sponsors", pt: "Pinar Pro e apoiadores", es: "Pinar Pro y patrocinadores", fr: "Pinar Pro et sponsors", de: "Pinar Pro und Unterstützer", zh: "Pinar Pro 与赞助者", ja: "Pinar Pro とスポンサー" },
  "pricing.title": { en: "Keep every bug & visual feedback forever", pt: "Guarde cada bug e feedback visual para sempre", es: "Conserva cada bug y feedback visual para siempre", fr: "Conservez chaque bug et retour visuel pour toujours", de: "Bewahre jeden Bug und jedes visuelle Feedback dauerhaft", zh: "永久保存每个缺陷与视觉反馈", ja: "すべてのバグとビジュアルフィードバックを永久保存" },
  "pricing.description": { en: "Supercharge Pinar with unlimited permanent retention, dedicated cloud storage, and interactive web links that never break.", pt: "Potencialize o Pinar com retenção permanente ilimitada, armazenamento dedicado na nuvem e links interativos que nunca expiram.", es: "Potencia Pinar con retención permanente ilimitada, almacenamiento dedicado en la nube y enlaces interactivos que nunca caducan.", fr: "Boostez Pinar avec une conservation permanente illimitée, un stockage cloud dédié et des liens interactifs qui n’expirent jamais.", de: "Erweitere Pinar um unbegrenzte dauerhafte Aufbewahrung, dedizierten Cloud-Speicher und interaktive Links ohne Ablaufdatum.", zh: "通过无限永久保留、专属云存储和永不过期的交互链接增强 Pinar。", ja: "無制限の永久保存、専用クラウドストレージ、期限切れにならないインタラクティブリンクで Pinar を強化します。" },
  "pricing.billingInterval": { en: "Billing interval", pt: "Período de cobrança", es: "Periodo de facturación", fr: "Période de facturation", de: "Abrechnungszeitraum", zh: "计费周期", ja: "請求間隔" },
  "pricing.monthly": { en: "Monthly", pt: "Mensal", es: "Mensual", fr: "Mensuel", de: "Monatlich", zh: "按月", ja: "月払い" },
  "pricing.yearly": { en: "Yearly", pt: "Anual", es: "Anual", fr: "Annuel", de: "Jährlich", zh: "按年", ja: "年払い" },
  "pricing.save45": { en: "Save 45%", pt: "Economize 45%", es: "Ahorra 45%", fr: "Économisez 45 %", de: "45 % sparen", zh: "节省 45%", ja: "45% お得" },
  "pricing.free": { en: "Free", pt: "Gratuito", es: "Gratis", fr: "Gratuit", de: "Kostenlos", zh: "免费", ja: "無料" },
  "pricing.freeDescription": { en: "100% private local development and quick testing.", pt: "Desenvolvimento local 100% privado e testes rápidos.", es: "Desarrollo local 100 % privado y pruebas rápidas.", fr: "Développement local 100 % privé et tests rapides.", de: "100 % private lokale Entwicklung und schnelle Tests.", zh: "100% 私密的本地开发与快速测试。", ja: "100% プライベートなローカル開発と迅速なテスト。" },
  "pricing.forever": { en: "forever", pt: "para sempre", es: "para siempre", fr: "pour toujours", de: "für immer", zh: "永久免费", ja: "永久" },
  "pricing.freeLocal": { en: "100% Free Local Server & CLI", pt: "Servidor local e CLI 100% gratuitos", es: "Servidor local y CLI 100 % gratuitos", fr: "Serveur local et CLI 100 % gratuits", de: "100 % kostenloser lokaler Server und CLI", zh: "100% 免费的本地服务器与 CLI", ja: "100% 無料のローカルサーバーと CLI" },
  "pricing.freeRetention": { en: "7-Day Cloud Retention", pt: "Retenção de 7 dias na nuvem", es: "Retención de 7 días en la nube", fr: "Conservation cloud de 7 jours", de: "7 Tage Cloud-Aufbewahrung", zh: "云端保留 7 天", ja: "クラウドで7日間保存" },
  "pricing.standardViewer": { en: "Standard Web Viewer", pt: "Web Viewer padrão", es: "Visor web estándar", fr: "Visualiseur web standard", de: "Standard-Web-Viewer", zh: "标准 Web 查看器", ja: "標準 Web ビューアー" },
  "pricing.clipboardPrompts": { en: "One-Click Clipboard AI Prompts", pt: "Prompts para IA com um clique", es: "Prompts para IA con un clic", fr: "Prompts IA copiés en un clic", de: "KI-Prompts mit einem Klick kopieren", zh: "一键复制 AI 提示词", ja: "ワンクリックで AI プロンプトをコピー" },
  "pricing.projectsCollections": { en: "Projects and collections", pt: "Projetos e coleções", es: "Proyectos y colecciones", fr: "Projets et collections", de: "Projekte und Sammlungen", zh: "项目和集合", ja: "プロジェクトとコレクション" },
  "pricing.useFree": { en: "Use Free", pt: "Usar gratuitamente", es: "Usar gratis", fr: "Utiliser gratuitement", de: "Kostenlos nutzen", zh: "免费使用", ja: "無料で使う" },
  "pricing.everythingFreePlus": { en: "Everything in Free, plus:", pt: "Tudo do Gratuito, mais:", es: "Todo lo de Gratis, más:", fr: "Tout ce qui est inclus dans Gratuit, plus :", de: "Alles aus Kostenlos, plus:", zh: "包含免费版的全部功能，另加：", ja: "無料プランの全機能に加えて：" },
  "pricing.everythingProPlus": { en: "Everything in Pro, plus:", pt: "Tudo do Pro, mais:", es: "Todo lo de Pro, más:", fr: "Tout ce qui est inclus dans Pro, plus :", de: "Alles aus Pro, plus:", zh: "包含 Pro 的全部功能，另加：", ja: "Pro プランの全機能に加えて：" },
  "pricing.proYearly": { en: "Pro Yearly", pt: "Pro Anual", es: "Pro Anual", fr: "Pro Annuel", de: "Pro Jährlich", zh: "Pro 年付", ja: "Pro 年払い" },
  "pricing.proMonthly": { en: "Pro Monthly", pt: "Pro Mensal", es: "Pro Mensual", fr: "Pro Mensuel", de: "Pro Monatlich", zh: "Pro 月付", ja: "Pro 月払い" },
  "pricing.proYearlyDescription": { en: "Permanent retention for about {price}/month.", pt: "Retenção permanente por cerca de {price}/mês.", es: "Retención permanente por unos {price}/mes.", fr: "Conservation permanente pour environ {price}/mois.", de: "Dauerhafte Aufbewahrung für etwa {price}/Monat.", zh: "每月约 {price}，即可永久保留。", ja: "月額約{price}で永久保存。" },
  "pricing.proMonthlyDescription": { en: "Permanent retention with flexible monthly billing.", pt: "Retenção permanente com cobrança mensal flexível.", es: "Retención permanente con facturación mensual flexible.", fr: "Conservation permanente avec facturation mensuelle flexible.", de: "Dauerhafte Aufbewahrung mit flexibler monatlicher Abrechnung.", zh: "永久保留，按月灵活计费。", ja: "柔軟な月払いで永久保存。" },
  "pricing.perYear": { en: "/ year", pt: "/ ano", es: "/ año", fr: "/ an", de: "/ Jahr", zh: "/ 年", ja: "/ 年" },
  "pricing.perMonth": { en: "/ month", pt: "/ mês", es: "/ mes", fr: "/ mois", de: "/ Monat", zh: "/ 月", ja: "/ 月" },
  "pricing.redirecting": { en: "Redirecting…", pt: "Redirecionando…", es: "Redirigiendo…", fr: "Redirection…", de: "Weiterleitung…", zh: "正在跳转…", ja: "リダイレクト中…" },
  "pricing.getYearly": { en: "Get Pro Yearly — {price}/yr", pt: "Assinar Pro Anual — {price}/ano", es: "Obtener Pro Anual — {price}/año", fr: "Choisir Pro Annuel — {price}/an", de: "Pro Jährlich — {price}/Jahr", zh: "购买 Pro 年付 — {price}/年", ja: "Pro 年払い — {price}/年" },
  "pricing.getMonthly": { en: "Get Pro Monthly — {price}/mo", pt: "Assinar Pro Mensal — {price}/mês", es: "Obtener Pro Mensual — {price}/mes", fr: "Choisir Pro Mensuel — {price}/mois", de: "Pro Monatlich — {price}/Monat", zh: "购买 Pro 月付 — {price}/月", ja: "Pro 月払い — {price}/月" },
  "pricing.permanentRetention": { en: "Permanent Retention", pt: "Retenção permanente", es: "Retención permanente", fr: "Conservation permanente", de: "Dauerhafte Aufbewahrung", zh: "永久保留", ja: "永久保存" },
  "pricing.neverDeleted": { en: "Never Deleted", pt: "Nunca excluído", es: "Nunca se elimina", fr: "Jamais supprimé", de: "Wird nie gelöscht", zh: "永不删除", ja: "削除されません" },
  "pricing.permanentViewers": { en: "Permanent Web Viewers", pt: "Web Viewers permanentes", es: "Visores web permanentes", fr: "Visualiseurs web permanents", de: "Dauerhafte Web-Viewer", zh: "永久 Web 查看器", ja: "永久 Web ビューアー" },
  "pricing.forPrs": { en: "for PRs", pt: "para PRs", es: "para PR", fr: "pour les PR", de: "für PRs", zh: "用于 PR", ja: "PR 向け" },
  "pricing.storage5": { en: "5 GB Dedicated Cloud Storage", pt: "5 GB de armazenamento dedicado na nuvem", es: "5 GB de almacenamiento dedicado en la nube", fr: "5 Go de stockage cloud dédié", de: "5 GB dedizierter Cloud-Speicher", zh: "5 GB 专属云存储", ja: "5 GB 専用クラウドストレージ" },
  "pricing.searchHistory": { en: "Lifetime Search Across History", pt: "Busca permanente em todo o histórico", es: "Búsqueda permanente en todo el historial", fr: "Recherche permanente dans tout l’historique", de: "Dauerhafte Suche im gesamten Verlauf", zh: "永久搜索全部历史记录", ja: "履歴全体を永久検索" },
  "pricing.lifetime": { en: "Lifetime Deal", pt: "Plano vitalício", es: "Plan vitalicio", fr: "Offre à vie", de: "Lifetime-Angebot", zh: "终身方案", ja: "永久ライセンス" },
  "pricing.lifetimeDescription": { en: "Pay once, keep forever. No recurring charges.", pt: "Pague uma vez e use para sempre. Sem cobranças recorrentes.", es: "Paga una vez y úsalo para siempre. Sin cargos recurrentes.", fr: "Payez une fois, gardez-le pour toujours. Aucun paiement récurrent.", de: "Einmal zahlen, dauerhaft nutzen. Keine wiederkehrenden Kosten.", zh: "一次付费，永久使用，无周期性费用。", ja: "一度の支払いで永久利用。継続課金はありません。" },
  "pricing.oneTime": { en: "one-time payment", pt: "pagamento único", es: "pago único", fr: "paiement unique", de: "Einmalzahlung", zh: "一次性付款", ja: "一括払い" },
  "pricing.lifetimeAccess": { en: "Lifetime Pro Access", pt: "Acesso Pro vitalício", es: "Acceso Pro vitalicio", fr: "Accès Pro à vie", de: "Lebenslanger Pro-Zugang", zh: "终身 Pro 权限", ja: "Pro を永久利用" },
  "pricing.noSubscriptions": { en: "No Subscriptions", pt: "Sem assinaturas", es: "Sin suscripciones", fr: "Sans abonnement", de: "Keine Abonnements", zh: "无需订阅", ja: "サブスクリプション不要" },
  "pricing.earlyAccess": { en: "Early access to new Pro features", pt: "Acesso antecipado a novas funcionalidades Pro", es: "Acceso anticipado a nuevas funciones Pro", fr: "Accès anticipé aux nouvelles fonctionnalités Pro", de: "Frühzeitiger Zugriff auf neue Pro-Funktionen", zh: "提前体验新的 Pro 功能", ja: "新しい Pro 機能への先行アクセス" },
  "pricing.unbrandedViewers": { en: "Unbranded Web Viewers", pt: "Web Viewers sem a marca Pinar", es: "Visores web sin la marca Pinar", fr: "Web Viewers sans la marque Pinar", de: "Web-Viewer ohne Pinar-Branding", zh: "无 Pinar 品牌标识的 Web 查看器", ja: "Pinar ブランドなしの Web ビューアー" },
  "pricing.getLifetime": { en: "Get Lifetime Pro — {price}", pt: "Obter Pro vitalício — {price}", es: "Obtener Pro vitalicio — {price}", fr: "Obtenir Pro à vie — {price}", de: "Lifetime Pro — {price}", zh: "购买终身 Pro — {price}", ja: "永久 Pro — {price}" },
  "pricing.originalPrice": { en: "Original price", pt: "Preço original", es: "Precio original", fr: "Prix initial", de: "Ursprünglicher Preis", zh: "原价", ja: "通常価格" },
  "pricing.regionalBrazil": { en: "Brazil regional price · {discount}% off", pt: "Preço regional para o Brasil · {discount}% de desconto", es: "Precio regional para Brasil · {discount}% de descuento", fr: "Tarif régional pour le Brésil · {discount} % de réduction", de: "Regionalpreis für Brasilien · {discount} % Rabatt", zh: "巴西地区价格 · 优惠 {discount}%", ja: "ブラジル地域価格 · {discount}% オフ" },
  "pricing.earlyBird": { en: "EARLY BIRD", pt: "OFERTA INICIAL", es: "OFERTA INICIAL", fr: "OFFRE DE LANCEMENT", de: "FRÜHBUCHER", zh: "早鸟优惠", ja: "早期割引" },
  "pricing.supportTitle": { en: "Support via Open Source Sponsorship", pt: "Apoie por meio do patrocínio open source", es: "Apoya mediante patrocinio open source", fr: "Soutenez via le sponsoring open source", de: "Unterstützung durch Open-Source-Sponsoring", zh: "通过开源赞助支持我们", ja: "オープンソーススポンサーで支援" },
  "pricing.supportDescription": { en: "Prefer supporting open-source development directly? Sponsor on GitHub or buy a coffee.", pt: "Prefere apoiar diretamente o desenvolvimento open source? Patrocine no GitHub ou pague um café.", es: "¿Prefieres apoyar directamente el desarrollo open source? Patrocina en GitHub o invita un café.", fr: "Vous préférez soutenir directement le développement open source ? Sponsorisez sur GitHub ou offrez un café.", de: "Möchtest du die Open-Source-Entwicklung direkt unterstützen? Sponsere auf GitHub oder spendiere einen Kaffee.", zh: "想直接支持开源开发？可在 GitHub 赞助或请我们喝杯咖啡。", ja: "オープンソース開発を直接支援しますか？GitHub スポンサーまたはコーヒーで応援できます。" },
  "pricing.supportThanksDescription": { en: "Your subscription helps keep Pinar independent and continuously improving.", pt: "Sua assinatura ajuda a manter o Pinar independente e em constante evolução.", es: "Tu suscripción ayuda a mantener Pinar independiente y en constante evolución.", fr: "Votre abonnement aide Pinar à rester indépendant et à évoluer continuellement.", de: "Dein Abonnement hilft, Pinar unabhängig zu halten und kontinuierlich weiterzuentwickeln.", zh: "您的订阅帮助 Pinar 保持独立并持续改进。", ja: "あなたのサブスクリプションが、Pinar の独立性と継続的な改善を支えています。" },
  "pricing.supportThanksTitle": { en: "Thank you for supporting Pinar", pt: "Obrigado por apoiar o Pinar", es: "Gracias por apoyar Pinar", fr: "Merci de soutenir Pinar", de: "Danke für deine Unterstützung von Pinar", zh: "感谢您支持 Pinar", ja: "Pinar を支援していただきありがとうございます" },
  "pricing.sponsorGitHub": { en: "Sponsor on GitHub", pt: "Apoiar no GitHub", es: "Patrocinar en GitHub", fr: "Sponsoriser sur GitHub", de: "Auf GitHub sponsern", zh: "在 GitHub 赞助", ja: "GitHub でスポンサー" },
  "pricing.buyCoffee": { en: "Buy Me a Coffee", pt: "Pague um café", es: "Invítame un café", fr: "Offrir un café", de: "Kaffee spendieren", zh: "请我喝咖啡", ja: "コーヒーを贈る" },
  "pricing.secureCheckout": { en: "Secure checkout powered by Stripe", pt: "Checkout seguro processado pela Stripe", es: "Pago seguro procesado por Stripe", fr: "Paiement sécurisé par Stripe", de: "Sichere Zahlung über Stripe", zh: "由 Stripe 提供安全结账", ja: "Stripe による安全な決済" },
  "pricing.cancelAnytime": { en: "Cancel anytime with 1 click", pt: "Cancele a qualquer momento com um clique", es: "Cancela en cualquier momento con un clic", fr: "Annulez à tout moment en un clic", de: "Jederzeit mit einem Klick kündbar", zh: "一键随时取消", ja: "ワンクリックでいつでも解約" },
  "pricing.checkoutFailed": { en: "Failed to initialize checkout", pt: "Não foi possível iniciar o checkout", es: "No se pudo iniciar el pago", fr: "Impossible de démarrer le paiement", de: "Checkout konnte nicht gestartet werden", zh: "无法启动结账", ja: "決済を開始できませんでした" },
  "pricing.checkoutUnavailable": { en: "Checkout is temporarily unavailable. Please try again later.", pt: "O checkout está temporariamente indisponível. Tente novamente mais tarde.", es: "El pago no está disponible temporalmente. Inténtalo de nuevo más tarde.", fr: "Le paiement est temporairement indisponible. Réessayez plus tard.", de: "Der Checkout ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.", zh: "结账服务暂时不可用，请稍后再试。", ja: "決済は一時的に利用できません。後でもう一度お試しください。" },
  "pricing.networkError": { en: "Network error", pt: "Erro de rede", es: "Error de red", fr: "Erreur réseau", de: "Netzwerkfehler", zh: "网络错误", ja: "ネットワークエラー" },

  "success.checkoutFailed": { en: "Checkout activation failed", pt: "Falha ao ativar a compra", es: "Error al activar la compra", fr: "Échec de l’activation de l’achat", de: "Checkout-Aktivierung fehlgeschlagen", zh: "购买激活失败", ja: "購入の有効化に失敗しました" },
  "success.sessionMissing": { en: "Checkout session is missing", pt: "A sessão de checkout está ausente", es: "Falta la sesión de pago", fr: "La session de paiement est absente", de: "Checkout-Sitzung fehlt", zh: "缺少结账会话", ja: "決済セッションがありません" },
  "success.confirmed": { en: "Payment confirmed", pt: "Pagamento confirmado", es: "Pago confirmado", fr: "Paiement confirmé", de: "Zahlung bestätigt", zh: "付款已确认", ja: "支払いが確認されました" },
  "success.ready": { en: "Your permanent cloud retention is ready.", pt: "Sua retenção permanente na nuvem está pronta.", es: "Tu retención permanente en la nube está lista.", fr: "Votre conservation permanente dans le cloud est prête.", de: "Deine dauerhafte Cloud-Aufbewahrung ist bereit.", zh: "永久云端保留已启用。", ja: "クラウドでの永久保存が利用可能になりました。" },
  "success.planReady": { en: "Your {plan} plan is active", pt: "Seu plano {plan} está ativo", es: "Tu plan {plan} está activo", fr: "Votre forfait {plan} est actif", de: "Dein {plan}-Tarif ist aktiv", zh: "您的 {plan} 方案已激活", ja: "{plan} プランが有効になりました" },
  "success.accountFor": { en: "Signed in as {email}", pt: "Conta conectada: {email}", es: "Sesión iniciada como {email}", fr: "Connecté en tant que {email}", de: "Angemeldet als {email}", zh: "已登录为 {email}", ja: "{email} としてログイン中" },
  "success.activating": { en: "Activating your subscription…", pt: "Ativando sua assinatura…", es: "Activando tu suscripción…", fr: "Activation de votre abonnement…", de: "Dein Abonnement wird aktiviert…", zh: "正在激活订阅…", ja: "サブスクリプションを有効化中…" },

  "zoom.screenshot": { en: "Screenshot", pt: "Screenshot", es: "Captura de pantalla", fr: "Capture d’écran", de: "Screenshot", zh: "截图", ja: "スクリーンショット" },
  "zoom.out": { en: "Zoom out", pt: "Diminuir zoom", es: "Alejar", fr: "Dézoomer", de: "Verkleinern", zh: "缩小", ja: "縮小" },
  "zoom.in": { en: "Zoom in", pt: "Aumentar zoom", es: "Acercar", fr: "Zoomer", de: "Vergrößern", zh: "放大", ja: "拡大" },
  "zoom.reset": { en: "Reset zoom", pt: "Redefinir zoom", es: "Restablecer zoom", fr: "Réinitialiser le zoom", de: "Zoom zurücksetzen", zh: "重置缩放", ja: "ズームをリセット" },
} as const satisfies Record<string, LocalizedMessage>;

export type ServerMessageKey = keyof typeof messages;

interface ServerI18nValue {
  language: SupportedLanguage;
  languageName: (language: SupportedLanguage) => string;
  setLanguage: (language: SupportedLanguage) => void;
  t: (key: ServerMessageKey, values?: Record<string, string | number>) => string;
}

const ServerI18nContext = createContext<ServerI18nValue | null>(null);
const LANGUAGE_STORAGE_KEY = "pinar-language";

function isSupportedLanguage(value: string | null): value is SupportedLanguage {
  return Boolean(value && SERVER_LANGUAGES.includes(value as SupportedLanguage));
}

function formatMessage(template: string, values?: Record<string, string | number>) {
  if (!values) return template;
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export function ServerI18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>("en");

  const updateLanguage = useCallback((nextLanguage: SupportedLanguage) => {
    setLanguageState(nextLanguage);
    if (typeof document !== "undefined") document.documentElement.lang = nextLanguage;
  }, []);

  const setLanguage = useCallback((nextLanguage: SupportedLanguage) => {
    updateLanguage(nextLanguage);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
  }, [updateLanguage]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("lang");
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const preferred = isSupportedLanguage(stored) ? stored : isSupportedLanguage(requested) ? requested : undefined;
    updateLanguage(getBestLanguage(preferred));
  }, [updateLanguage]);

  const value = useMemo<ServerI18nValue>(() => ({
    language,
    languageName: (candidate) => translations[candidate].name,
    setLanguage,
    t: (key, values) => formatMessage(messages[key][language], values),
  }), [language, setLanguage]);

  return <ServerI18nContext.Provider value={value}>{children}</ServerI18nContext.Provider>;
}

export function useServerI18n() {
  const context = useContext(ServerI18nContext);
  if (!context) throw new Error("useServerI18n must be used inside ServerI18nProvider");
  return context;
}
