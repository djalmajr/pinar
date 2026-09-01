import { clipboardFlavors } from "./clipboard.js";

function writeWithCopyEvent(flavors) {
  return new Promise((resolve, reject) => {
    const onCopy = (event) => {
      for (const [type, value] of Object.entries(flavors)) event.clipboardData.setData(type, value);
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

async function writeClipboard(message) {
  const flavors = clipboardFlavors(message);
  const blobs = Object.fromEntries(
    Object.entries(flavors).map(([type, value]) => [type, new Blob([value], { type })]),
  );
  try {
    await navigator.clipboard.write([new ClipboardItem(blobs)]);
  } catch {
    await writeWithCopyEvent(flavors);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "clipboard:write") return false;
  writeClipboard(message)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
