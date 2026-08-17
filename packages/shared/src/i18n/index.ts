import type { SupportedLanguage } from "../types/index.js";

export interface TranslationDictionary {
  capture_destination_label: string;
  context_open_panel: string;
  collection_label: string;
  destination_unavailable: string;
  name: string;
  header_title: string;
  header_desc: string;
  storage_title: string;
  tab_storage: string;
  tab_preferences: string;
  tab_account: string;
  local_title: string;
  local_desc: string;
  remote_title: string;
  remote_desc: string;
  account_title: string;
  account_description: string;
  account_free_description: string;
  account_code_expires: string;
  account_email_title: string;
  account_email_description: string;
  account_email_sent: string;
  account_code_invalid: string;
  account_unavailable: string;
  plan_free_badge: string;
  btn_upgrade_pro: string;
  btn_manage_sub: string;
  btn_sign_out: string;
  btn_open_app: string;
  btn_copy_code: string;
  btn_send_code: string;
  btn_verify_code: string;
  btn_change_email: string;
  preferences_title: string;
  project_label: string;
  no_projects_found: string;
  history_label: string;
  history_desc: string;
  viewer_label: string;
  viewer_desc: string;
  viewer_content_label: string;
  viewer_content_desc: string;
  theme_label: string;
  theme_dark: string;
  theme_light: string;
  theme_system: string;
  language_label: string;
  btn_coffee: string;
  btn_sponsor: string;
  btn_save: string;
  status_saved: string;
  btn_copy: string;
  status_copied: string;
}

