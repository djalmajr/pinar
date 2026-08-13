import { formatClipboard } from "./format.js";

const SHOTS = "http://127.0.0.1:17373";
const tabPins = new Map();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.scripting.executeScript({
    files: ["content.js"],
    target: { allFrames: true, tabId: tab.id },
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabPins.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "pins:sync") {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId ?? 0;
    if (tabId == null) {
      sendResponse({ ok: false, error: "missing tab" });
      return false;
    }
    const existing = tabPins.get(tabId) ?? [];
    const next = [
      ...existing.filter((pin) => pin.frameId !== frameId),
      ...(message.pins ?? []).map((pin) => ({ ...pin, frameId })),
    ];
    tabPins.set(tabId, next);
    sendResponse({ ok: true, pins: next });
    return false;
  }

  if (message.type === "pins:list") {
    sendResponse({ ok: true, pins: tabPins.get(sender.tab?.id) ?? [] });
    return false;
  }

  if (message.type === "pins:clear") {
    if (sender.tab?.id != null) tabPins.delete(sender.tab.id);
    sendResponse({ ok: true, pins: [] });
    return false;
  }

  if (message.type === "overlays:hidden") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false });
      return false;
    }
    chrome.scripting
      .executeScript({
        args: [message.hidden === true],
        func: (hidden) => {
          globalThis.__aiFeedbackSetHidden?.(hidden);
        },
        target: { allFrames: true, tabId },
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "capture") {
    const windowId = sender.tab?.windowId;
    const pins = message.pins ?? [];
    chrome.tabs
      .captureVisibleTab(windowId, { format: "png" })
      .then((dataUrl) => cropBundle(dataUrl, pins, message.dpr ?? 1))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "clipboard") {
    copyBundle(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  return false;
});

async function copyBundle(message) {
  const pins = message.pins ?? [];
  const pinCrops = {};
  for (const [id, url] of Object.entries(message.pinCrops ?? {})) {
    pinCrops[id] = (await saveShot(url, id)) || url;
  }
  const payload = formatClipboard({
    page: message.page,
    pinCrops,
    pins,
  });
  await ensureOffscreen();
  const written = await chrome.runtime.sendMessage({
    html: payload.html,
    plain: payload.plain,
    type: "clipboard:write",
  });
  if (!written?.ok) throw new Error(written?.error || "clipboard write failed");
  return { ok: true };
}

async function ensureOffscreen() {
  try {
    const existing = await chrome.runtime.getContexts?.({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (existing?.some((ctx) => ctx.documentUrl?.includes("offscreen.html"))) return;
  } catch {
    /* getContexts is missing on older Chrome */
  }
  try {
    await chrome.offscreen.createDocument({
      justification: "Write visual feedback to the clipboard",
      reasons: ["CLIPBOARD"],
      url: "offscreen.html",
    });
  } catch (error) {
    if (!/already exists|Only a single offscreen/i.test(String(error))) throw error;
  }
}

async function cropBundle(dataUrl, pins, dpr) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const pinCrops = {};
  for (const pin of pins) {
    const crop = await cropPin(bitmap, pin.topBox ?? pin.box, dpr);
    if (crop) pinCrops[pin.id] = crop;
  }
  bitmap.close();
  return { ok: true, pinCrops, viewportPng: dataUrl };
}

async function cropPin(bitmap, box, dpr) {
  const pad = 96 * dpr;
  const x = Math.max(0, Math.round(box.x * dpr - pad));
  const y = Math.max(0, Math.round(box.y * dpr - pad));
  const width = Math.max(1, Math.min(bitmap.width - x, Math.round(box.width * dpr + pad * 2)));
  const height = Math.max(1, Math.min(bitmap.height - y, Math.round(box.height * dpr + pad * 2)));
  if (width < 2 || height < 2) return null;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

function shotExtension(dataUrl) {
  if (dataUrl.startsWith("data:image/webp")) return "webp";
  if (dataUrl.startsWith("data:image/jpeg")) return "jpg";
  return "png";
}

function waitForDownload(id) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve();
    };
    const timer = setTimeout(finish, 4000);
    const onChanged = (delta) => {
      if (delta.id === id && (delta.state?.current === "complete" || delta.state?.current === "interrupted")) {
        finish();
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id }).then((items) => {
      const state = items[0]?.state;
      if (state === "complete" || state === "interrupted") finish();
    });
  });
}

async function saveShot(dataUrl, id) {
  try {
    const response = await fetch(`${SHOTS}/v1/shots`, {
      body: JSON.stringify({ id, image: dataUrl }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await response.json();
    if (response.ok && body.path) return body.path;
  } catch {
    /* helper is optional; fall through to Downloads */
  }
  try {
    const downloadId = await chrome.downloads.download({
      conflictAction: "uniquify",
      filename: `pinar/${id}.${shotExtension(dataUrl)}`,
      saveAs: false,
      url: dataUrl,
    });
    await waitForDownload(downloadId);
    const [item] = await chrome.downloads.search({ id: downloadId });
    return item?.filename || null;
  } catch {
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}
