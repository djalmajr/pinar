// Generated from packages/shared/src/i18n by scripts/generate-extension-i18n.mjs. Do not edit.

export const translations = {
  en: {
    capture_destination_label: "Capture destination",
    collection_label: "Collection",
    context_open_panel: "Open Panel",
    destination_unavailable: "Projects and collections could not be loaded. Check that the selected server is available and up to date.",
    name: "English",
    project_label: "Project",
  },
  pt: {
    capture_destination_label: "Destino da captura",
    collection_label: "Coleção",
    context_open_panel: "Abrir painel",
    destination_unavailable: "Não foi possível carregar projetos e coleções. Verifique se o servidor selecionado está disponível e atualizado.",
    name: "Português",
    project_label: "Projeto",
  },
  es: {
    capture_destination_label: "Destino de captura",
    collection_label: "Colección",
    context_open_panel: "Abrir panel",
    destination_unavailable: "No se pudieron cargar los proyectos y las colecciones. Comprueba que el servidor seleccionado esté disponible y actualizado.",
    name: "Español",
    project_label: "Proyecto",
  },
  fr: {
    capture_destination_label: "Destination de la capture",
    collection_label: "Collection",
    context_open_panel: "Ouvrir le panneau",
    destination_unavailable: "Impossible de charger les projets et les collections. Vérifiez que le serveur sélectionné est disponible et à jour.",
    name: "Français",
    project_label: "Projet",
  },
  de: {
    capture_destination_label: "Aufnahmeziel",
    collection_label: "Sammlung",
    context_open_panel: "Panel öffnen",
    destination_unavailable: "Projekte und Sammlungen konnten nicht geladen werden. Prüfen Sie, ob der ausgewählte Server verfügbar und aktuell ist.",
    name: "Deutsch",
    project_label: "Projekt",
  },
  zh: {
    capture_destination_label: "捕获目标",
    collection_label: "集合",
    context_open_panel: "打开面板",
    destination_unavailable: "无法加载项目和集合。请检查所选服务器是否可用且已更新。",
    name: "简体中文",
    project_label: "项目",
  },
  ja: {
    capture_destination_label: "キャプチャ先",
    collection_label: "コレクション",
    context_open_panel: "パネルを開く",
    destination_unavailable: "プロジェクトとコレクションを読み込めませんでした。選択したサーバーが利用可能で最新であることを確認してください。",
    name: "日本語",
    project_label: "プロジェクト",
  },
};

function normalizeLanguage(value) {
  const language = value?.trim().toLowerCase().split("-")[0];
  return language in translations ? language : undefined;
}

export function getBestLanguage(preferred, _browserLanguages = []) {
  const preferredLanguage = normalizeLanguage(preferred);
  if (preferredLanguage) return preferredLanguage;
  return "en";
}
