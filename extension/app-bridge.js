(() => {
  if (globalThis.__pinarAppBridge) return;
  globalThis.__pinarAppBridge = true;

  // The application's selector updates <html lang>. Keep extension chrome in
  // the same language without waiting for a capture or opening Options.
  const languages = new Set(["de", "en", "es", "fr", "ja", "pt", "zh"]);
  let sentLanguage;
  function syncLanguage() {
    const language = document.documentElement.lang;
    if (!languages.has(language) || language === sentLanguage) return;
    sentLanguage = language;
    chrome.runtime.sendMessage({ type: "app:language", language }).catch(() => { sentLanguage = undefined; });
  }
  function watchLanguage() {
    new MutationObserver(syncLanguage).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    // An explicit persisted choice also applies when the application is reopened.
    try { if (languages.has(localStorage.getItem("pinar-language"))) syncLanguage(); } catch { /* storage unavailable */ }
  }
  if (document.documentElement) watchLanguage();
  else document.addEventListener("DOMContentLoaded", watchLanguage, { once: true });
})();
