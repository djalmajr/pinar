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
  tab_plan: string;
  local_title: string;
  local_desc: string;
  remote_title: string;
  remote_desc: string;
  identity_label: string;
  identity_regenerate: string;
  identity_regenerate_title: string;
  identity_regenerate_desc: string;
  identity_regenerated: string;
  btn_cancel: string;
  plan_free: string;
  plan_free_badge: string;
  plan_pro: string;
  plan_section_desc: string;
  plan_section_title: string;
  btn_upgrade_pro: string;
  btn_manage_sub: string;
  license_placeholder: string;
  license_have_key: string;
  btn_activate: string;
  btn_deactivate: string;
  license_activated: string;
  license_invalid: string;
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
  btn_history: string;
  btn_coffee: string;
  btn_sponsor: string;
  btn_save: string;
  status_saved: string;
  btn_copy: string;
  status_copied: string;
  extension_version_label: string;
}

export const translations: Record<SupportedLanguage, TranslationDictionary> = {
  en: {
    capture_destination_label: "Capture destination",
    context_open_panel: "Open Panel",
    collection_label: "Collection",
    destination_unavailable: "Destination unavailable",
    name: "English",
    extension_version_label: "Extension v{version}",
    header_title: "Pinar Settings",
    header_desc: "Configure storage destination and feedback preferences",
    storage_title: "Storage Destination",
    tab_storage: "Storage",
    tab_preferences: "Preferences",
    tab_plan: "Plan",
    local_title: "Local Server",
    local_desc: "Everything stays 100% local and private on this device at ~/.pinar/shots/.",
    remote_title: "Remote Server",
    remote_desc: "Uploads to remote server. 7-day retention. Data is never shared or sold.",
    identity_label: "Installation ID",
    identity_regenerate: "Regenerate",
    identity_regenerate_title: "Regenerate installation ID?",
    identity_regenerate_desc: "Remote history will move to the new ID, and existing remote browser sessions will be signed out.",
    identity_regenerated: "Installation ID regenerated.",
    btn_cancel: "Cancel",
    plan_free: "Free Plan (7-Day Retention)",
    plan_free_badge: "Free",
    plan_pro: "Pro Plan (Permanent Retention)",
    plan_section_desc: "Remote storage works for free. Pro adds permanent retention and paid benefits.",
    plan_section_title: "Plan and License",
    btn_upgrade_pro: "Upgrade to Pro ($19/yr)",
    btn_manage_sub: "Manage Billing",
    license_placeholder: "Paste Pro license key…",
    license_have_key: "Have a license key?",
    btn_activate: "Activate",
    btn_deactivate: "Deactivate",
    license_activated: "Pro Activated!",
    license_invalid: "Invalid license key",
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
    btn_history: "History",
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
    destination_unavailable: "Destino indisponível",
    name: "Português",
    extension_version_label: "Extensão v{version}",
    header_title: "Configurações do Pinar",
    header_desc: "Configure o destino de armazenamento e preferências de feedback",
    storage_title: "Destino de Armazenamento",
    tab_storage: "Armazenamento",
    tab_preferences: "Preferências",
    tab_plan: "Plano",
    local_title: "Servidor Local",
    local_desc: "Tudo fica 100% local e privado neste dispositivo em ~/.pinar/shots/.",
    remote_title: "Servidor Remoto",
    remote_desc: "Salva no servidor remoto. Retenção de 7 dias. Dados nunca são vendidos.",
    identity_label: "ID da instalação",
    identity_regenerate: "Regenerar",
    identity_regenerate_title: "Regenerar o ID da instalação?",
    identity_regenerate_desc: "O histórico remoto será transferido para o novo ID e as sessões remotas abertas serão desconectadas.",
    identity_regenerated: "ID da instalação regenerado.",
    btn_cancel: "Cancelar",
    plan_free: "Plano Gratuito (Retenção de 7 dias)",
    plan_free_badge: "Gratuito",
    plan_pro: "Plano Pro (Retenção Permanente)",
    plan_section_desc: "O servidor remoto funciona gratuitamente. O Pro adiciona retenção permanente e benefícios pagos.",
    plan_section_title: "Plano e licença",
    btn_upgrade_pro: "Assinar Pro ($19/ano)",
    btn_manage_sub: "Gerenciar Assinatura",
    license_placeholder: "Cole sua chave de licença Pro…",
    license_have_key: "Tem uma chave de licença?",
    btn_activate: "Ativar",
    btn_deactivate: "Desativar",
    license_activated: "Pro Ativado!",
    license_invalid: "Chave de licença inválida",
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
    btn_history: "Histórico",
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
    destination_unavailable: "Destino no disponible",
    name: "Español",
    extension_version_label: "Extensión v{version}",
    header_title: "Configuración de Pinar",
    header_desc: "Configura el destino de almacenamiento y preferencias de feedback",
    storage_title: "Destino de Almacenamiento",
    tab_storage: "Almacenamiento",
    tab_preferences: "Preferencias",
    tab_plan: "Plan",
    local_title: "Servidor Local",
    local_desc: "Todo permanece 100% local y privado en este dispositivo en ~/.pinar/shots/.",
    remote_title: "Servidor Remoto",
    remote_desc: "Sube al servidor remoto. Retención de 7 días. Los datos nunca se comparten.",
    identity_label: "ID de instalación",
    identity_regenerate: "Regenerar",
    identity_regenerate_title: "¿Regenerar el ID de instalación?",
    identity_regenerate_desc: "El historial remoto se moverá al nuevo ID y se cerrarán las sesiones remotas existentes.",
    identity_regenerated: "ID de instalación regenerado.",
    btn_cancel: "Cancelar",
    plan_free: "Plan Gratuito (Retención de 7 días)",
    plan_free_badge: "Gratis",
    plan_pro: "Plan Pro (Retención Permanente)",
    plan_section_desc: "El servidor remoto funciona gratis. Pro añade retención permanente y beneficios de pago.",
    plan_section_title: "Plan y licencia",
    btn_upgrade_pro: "Actualizar a Pro ($19/año)",
    btn_manage_sub: "Gestionar Suscripción",
    license_placeholder: "Pega la clave de licencia Pro…",
    license_have_key: "¿Tienes una clave de licencia?",
    btn_activate: "Activar",
    btn_deactivate: "Desactivar",
    license_activated: "¡Pro Activado!",
    license_invalid: "Clave de licencia no válida",
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
    btn_history: "Historial",
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
    destination_unavailable: "Destination indisponible",
    name: "Français",
    extension_version_label: "Extension v{version}",
    header_title: "Paramètres de Pinar",
    header_desc: "Configurez la destination de stockage et les préférences de feedback",
    storage_title: "Destination de Stockage",
    tab_storage: "Stockage",
    tab_preferences: "Préférences",
    tab_plan: "Forfait",
    local_title: "Serveur Local",
    local_desc: "Tout reste 100 % local et privé sur cet appareil dans ~/.pinar/shots/.",
    remote_title: "Serveur Distant",
    remote_desc: "Téléverse vers le serveur distant. Rétention de 7 jours. Données jamais vendues.",
    identity_label: "ID de l’installation",
    identity_regenerate: "Régénérer",
    identity_regenerate_title: "Régénérer l’ID de l’installation ?",
    identity_regenerate_desc: "L’historique distant sera transféré vers le nouvel ID et les sessions distantes existantes seront fermées.",
    identity_regenerated: "ID de l’installation régénéré.",
    btn_cancel: "Annuler",
    plan_free: "Plan Gratuit (Rétention de 7 jours)",
    plan_free_badge: "Gratuit",
    plan_pro: "Plan Pro (Rétention Permanente)",
    plan_section_desc: "Le serveur distant fonctionne gratuitement. Pro ajoute la conservation permanente et des avantages payants.",
    plan_section_title: "Forfait et licence",
    btn_upgrade_pro: "Passer à Pro ($19/an)",
    btn_manage_sub: "Gérer l'Abonnement",
    license_placeholder: "Collez la clé de licence Pro…",
    license_have_key: "Vous avez une clé de licence ?",
    btn_activate: "Activer",
    btn_deactivate: "Désactiver",
    license_activated: "Pro Activé !",
    license_invalid: "Clé de licence invalide",
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
    btn_history: "Historique",
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
    destination_unavailable: "Ziel nicht verfügbar",
    name: "Deutsch",
    extension_version_label: "Erweiterung v{version}",
    header_title: "Pinar Einstellungen",
    header_desc: "Konfigurieren Sie Speicherziel und Feedback-Einstellungen",
    storage_title: "Speicherziel",
    tab_storage: "Speicher",
    tab_preferences: "Einstellungen",
    tab_plan: "Tarif",
    local_title: "Lokaler Server",
    local_desc: "Alles bleibt zu 100 % lokal und privat auf diesem Gerät unter ~/.pinar/shots/.",
    remote_title: "Remote-Server",
    remote_desc: "Lädt auf den Remote-Server hoch. 7 Tage Aufbewahrung. Daten werden nie verkauft.",
    identity_label: "Installations-ID",
    identity_regenerate: "Neu erzeugen",
    identity_regenerate_title: "Installations-ID neu erzeugen?",
    identity_regenerate_desc: "Der Remote-Verlauf wird auf die neue ID übertragen und vorhandene Remote-Sitzungen werden abgemeldet.",
    identity_regenerated: "Installations-ID neu erzeugt.",
    btn_cancel: "Abbrechen",
    plan_free: "Kostenloser Plan (7 Tage Aufbewahrung)",
    plan_free_badge: "Kostenlos",
    plan_pro: "Pro-Plan (Dauerhafte Aufbewahrung)",
    plan_section_desc: "Der Remote-Server funktioniert kostenlos. Pro ergänzt dauerhafte Aufbewahrung und kostenpflichtige Vorteile.",
    plan_section_title: "Plan und Lizenz",
    btn_upgrade_pro: "Upgrade auf Pro ($19/Jahr)",
    btn_manage_sub: "Abonnement verwalten",
    license_placeholder: "Pro-Lizenzschlüssel einfügen…",
    license_have_key: "Haben Sie einen Lizenzschlüssel?",
    btn_activate: "Aktivieren",
    btn_deactivate: "Deaktivieren",
    license_activated: "Pro Aktiviert!",
    license_invalid: "Ungültiger Lizenzschlüssel",
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
    btn_history: "Verlauf",
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
    destination_unavailable: "目标不可用",
    name: "简体中文",
    extension_version_label: "扩展 v{version}",
    header_title: "Pinar 设置",
    header_desc: "配置存储目标和反馈偏好",
    storage_title: "存储目标",
    tab_storage: "存储",
    tab_preferences: "偏好设置",
    tab_plan: "套餐",
    local_title: "本地服务器",
    local_desc: "所有数据均 100% 保存在此设备的 ~/.pinar/shots/，并保持私密。",
    remote_title: "远程服务器",
    remote_desc: "上传到远程服务器。7天保留期。数据从不出售。",
    identity_label: "安装 ID",
    identity_regenerate: "重新生成",
    identity_regenerate_title: "重新生成安装 ID？",
    identity_regenerate_desc: "远程历史记录将迁移到新 ID，现有远程浏览器会话将退出。",
    identity_regenerated: "安装 ID 已重新生成。",
    btn_cancel: "取消",
    plan_free: "免费版（7天保留期）",
    plan_free_badge: "免费",
    plan_pro: "Pro 专业版（永久保留）",
    plan_section_desc: "远程服务器可免费使用。Pro 提供永久保留和付费权益。",
    plan_section_title: "套餐与许可证",
    btn_upgrade_pro: "升级到 Pro ($19/年)",
    btn_manage_sub: "管理订阅",
    license_placeholder: "粘贴 Pro 许可证密钥…",
    license_have_key: "已有许可证密钥？",
    btn_activate: "激活",
    btn_deactivate: "取消激活",
    license_activated: "Pro 已激活！",
    license_invalid: "许可证密钥无效",
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
    btn_history: "历史记录",
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
    destination_unavailable: "保存先を利用できません",
    name: "日本語",
    extension_version_label: "拡張機能 v{version}",
    header_title: "Pinar 設定",
    header_desc: "ストレージの保存先とフィードバック設定を構成",
    storage_title: "保存先",
    tab_storage: "保存先",
    tab_preferences: "環境設定",
    tab_plan: "プラン",
    local_title: "ローカルサーバー",
    local_desc: "すべてのデータはこのデバイスの ~/.pinar/shots/ にのみ保存され、完全に非公開です。",
    remote_title: "リモートサーバー",
    remote_desc: "リモートサーバーに保存。7日間の保持期間。データは共有・販売されません。",
    identity_label: "インストール ID",
    identity_regenerate: "再生成",
    identity_regenerate_title: "インストール ID を再生成しますか？",
    identity_regenerate_desc: "リモート履歴は新しい ID に移動され、既存のリモートブラウザーセッションはサインアウトされます。",
    identity_regenerated: "インストール ID を再生成しました。",
    btn_cancel: "キャンセル",
    plan_free: "無料プラン（7日間保持）",
    plan_free_badge: "無料",
    plan_pro: "Proプラン（無期限保持）",
    plan_section_desc: "リモートサーバーは無料で利用できます。Pro では無期限保持と有料特典が追加されます。",
    plan_section_title: "プランとライセンス",
    btn_upgrade_pro: "Proにアップグレード ($19/年)",
    btn_manage_sub: "サブスクリプション管理",
    license_placeholder: "Proライセンスキーを貼り付け…",
    license_have_key: "ライセンスキーをお持ちですか？",
    btn_activate: "有効化",
    btn_deactivate: "無効化",
    license_activated: "Proが有効化されました！",
    license_invalid: "無効なライセンスキーです",
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
    btn_history: "履歴",
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
