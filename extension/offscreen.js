function writeWithCopyEvent({ html, plain }) {
  return new Promise((resolve, reject) => {
    const onCopy = (event) => {
      event.clipboardData.setData("text/html", html);
      event.clipboardData.setData("text/plain", plain);
      event.preventDefault();
    };
    document.addEventListener("copy", onCopy, { once: true });
    if (document.execCommand("copy")) {
      resolve();
      return;
    }
    document.removeEventListener("copy", onCopy);
    reject(new Error("clipboard write failed"));
  });
}

async function writeClipboard({ html, plain }) {
  const item = new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([plain], { type: "text/plain" }),
  });
  try {
    await navigator.clipboard.write([item]);
  } catch {
    await writeWithCopyEvent({ html, plain });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "clipboard:write") return false;
  writeClipboard(message)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
