// Generated from packages/shared/src/i18n by scripts/generate-extension-i18n.mjs. Do not edit.

export const translations = {
  en: {
    batch_active: "Batch: {count}",
    batch_copied_link: "Copied link · {count}",
    batch_copied_prompt: "Copied prompt · {count}",
    batch_finished: "Batch finished · {count}",
    batch_idle: "Batch off",
    batch_label: "Batch · {when}",
    batch_on: "Batch: on",
    capture_destination_label: "Capture destination",
    collection_label: "Collection",
    destination_unavailable: "Projects and collections could not be loaded. Check that the selected server is available and up to date.",
    name: "English",
    project_label: "Project",
  },
  pt: {
    batch_active: "Lote: {count}",
    batch_copied_link: "Link copiado · {count}",
    batch_copied_prompt: "Prompt copiado · {count}",
    batch_finished: "Lote finalizado · {count}",
    batch_idle: "Lote inativo",
    batch_label: "Lote · {when}",
    batch_on: "Lote: ativo",
    capture_destination_label: "Destino da captura",
    collection_label: "Coleção",
    destination_unavailable: "Não foi possível carregar projetos e coleções. Verifique se o servidor selecionado está disponível e atualizado.",
    name: "Português",
    project_label: "Projeto",
  },
  es: {
    batch_active: "Lote: {count}",
    batch_copied_link: "Enlace copiado · {count}",
    batch_copied_prompt: "Prompt copiado · {count}",
    batch_finished: "Lote finalizado · {count}",
    batch_idle: "Lote inactivo",
    batch_label: "Lote · {when}",
    batch_on: "Lote: activo",
    capture_destination_label: "Destino de captura",
    collection_label: "Colección",
    destination_unavailable: "No se pudieron cargar los proyectos y las colecciones. Comprueba que el servidor seleccionado esté disponible y actualizado.",
    name: "Español",
    project_label: "Proyecto",
  },
  fr: {
    batch_active: "Lot : {count}",
    batch_copied_link: "Lien copié · {count}",
    batch_copied_prompt: "Prompt copié · {count}",
    batch_finished: "Lot terminé · {count}",
    batch_idle: "Lot inactif",
    batch_label: "Lot · {when}",
    batch_on: "Lot : actif",
    capture_destination_label: "Destination de la capture",
    collection_label: "Collection",
    destination_unavailable: "Impossible de charger les projets et les collections. Vérifiez que le serveur sélectionné est disponible et à jour.",
    name: "Français",
    project_label: "Projet",
  },
  de: {
    batch_active: "Stapel: {count}",
    batch_copied_link: "Link kopiert · {count}",
    batch_copied_prompt: "Prompt kopiert · {count}",
    batch_finished: "Stapel beendet · {count}",
    batch_idle: "Stapel aus",
    batch_label: "Stapel · {when}",
    batch_on: "Stapel: aktiv",
    capture_destination_label: "Aufnahmeziel",
    collection_label: "Sammlung",
    destination_unavailable: "Projekte und Sammlungen konnten nicht geladen werden. Prüfen Sie, ob der ausgewählte Server verfügbar und aktuell ist.",
    name: "Deutsch",
    project_label: "Projekt",
  },
  zh: {
    batch_active: "批次：{count}",
    batch_copied_link: "已复制链接 · {count}",
    batch_copied_prompt: "已复制提示 · {count}",
    batch_finished: "批次已结束 · {count}",
    batch_idle: "批次未启用",
    batch_label: "批次 · {when}",
    batch_on: "批次:进行中",
    capture_destination_label: "捕获目标",
    collection_label: "集合",
    destination_unavailable: "无法加载项目和集合。请检查所选服务器是否可用且已更新。",
    name: "简体中文",
    project_label: "项目",
  },
  ja: {
    batch_active: "バッチ: {count}",
    batch_copied_link: "リンクをコピーしました · {count}",
    batch_copied_prompt: "プロンプトをコピーしました · {count}",
    batch_finished: "バッチ終了 · {count}",
    batch_idle: "バッチ停止中",
    batch_label: "バッチ · {when}",
    batch_on: "バッチ: 実行中",
    capture_destination_label: "キャプチャ先",
    collection_label: "コレクション",
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
