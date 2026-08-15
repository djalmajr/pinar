import { pinBox, pinPoint, renderPinsCrop } from "./crop.js";
import { formatClipboardPayload } from "./format.js";
import { getPinColor } from "./pin-colors.js";
import {
  createInstallationIdentity,
  ensureInstallationIdentity,
  installationAuthHeaders,
  replaceInstallationIdentity,
} from "./identity.js";
import { pinarPorts } from "./ports.js";
import { endTabPins, planSessionEnd } from "./session.js";

const tabPins = new Map();
const registeredInstallations = new Set();

function normalizePins(pins = []) {
  return pins.map((pin, index) => {
    const number = index + 1;
    return {
      ...pin,
      areaBox: pin.kind === "area" ? pinBox(pin) : undefined,
      color: getPinColor(number),
      coords: pinPoint(pin),
      domPath: pin.path,
      innerText: pin.text,
      number,
      tag: pin.label,
      type: pin.kind === "area" ? "area" : "point",
    };
  });
}

async function initializeInstallationIdentity() {
  try {
    await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    /* Older Chromium versions do not expose storage access levels. */
  }
  return ensureInstallationIdentity(chrome.storage.local);
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeInstallationIdentity();
});

void initializeInstallationIdentity();

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
  if (message.type === "identity:get") {
    initializeInstallationIdentity()
      .then((identity) => sendResponse({ id: identity.id, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "identity:regenerate") {
    regenerateInstallationIdentity()
      .then((identity) => sendResponse({ id: identity.id, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "history:open") {
    openHistory()
      .then((url) => sendResponse({ ok: true, url }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "pins:sync") {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId ?? 0;
    if (tabId == null) {
      sendResponse({ ok: false, error: "missing tab" });
      return false;
    }
    const existing = tabPins.get(tabId) ?? [];
    const next = normalizePins([
      ...existing.filter((pin) => pin.frameId !== frameId),
      ...(message.pins ?? []).map((pin) => ({ ...pin, frameId })),
    ]);
    tabPins.set(tabId, next);
    sendResponse({ ok: true, pins: next });
    return false;
  }

  if (message.type === "pins:list") {
    sendResponse({ ok: true, pins: normalizePins(tabPins.get(sender.tab?.id) ?? []) });
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

  if (message.type === "session:end") {
    const plan = planSessionEnd(sender.tab?.id);
    if (!plan.ok) {
      sendResponse({ ok: false, error: plan.error });
      return false;
    }
    if (plan.clearPins) endTabPins(tabPins, plan.tabId);
    chrome.scripting
      .executeScript({
        func: () => {
          globalThis.__aiFeedbackDismiss?.();
        },
        target: { allFrames: true, tabId: plan.tabId },
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

async function getSettings() {
  let settings;
  try {
    settings = await chrome.storage.sync.get({
      cloudToken: "",
      cloudUrl: "https://pinar.dev",
      enableHistory: true,
      includeViewer: true,
      licenseKey: "",
      storageMode: "local",
      userPlan: "free",
    });
  } catch {
    settings = {
      cloudToken: "",
      cloudUrl: "https://pinar.dev",
      enableHistory: true,
      includeViewer: true,
      licenseKey: "",
      storageMode: "local",
      userPlan: "free",
    };
  }

  // Migrate any old URLs stored in Chrome sync storage
  if (!settings.cloudUrl || settings.cloudUrl.includes("workers.dev") || settings.cloudUrl.includes("djalmajr.dev")) {
    settings.cloudUrl = "https://pinar.dev";
    try {
      chrome.storage.sync.set({ cloudUrl: "https://pinar.dev" });
    } catch {}
  }

  return settings;
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";
function generateNanoId(size = 12) {
  const bytes = new Uint8Array(size);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let id = "";
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i] & 63];
  return id;
}

async function copyBundle(message) {
  const pins = message.pins ?? [];
  const id = generateNanoId(12);
  const settings = await getSettings();
  let savedResult = null;

  if (message.shot) {
    savedResult = await saveShot(message.shot, id, message.page, pins, settings);
  }

  const shot = savedResult?.path || message.shot || null;
  const viewerUrl = (settings.includeViewer && savedResult?.viewerUrl) ? savedResult.viewerUrl : null;

  const payload = formatClipboardPayload({
    page: message.page,
    pins,
    shot,
    viewerUrl,
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
  const crop = await renderPinsCrop(bitmap, pins, dpr);
  bitmap.close();
  return { ok: true, shot: crop ? await blobToDataUrl(crop) : null };
}

function parsePort(body) {
  const text = String(body);
  const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  return match ? Number(match[1]) : null;
}

async function findShotBase() {
  const found = await Promise.all(
    pinarPorts().map(async (port) => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        const body = await response.json();
        if (response.ok && body.ok === true && body.service === "pinar") return port;
      } catch {
        /* port empty or not Pinar */
      }
      return null;
    }),
  );
  const port = found.find((value) => value != null);
  return port ? `http://127.0.0.1:${port}` : null;
}

function cloudEndpoint(settings) {
  return (settings.cloudUrl || "https://pinar.dev").replace(/\/+$/, "");
}

async function registerRemoteInstallation(endpoint, identity, force = false) {
  const cacheKey = `${endpoint}:${identity.id}`;
  if (!force && registeredInstallations.has(cacheKey)) return;
  const response = await fetch(`${endpoint}/api/installations`, {
    body: JSON.stringify({ installationId: identity.id, installationToken: identity.token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Remote installation registration failed");
  registeredInstallations.add(cacheKey);
}

async function installationFetch(endpoint, path, identity, init = {}) {
  await registerRemoteInstallation(endpoint, identity);
  const request = () => fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      ...installationAuthHeaders(identity),
      ...(init.headers || {}),
    },
  });
  let response = await request();
  if (response.status === 401) {
    registeredInstallations.delete(`${endpoint}:${identity.id}`);
    await registerRemoteInstallation(endpoint, identity, true);
    response = await request();
  }
  return response;
}

async function regenerateInstallationIdentity() {
  const settings = await getSettings();
  const endpoint = cloudEndpoint(settings);
  const current = await initializeInstallationIdentity();
  const replacement = createInstallationIdentity();
  let response = await fetch(`${endpoint}/api/installations/rotate`, {
    body: JSON.stringify({
      installationId: replacement.id,
      installationToken: replacement.token,
    }),
    headers: {
      ...installationAuthHeaders(current),
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (response.status === 401) {
    response = await fetch(`${endpoint}/api/installations`, {
      body: JSON.stringify({
        installationId: replacement.id,
        installationToken: replacement.token,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Installation identity regeneration failed");
  await replaceInstallationIdentity(chrome.storage.local, replacement);
  registeredInstallations.clear();
  registeredInstallations.add(`${endpoint}:${replacement.id}`);
  return replacement;
}

async function openHistory() {
  const settings = await getSettings();
  if (settings.storageMode !== "cloud") {
    const base = await findShotBase();
    if (!base) throw new Error("Local Pinar server is not running");
    const url = `${base}/history`;
    await chrome.tabs.create({ url });
    return url;
  }

  const endpoint = cloudEndpoint(settings);
  let response;
  if (settings.licenseKey) {
    response = await fetch(`${endpoint}/api/auth/browser-ticket`, {
      headers: { authorization: `Bearer ${settings.licenseKey}` },
      method: "POST",
    });
  } else {
    const identity = await initializeInstallationIdentity();
    response = await installationFetch(endpoint, "/api/auth/browser-ticket", identity, { method: "POST" });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.url) throw new Error(body.error || "Remote history is unavailable");
  await chrome.tabs.create({ url: body.url });
  return body.url;
}

async function saveShot(dataUrl, id, page = {}, pins = [], settings = {}) {
  // 1. Cloudflare Worker mode
  if (settings.storageMode === "cloud") {
    const endpoint = cloudEndpoint(settings);
    try {
      const init = {
        body: JSON.stringify({ id, image: dataUrl, page, pins }),
        headers: { "content-type": "application/json" },
        method: "POST",
      };
      const response = settings.licenseKey
        ? await fetch(`${endpoint}/api/shots`, {
            ...init,
            headers: { ...init.headers, authorization: `Bearer ${settings.licenseKey}` },
          })
        : await installationFetch(
            endpoint,
            "/api/shots",
            await initializeInstallationIdentity(),
            init,
          );
      const body = await response.json();
      if (response.ok && (body.path || body.shotUrl)) {
        return {
          path: body.path || body.shotUrl,
          shotUrl: body.shotUrl,
          viewerUrl: `${endpoint}/v/${id}.md`,
        };
      }
    } catch {
      /* Cloud failed */
    }
    return null;
  }

  // 2. Local Helper mode (default)
  const base = await findShotBase();
  if (base) {
    try {
      const response = await fetch(`${base}/api/shots`, {
        body: JSON.stringify({ id, image: dataUrl, page, pins }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (response.ok && body.path) {
        return {
          path: body.path,
          shotUrl: `${base}/shots/${id}.png`,
          viewerUrl: `${base}/v/${id}.md`,
        };
      }
    } catch {
      /* Local helper failed */
    }
  }

  return null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}
