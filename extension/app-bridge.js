(() => {
  if (globalThis.__pinarAppBridge) return;
  globalThis.__pinarAppBridge = true;

  window.addEventListener("pinar:reopen-session", (event) => {
    const sessionId = event.detail?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) return;
    chrome.runtime.sendMessage({ sessionId, type: "session:reopen" }, (response) => {
      window.dispatchEvent(new CustomEvent("pinar:reopen-session:result", {
        detail: response || { error: "extension_unavailable", ok: false },
      }));
    });
  });
})();
