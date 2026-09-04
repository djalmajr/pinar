export const TRAY_LANGUAGES = ["de", "en", "es", "fr", "ja", "pt", "zh"] as const;

export type TrayLanguage = (typeof TRAY_LANGUAGES)[number];

export interface TrayMenuLabels {
  checkForUpdates: string;
  downloading: string;
  folder: string;
  localServerOff: string;
  localServerOn: string;
  login: string;
  openWorkspace: string;
  quit: string;
  restart: string;
  start: string;
  stop: string;
  updateTo: string;
}

const labelsByLanguage: Record<TrayLanguage, TrayMenuLabels> = {
  de: {
    checkForUpdates: "Nach Updates suchen…",
    downloading: "Lade {version} herunter…",
    folder: "Ordner öffnen",
    localServerOff: "Lokaler Server: Aus",
    localServerOn: "Lokaler Server: Ein",
    login: "Bei Anmeldung starten",
    openWorkspace: "Workspace öffnen",
    quit: "Beenden",
    restart: "Neu starten",
    start: "Starten",
    stop: "Stoppen",
    updateTo: "Auf {version} aktualisieren",
  },
  en: {
    checkForUpdates: "Check for Updates…",
    downloading: "Downloading {version}…",
    folder: "Open Folder",
    localServerOff: "Local Server: Off",
    localServerOn: "Local Server: On",
    login: "Start at Login",
    openWorkspace: "Open Workspace",
    quit: "Quit",
    restart: "Restart",
    start: "Start",
    stop: "Stop",
    updateTo: "Update to {version}",
  },
  es: {
    checkForUpdates: "Buscar actualizaciones…",
    downloading: "Descargando {version}…",
    folder: "Abrir carpeta",
    localServerOff: "Servidor local: desactivado",
    localServerOn: "Servidor local: activado",
    login: "Iniciar al iniciar sesión",
    openWorkspace: "Abrir el espacio de trabajo",
    quit: "Salir",
    restart: "Reiniciar",
    start: "Iniciar",
    stop: "Detener",
    updateTo: "Actualizar a {version}",
  },
  fr: {
    checkForUpdates: "Rechercher des mises à jour…",
    downloading: "Téléchargement de {version}…",
    folder: "Ouvrir le dossier",
    localServerOff: "Serveur local : désactivé",
    localServerOn: "Serveur local : activé",
    login: "Ouvrir à la connexion",
    openWorkspace: "Ouvrir le workspace",
    quit: "Quitter",
    restart: "Redémarrer",
    start: "Démarrer",
    stop: "Arrêter",
    updateTo: "Mettre à jour vers {version}",
  },
  ja: {
    checkForUpdates: "アップデートを確認…",
    downloading: "{version} をダウンロード中…",
    folder: "フォルダーを開く",
    localServerOff: "ローカルサーバー: オフ",
    localServerOn: "ローカルサーバー: オン",
    login: "ログイン時に起動",
    openWorkspace: "ワークスペースを開く",
    quit: "終了",
    restart: "再起動",
    start: "開始",
    stop: "停止",
    updateTo: "{version} に更新",
  },
  pt: {
    checkForUpdates: "Verificar atualizações…",
    downloading: "Baixando {version}…",
    folder: "Abrir pasta",
    localServerOff: "Servidor local: desligado",
    localServerOn: "Servidor local: ligado",
    login: "Iniciar no login",
    openWorkspace: "Abrir o workspace",
    quit: "Sair",
    restart: "Reiniciar",
    start: "Iniciar",
    stop: "Parar",
    updateTo: "Atualizar para {version}",
  },
  zh: {
    checkForUpdates: "检查更新…",
    downloading: "正在下载 {version}…",
    folder: "打开文件夹",
    localServerOff: "本地服务器：关闭",
    localServerOn: "本地服务器：开启",
    login: "登录时启动",
    openWorkspace: "打开工作区",
    quit: "退出",
    restart: "重新启动",
    start: "启动",
    stop: "停止",
    updateTo: "更新到 {version}",
  },
};

export function isTrayLanguage(value: string | undefined): value is TrayLanguage {
  return Boolean(value && (TRAY_LANGUAGES as readonly string[]).includes(value));
}

export function detectTrayLanguage(
  env: NodeJS.ProcessEnv = process.env,
  locale = Intl.DateTimeFormat().resolvedOptions().locale,
): TrayLanguage {
  const candidates = [env.PINAR_LANGUAGE, env.LANG, env.LC_ALL, locale];
  for (const candidate of candidates) {
    const language = candidate?.trim().toLowerCase().split(/[._-]/)[0];
    if (isTrayLanguage(language)) return language;
  }
  return "en";
}

export function trayMenuLabels(
  language: TrayLanguage = detectTrayLanguage(),
): TrayMenuLabels {
  return labelsByLanguage[language];
}

export function formatTrayLabel(template: string, version: string) {
  return template.replaceAll("{version}", version);
}