export const translations: Record<SupportedLanguage, TranslationDictionary> = {
  en: {
    capture_destination_label: "Capture destination",
    context_open_panel: "Open Panel",
    collection_label: "Collection",
    destination_unavailable: "Projects and collections could not be loaded. Check that the selected server is available and up to date.",
    name: "English",
    header_title: "Pinar Settings",
    header_desc: "Configure storage destination and feedback preferences",
    storage_title: "Storage Destination",
    tab_storage: "Storage",
    tab_preferences: "Preferences",
    tab_account: "Account",
    local_title: "Local Server",
    local_desc: "Everything stays 100% local and private on this device at ~/.pinar/shots/.",
    remote_title: "Remote Server",
    remote_desc: "Uploads to remote server. 7-day retention. Data is never shared or sold.",
    account_title: "Account and plan",
    account_description: "Connect this extension to Pinar or continue with a Free installation.",
    account_free_description: "Open the app automatically or copy a five-minute code for another browser.",
    account_code_expires: "Single-use code. Expires in five minutes.",
    account_email_title: "Paid account",
    account_email_description: "Paid and previously paid accounts can sign in with a code sent by email.",
    account_email_sent: "If this email belongs to an eligible account, a six-digit code is on its way.",
    account_code_invalid: "The code is invalid or expired.",
    account_unavailable: "Account service is unavailable.",
    plan_free_badge: "Free",
    btn_upgrade_pro: "Upgrade to Pro ($19/yr)",
    btn_manage_sub: "Manage Billing",
    btn_sign_out: "Sign out",
    btn_open_app: "Open app",
    btn_copy_code: "Copy temporary code",
    btn_send_code: "Send code",
    btn_verify_code: "Verify",
    btn_change_email: "Use another email",
    preferences_title: "Preferences",
    project_label: "Project",
    no_projects_found: "No projects found.",
    history_label: "Save Annotation History",
    history_desc: "Records past pins, comments, and URLs (7-day retention on remote server).",
    viewer_label: "Copy Web Viewer",
    viewer_desc: "Uses the Web Viewer when sending annotations.",
    viewer_content_label: "Copy Markdown content",
    viewer_content_desc: "When disabled, copies only the Viewer link.",
    theme_label: "Theme",
    theme_dark: "Dark",
    theme_light: "Light",
    theme_system: "System",
    language_label: "Language",
    btn_coffee: "Coffee",
    btn_sponsor: "Sponsor",
    btn_save: "Save",
    status_saved: "Settings saved successfully!",
    btn_copy: "Copy",
    status_copied: "Copied!",
  },
  pt: {
    capture_destination_label: "Destino da captura",
    context_open_panel: "Abrir painel",
    collection_label: "Coleção",
    destination_unavailable: "Não foi possível carregar projetos e coleções. Verifique se o servidor selecionado está disponível e atualizado.",
    name: "Português",
    header_title: "Configurações do Pinar",
    header_desc: "Configure o destino de armazenamento e preferências de feedback",
    storage_title: "Destino de Armazenamento",
    tab_storage: "Armazenamento",
    tab_preferences: "Preferências",
    tab_account: "Conta",
    local_title: "Servidor Local",
    local_desc: "Tudo fica 100% local e privado neste dispositivo em ~/.pinar/shots/.",
    remote_title: "Servidor Remoto",
    remote_desc: "Salva no servidor remoto. Retenção de 7 dias. Dados nunca são vendidos.",
    account_title: "Conta e plano",
    account_description: "Conecte esta extensão ao Pinar ou continue com uma instalação Free.",
    account_free_description: "Abra o app automaticamente ou copie um código de cinco minutos para outro navegador.",
    account_code_expires: "Código de uso único. Expira em cinco minutos.",
    account_email_title: "Conta pagante",
    account_email_description: "Contas pagantes ou anteriormente pagantes podem entrar com um código enviado por e-mail.",
    account_email_sent: "Se este e-mail pertencer a uma conta elegível, um código de seis dígitos está a caminho.",
    account_code_invalid: "O código é inválido ou expirou.",
    account_unavailable: "O serviço de conta está indisponível.",
    plan_free_badge: "Gratuito",
    btn_upgrade_pro: "Assinar Pro ($19/ano)",
    btn_manage_sub: "Gerenciar Assinatura",
    btn_sign_out: "Sair",
    btn_open_app: "Abrir app",
    btn_copy_code: "Copiar código temporário",
    btn_send_code: "Enviar código",
    btn_verify_code: "Verificar",
    btn_change_email: "Usar outro e-mail",
    preferences_title: "Preferências",
    project_label: "Projeto",
    no_projects_found: "Nenhum projeto encontrado.",
    history_label: "Salvar Histórico de Anotações",
    history_desc: "Registra histórico de pins e comentários (7 dias no servidor remoto).",
    viewer_label: "Copiar Web Viewer",
    viewer_desc: "Usa o Web Viewer ao enviar as anotações.",
    viewer_content_label: "Copiar conteúdo Markdown",
    viewer_content_desc: "Quando desativado, copia apenas o link do Viewer.",
    theme_label: "Tema",
    theme_dark: "Escuro",
    theme_light: "Claro",
    theme_system: "Sistema",
    language_label: "Idioma",
    btn_coffee: "Café",
    btn_sponsor: "Apoiar",
    btn_save: "Salvar",
    status_saved: "Preferências salvas com sucesso!",
    btn_copy: "Copiar",
    status_copied: "Copiado!",
  },
  es: {
    capture_destination_label: "Destino de captura",
    context_open_panel: "Abrir panel",
    collection_label: "Colección",
    destination_unavailable: "No se pudieron cargar los proyectos y las colecciones. Comprueba que el servidor seleccionado esté disponible y actualizado.",
    name: "Español",
    header_title: "Configuración de Pinar",
    header_desc: "Configura el destino de almacenamiento y preferencias de feedback",
    storage_title: "Destino de Almacenamiento",
    tab_storage: "Almacenamiento",
    tab_preferences: "Preferencias",
    tab_account: "Cuenta",
    local_title: "Servidor Local",
    local_desc: "Todo permanece 100% local y privado en este dispositivo en ~/.pinar/shots/.",
    remote_title: "Servidor Remoto",
    remote_desc: "Sube al servidor remoto. Retención de 7 días. Los datos nunca se comparten.",
    account_title: "Cuenta y plan",
    account_description: "Conecta esta extensión a Pinar o continúa con una instalación Free.",
    account_free_description: "Abre la app automáticamente o copia un código de cinco minutos para otro navegador.",
    account_code_expires: "Código de un solo uso. Caduca en cinco minutos.",
    account_email_title: "Cuenta de pago",
    account_email_description: "Las cuentas pagadas o anteriormente pagadas pueden entrar con un código por correo.",
    account_email_sent: "Si este correo pertenece a una cuenta elegible, un código de seis dígitos está en camino.",
    account_code_invalid: "El código no es válido o ha caducado.",
    account_unavailable: "El servicio de cuenta no está disponible.",
    plan_free_badge: "Gratis",
    btn_upgrade_pro: "Actualizar a Pro ($19/año)",
    btn_manage_sub: "Gestionar Suscripción",
    btn_sign_out: "Salir",
    btn_open_app: "Abrir app",
    btn_copy_code: "Copiar código temporal",
    btn_send_code: "Enviar código",
    btn_verify_code: "Verificar",
    btn_change_email: "Usar otro correo",
    preferences_title: "Preferencias",
    project_label: "Proyecto",
    no_projects_found: "No se encontraron proyectos.",
    history_label: "Guardar Historial de Anotaciones",
    history_desc: "Registra pines pasados y comentarios (7 días en servidor remoto).",
    viewer_label: "Copiar Visor Web",
    viewer_desc: "Usa el Visor Web al enviar las anotaciones.",
    viewer_content_label: "Copiar contenido Markdown",
    viewer_content_desc: "Cuando está desactivado, copia solo el enlace del Visor.",
    theme_label: "Tema",
    theme_dark: "Oscuro",
    theme_light: "Claro",
    theme_system: "Sistema",
    language_label: "Idioma",
    btn_coffee: "Café",
    btn_sponsor: "Patrocinar",
    btn_save: "Guardar",
    status_saved: "¡Guardado con éxito!",
    btn_copy: "Copiar",
    status_copied: "¡Copiado!",
  },
  fr: {
    capture_destination_label: "Destination de la capture",
    context_open_panel: "Ouvrir le panneau",
    collection_label: "Collection",
    destination_unavailable: "Impossible de charger les projets et les collections. Vérifiez que le serveur sélectionné est disponible et à jour.",
    name: "Français",
    header_title: "Paramètres de Pinar",
    header_desc: "Configurez la destination de stockage et les préférences de feedback",
    storage_title: "Destination de Stockage",
    tab_storage: "Stockage",
    tab_preferences: "Préférences",
    tab_account: "Compte",
    local_title: "Serveur Local",
    local_desc: "Tout reste 100 % local et privé sur cet appareil dans ~/.pinar/shots/.",
    remote_title: "Serveur Distant",
    remote_desc: "Téléverse vers le serveur distant. Rétention de 7 jours. Données jamais vendues.",
    account_title: "Compte et forfait",
    account_description: "Connectez cette extension à Pinar ou continuez avec une installation gratuite.",
    account_free_description: "Ouvrez l’app automatiquement ou copiez un code valable cinq minutes pour un autre navigateur.",
    account_code_expires: "Code à usage unique. Expire dans cinq minutes.",
    account_email_title: "Compte payant",
    account_email_description: "Les comptes payants ou anciennement payants peuvent se connecter avec un code envoyé par e-mail.",
    account_email_sent: "Si cet e-mail correspond à un compte éligible, un code à six chiffres est en route.",
    account_code_invalid: "Le code est invalide ou expiré.",
    account_unavailable: "Le service de compte est indisponible.",
    plan_free_badge: "Gratuit",
    btn_upgrade_pro: "Passer à Pro ($19/an)",
    btn_manage_sub: "Gérer l'Abonnement",
    btn_sign_out: "Se déconnecter",
    btn_open_app: "Ouvrir l’app",
    btn_copy_code: "Copier le code temporaire",
    btn_send_code: "Envoyer le code",
    btn_verify_code: "Vérifier",
    btn_change_email: "Utiliser un autre e-mail",
    preferences_title: "Préférences",
    project_label: "Projet",
    no_projects_found: "Aucun projet trouvé.",
    history_label: "Enregistrer l'Historique des Annotations",
    history_desc: "Enregistre les pins et commentaires passés (7 jours sur le serveur distant).",
    viewer_label: "Copier le Visualiseur Web",
    viewer_desc: "Utilise le Visualiseur Web lors de l’envoi des annotations.",
    viewer_content_label: "Copier le contenu Markdown",
    viewer_content_desc: "Lorsque désactivé, copie uniquement le lien du Visualiseur.",
    theme_label: "Thème",
    theme_dark: "Sombre",
    theme_light: "Clair",
    theme_system: "Système",
    language_label: "Langue",
    btn_coffee: "Café",
    btn_sponsor: "Soutenir",
    btn_save: "Enregistrer",
    status_saved: "Enregistré avec succès !",
    btn_copy: "Copier",
    status_copied: "Copié !",
  },
  de: {
    capture_destination_label: "Aufnahmeziel",
    context_open_panel: "Panel öffnen",
    collection_label: "Sammlung",
    destination_unavailable: "Projekte und Sammlungen konnten nicht geladen werden. Prüfen Sie, ob der ausgewählte Server verfügbar und aktuell ist.",
    name: "Deutsch",
    header_title: "Pinar Einstellungen",
    header_desc: "Konfigurieren Sie Speicherziel und Feedback-Einstellungen",
    storage_title: "Speicherziel",
    tab_storage: "Speicher",
    tab_preferences: "Einstellungen",
    tab_account: "Konto",
    local_title: "Lokaler Server",
    local_desc: "Alles bleibt zu 100 % lokal und privat auf diesem Gerät unter ~/.pinar/shots/.",
    remote_title: "Remote-Server",
    remote_desc: "Lädt auf den Remote-Server hoch. 7 Tage Aufbewahrung. Daten werden nie verkauft.",
    account_title: "Konto und Tarif",
    account_description: "Verbinde diese Erweiterung mit Pinar oder nutze eine kostenlose Installation.",
    account_free_description: "Öffne die App automatisch oder kopiere einen fünf Minuten gültigen Code für einen anderen Browser.",
    account_code_expires: "Einmalcode. Läuft in fünf Minuten ab.",
    account_email_title: "Bezahltes Konto",
    account_email_description: "Zahlende und ehemals zahlende Konten können sich mit einem E-Mail-Code anmelden.",
    account_email_sent: "Wenn diese E-Mail zu einem berechtigten Konto gehört, ist ein sechsstelliger Code unterwegs.",
    account_code_invalid: "Der Code ist ungültig oder abgelaufen.",
    account_unavailable: "Der Kontodienst ist nicht verfügbar.",
    plan_free_badge: "Kostenlos",
    btn_upgrade_pro: "Upgrade auf Pro ($19/Jahr)",
    btn_manage_sub: "Abonnement verwalten",
    btn_sign_out: "Abmelden",
    btn_open_app: "App öffnen",
    btn_copy_code: "Temporären Code kopieren",
    btn_send_code: "Code senden",
    btn_verify_code: "Prüfen",
    btn_change_email: "Andere E-Mail verwenden",
    preferences_title: "Einstellungen",
    project_label: "Projekt",
    no_projects_found: "Keine Projekte gefunden.",
    history_label: "Anmerkungsverlauf speichern",
    history_desc: "Speichert vergangene Pins und Kommentare (7 Tage auf dem Remote-Server).",
    viewer_label: "Web-Viewer kopieren",
    viewer_desc: "Verwendet den Web-Viewer beim Senden der Anmerkungen.",
    viewer_content_label: "Markdown-Inhalt kopieren",
    viewer_content_desc: "Wenn deaktiviert, wird nur der Viewer-Link kopiert.",
    theme_label: "Erscheinungsbild",
    theme_dark: "Dunkel",
    theme_light: "Hell",
    theme_system: "System",
    language_label: "Sprache",
    btn_coffee: "Kaffee",
    btn_sponsor: "Sponsern",
    btn_save: "Speichern",
    status_saved: "Erfolgreich gespeichert!",
    btn_copy: "Kopieren",
    status_copied: "Kopiert!",
  },
  zh: {
    capture_destination_label: "捕获目标",
    context_open_panel: "打开面板",
    collection_label: "集合",
    destination_unavailable: "无法加载项目和集合。请检查所选服务器是否可用且已更新。",
    name: "简体中文",
    header_title: "Pinar 设置",
    header_desc: "配置存储目标和反馈偏好",
    storage_title: "存储目标",
    tab_storage: "存储",
    tab_preferences: "偏好设置",
    tab_account: "账户",
    local_title: "本地服务器",
    local_desc: "所有数据均 100% 保存在此设备的 ~/.pinar/shots/，并保持私密。",
    remote_title: "远程服务器",
    remote_desc: "上传到远程服务器。7天保留期。数据从不出售。",
    account_title: "账户与方案",
    account_description: "将此扩展程序连接到 Pinar，或继续使用免费安装。",
    account_free_description: "自动打开应用，或复制一个五分钟有效的代码到其他浏览器。",
    account_code_expires: "一次性代码，五分钟后过期。",
    account_email_title: "付费账户",
    account_email_description: "付费或曾付费账户可使用电子邮件代码登录。",
    account_email_sent: "如果该邮箱属于符合条件的账户，六位数代码已发送。",
    account_code_invalid: "代码无效或已过期。",
    account_unavailable: "账户服务不可用。",
    plan_free_badge: "免费",
    btn_upgrade_pro: "升级到 Pro ($19/年)",
    btn_manage_sub: "管理订阅",
    btn_sign_out: "退出登录",
    btn_open_app: "打开应用",
    btn_copy_code: "复制临时代码",
    btn_send_code: "发送代码",
    btn_verify_code: "验证",
    btn_change_email: "使用其他邮箱",
    preferences_title: "偏好设置",
    project_label: "项目",
    no_projects_found: "未找到项目。",
    history_label: "保存标注历史",
    history_desc: "记录历史图钉、评论和 URL（远程服务器保留7天）。",
    viewer_label: "复制 Web 查看器",
    viewer_desc: "发送批注时使用 Web 查看器。",
    viewer_content_label: "复制 Markdown 内容",
    viewer_content_desc: "关闭时仅复制查看器链接。",
    theme_label: "主题",
    theme_dark: "深色",
    theme_light: "浅色",
    theme_system: "跟随系统",
    language_label: "语言",
    btn_coffee: "咖啡",
    btn_sponsor: "赞助",
    btn_save: "保存",
    status_saved: "保存成功！",
    btn_copy: "复制",
    status_copied: "已复制！",
  },
  ja: {
    capture_destination_label: "キャプチャ先",
    context_open_panel: "パネルを開く",
    collection_label: "コレクション",
    destination_unavailable: "プロジェクトとコレクションを読み込めませんでした。選択したサーバーが利用可能で最新であることを確認してください。",
    name: "日本語",
    header_title: "Pinar 設定",
    header_desc: "ストレージの保存先とフィードバック設定を構成",
    storage_title: "保存先",
    tab_storage: "保存先",
    tab_preferences: "環境設定",
    tab_account: "アカウント",
    local_title: "ローカルサーバー",
    local_desc: "すべてのデータはこのデバイスの ~/.pinar/shots/ にのみ保存され、完全に非公開です。",
    remote_title: "リモートサーバー",
    remote_desc: "リモートサーバーに保存。7日間の保持期間。データは共有・販売されません。",
    account_title: "アカウントとプラン",
    account_description: "この拡張機能を Pinar に接続するか、無料インストールで続行します。",
    account_free_description: "アプリを自動で開くか、別のブラウザー用に5分間有効なコードをコピーします。",
    account_code_expires: "1回限りのコードです。5分後に期限切れになります。",
    account_email_title: "有料アカウント",
    account_email_description: "有料または以前有料だったアカウントは、メールコードでログインできます。",
    account_email_sent: "このメールが対象アカウントのものであれば、6桁のコードが送信されます。",
    account_code_invalid: "コードが無効か期限切れです。",
    account_unavailable: "アカウントサービスを利用できません。",
    plan_free_badge: "無料",
    btn_upgrade_pro: "Proにアップグレード ($19/年)",
    btn_manage_sub: "サブスクリプション管理",
    btn_sign_out: "ログアウト",
    btn_open_app: "アプリを開く",
    btn_copy_code: "一時コードをコピー",
    btn_send_code: "コードを送信",
    btn_verify_code: "確認",
    btn_change_email: "別のメールを使う",
    preferences_title: "環境設定",
    project_label: "プロジェクト",
    no_projects_found: "プロジェクトが見つかりません。",
    history_label: "アノテーション履歴を保存",
    history_desc: "過去のピン、コメント、URLを記録（リモートサーバーでは7日間保持）。",
    viewer_label: "Webビューアをコピー",
    viewer_desc: "注釈の送信時に Web ビューアを使用します。",
    viewer_content_label: "Markdown の内容をコピー",
    viewer_content_desc: "無効の場合はビューアのリンクのみをコピーします。",
    theme_label: "テーマ",
    theme_dark: "ダーク",
    theme_light: "ライト",
    theme_system: "システム設定",
    language_label: "言語",
    btn_coffee: "コーヒー",
    btn_sponsor: "スポンサー",
    btn_save: "保存",
    status_saved: "正常に保存されました！",
    btn_copy: "コピー",
    status_copied: "コピー完了！",
  },
};

function normalizeLanguage(value?: string): SupportedLanguage | undefined {
  switch (value?.trim().toLowerCase().split("-")[0]) {
    case "de": return "de";
    case "en": return "en";
    case "es": return "es";
    case "fr": return "fr";
    case "ja": return "ja";
    case "pt": return "pt";
    case "zh": return "zh";
    default: return undefined;
  }
}

function navigatorLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

export function getBestLanguage(
  preferred?: string,
  browserLanguages: readonly string[] = navigatorLanguages(),
): SupportedLanguage {
  const preferredLanguage = normalizeLanguage(preferred);
  if (preferredLanguage) return preferredLanguage;
  for (const browserLanguage of browserLanguages) {
    const language = normalizeLanguage(browserLanguage);
    if (language) return language;
  }
  return "en";
}
