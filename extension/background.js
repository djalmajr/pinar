import { pinBox, pinPoint, renderPinsCrop } from "./crop.js";
import { CAPTURE_TILE_DELAY_MS, planFullPageCapture, shiftPinsToCapture } from "./full-page.js";
import { collectionDestination, destinationKey, resolveDestinationPreference } from "./destination.js";
import { formatClipboardPayload } from "./format.js";
import { getBestLanguage, translations } from "./i18n.js";
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
const OPEN_PANEL_MENU_ID = "pinar-open-panel";

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

async function registerActionContextMenu() {
  const settings = await getSettings();
  const messages = translations[getBestLanguage(settings.language)] ?? translations.en;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      contexts: ["action"],
      id: OPEN_PANEL_MENU_ID,
      title: messages.context_open_panel,
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeInstallationIdentity();
  void registerActionContextMenu();
});

chrome.runtime.onStartup.addListener(() => void registerActionContextMenu());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.language) void registerActionContextMenu();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== OPEN_PANEL_MENU_ID) return;
  void openHistory().catch((error) => console.error("Unable to open Pinar panel", error));
});

void initializeInstallationIdentity();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.scripting.executeScript({
    files: ["coordinates.js", "content.js"],
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

  if (message.type === "destination:get") {
    getCaptureDestinationContext()
      .then((context) => sendResponse({ ...context, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "destination:set") {
    setCaptureDestination(message.collectionId)
      .then((context) => sendResponse({ ...context, ok: true }))
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

  if (message.type === "pins:refresh") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ error: "missing tab", ok: false });
      return false;
    }
    chrome.scripting
      .executeScript({
        func: () => globalThis.__aiFeedbackSyncPins?.(),
        target: { allFrames: true, tabId },
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
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
    const tabId = sender.tab?.id;
    const pins = message.pins ?? [];
    if (tabId == null) {
      sendResponse({ error: "missing tab", ok: false });
      return false;
    }
    captureTabBundle(tabId, windowId, pins)
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
      copyViewerContent: false,
      enableHistory: true,
      includeViewer: true,
      language: "",
      licenseKey: "",
      storageMode: "local",
      userPlan: "free",
    });
  } catch {
    settings = {
      cloudToken: "",
      cloudUrl: "https://pinar.dev",
      copyViewerContent: false,
      enableHistory: true,
      includeViewer: true,
      language: "",
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
  const destination = await getCaptureDestinationContext(settings)
    .then((context) => context.destination)
    .catch(() => null);

  if (message.shot) {
    savedResult = await saveShot(message.shot, id, message.page, pins, settings, destination?.collectionId);
  }

  const shot = savedResult?.path || message.shot || null;
  const viewerUrl = (settings.includeViewer && savedResult?.viewerUrl) ? savedResult.viewerUrl : null;
  let clipboardViewerUrl = viewerUrl;
  let viewerContent = null;
  let warning = null;
  if (viewerUrl && settings.copyViewerContent) {
    try {
      viewerContent = await fetchViewerMarkdown(viewerUrl);
    } catch (error) {
      // The session was saved, but its Markdown endpoint may need a moment to
      // become available. Preserve the user's content instead of failing the
      // entire Cmd/Ctrl+Enter action or silently copying only the viewer URL.
      clipboardViewerUrl = null;
      warning = String(error);
    }
  }

  const payload = formatClipboardPayload({
    page: message.page,
    pins,
    shot,
    viewerContent,
    viewerUrl: clipboardViewerUrl,
  });

  try {
    await ensureOffscreen();
    const written = await chrome.runtime.sendMessage({
      html: payload.html,
      plain: payload.plain,
      type: "clipboard:write",
    });
    if (!written?.ok) throw new Error(written?.error || "clipboard write failed");
    return { ok: true, plain: payload.plain, warning };
  } catch (error) {
    // Give the active page a final, user-gesture-compatible clipboard path.
    return { error: String(error), ok: false, plain: payload.plain, warning };
  }
}

async function fetchViewerMarkdown(viewerUrl, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(viewerUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`Unable to load Markdown (${response.status})`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(100 * (attempt + 1));
    }
  }
  throw lastError || new Error("Unable to load Markdown");
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

async function runInTopFrame(tabId, func, args = []) {
  const [injection] = await chrome.scripting.executeScript({
    args,
    func,
    target: { frameIds: [0], tabId },
  });
  return injection?.result;
}

async function captureMetrics(tabId) {
  return runInTopFrame(tabId, () => globalThis.__aiFeedbackCaptureMetrics?.());
}

async function prepareCapture(tabId, scrollY) {
  return runInTopFrame(
    tabId,
    (targetY) => globalThis.__aiFeedbackPrepareCapture?.(targetY),
    [scrollY],
  );
}

async function scrollCapture(tabId, scrollY) {
  return runInTopFrame(
    tabId,
    (targetY) => globalThis.__aiFeedbackScrollCapture?.(targetY),
    [scrollY],
  );
}

async function restoreCapture(tabId) {
  return runInTopFrame(tabId, () => globalThis.__aiFeedbackRestoreCapture?.());
}

function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function dataUrlBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

async function renderCaptureFrames(frames, pins, metrics) {
  const bitmaps = await Promise.all(frames.map((frame) => dataUrlBitmap(frame.dataUrl)));
  try {
    const first = bitmaps[0];
    const dpr = first.width / metrics.viewportWidth;
    const captureStart = Math.min(...frames.map((frame) => frame.scrollY));
    const captureEnd = Math.min(
      metrics.documentHeight,
      Math.max(...frames.map((frame) => frame.scrollY + metrics.viewportHeight)),
    );
    const canvas = new OffscreenCanvas(
      first.width,
      Math.max(1, Math.round((captureEnd - captureStart) * dpr)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to compose full-page screenshot");

    frames.forEach((frame, index) => {
      const bitmap = bitmaps[index];
      const intersectionStart = Math.max(captureStart, frame.scrollY);
      const intersectionEnd = Math.min(captureEnd, frame.scrollY + metrics.viewportHeight);
      const sourceY = Math.round((intersectionStart - frame.scrollY) * dpr);
      const targetY = Math.round((intersectionStart - captureStart) * dpr);
      const height = Math.max(1, Math.round((intersectionEnd - intersectionStart) * dpr));
      ctx.drawImage(bitmap, 0, sourceY, bitmap.width, height, 0, targetY, first.width, height);
    });

    const shiftedPins = shiftPinsToCapture(pins, { x: 0, y: captureStart });
    const crop = await renderPinsCrop(canvas, shiftedPins, dpr);
    return { ok: true, shot: crop ? await blobToDataUrl(crop) : null };
  } finally {
    bitmaps.forEach((bitmap) => bitmap.close());
  }
}

async function captureTabBundle(tabId, windowId, pins) {
  const metrics = await captureMetrics(tabId);
  if (!metrics) throw new Error("Unable to read page dimensions");
  const plan = planFullPageCapture(pins, metrics);
  const frames = [];

  try {
    await prepareCapture(tabId, plan.scrollYs[0]);
    for (let index = 0; index < plan.scrollYs.length; index += 1) {
      if (index > 0) await wait(CAPTURE_TILE_DELAY_MS);
      const actualScroll = await scrollCapture(tabId, plan.scrollYs[index]);
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      frames.push({ dataUrl, scrollY: actualScroll?.y ?? plan.scrollYs[index] });
    }
    return await renderCaptureFrames(frames, pins, metrics);
  } finally {
    await restoreCapture(tabId).catch(() => {});
  }
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

async function storeDestination(settings, localBase, destination) {
  if (!destination) return;
  const key = destinationKey(settings, localBase);
  const stored = await chrome.storage.local.get({ captureDestinations: {} });
  await chrome.storage.local.set({
    captureDestinations: { ...stored.captureDestinations, [key]: destination },
  });
}

async function fetchDestinationTree(settings, localBase) {
  if (settings.storageMode === "cloud") {
    const endpoint = cloudEndpoint(settings);
    const response = settings.licenseKey
      ? await fetch(`${endpoint}/api/project-tree`, {
          headers: { authorization: `Bearer ${settings.licenseKey}` },
        })
      : await installationFetch(
          endpoint,
          "/api/project-tree",
          await initializeInstallationIdentity(),
        );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.tree) throw new Error(body.error || "Remote destinations are unavailable");
    return body.tree;
  }
  if (!localBase) throw new Error("Local Pinar server is not running");
  const response = await fetch(`${localBase}/api/project-tree`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.tree) throw new Error(body.error || "Local destinations are unavailable");
  return body.tree;
}

async function getCaptureDestinationContext(providedSettings) {
  const settings = providedSettings || await getSettings();
  const localBase = settings.storageMode === "cloud" ? "" : await findShotBase();
  const key = destinationKey(settings, localBase || "");
  const tree = await fetchDestinationTree(settings, localBase);
  const stored = await chrome.storage.local.get({ captureDestinations: {} });
  const destination = resolveDestinationPreference(tree, stored.captureDestinations[key]);
  if (!destination) throw new Error("No capture destination is available");
  await storeDestination(settings, localBase, destination);
  const messages = translations[getBestLanguage(settings.language)];
  return {
    destination,
    key,
    labels: {
      captureDestination: messages.capture_destination_label,
      collection: messages.collection_label,
      destinationUnavailable: messages.destination_unavailable,
      project: messages.project_label,
    },
    tree,
  };
}

async function setCaptureDestination(collectionId) {
  const context = await getCaptureDestinationContext();
  const destination = collectionDestination(context.tree, collectionId);
  if (!destination) throw new Error("Capture destination no longer exists");
  const settings = await getSettings();
  const localBase = settings.storageMode === "cloud" ? "" : await findShotBase();
  await storeDestination(settings, localBase, destination);
  return { ...context, destination };
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
  const withLanguage = (value) => {
    const url = new URL(value);
    if (settings.language) url.searchParams.set("lang", settings.language);
    return url.toString();
  };
  if (settings.storageMode !== "cloud") {
    const base = await findShotBase();
    if (!base) throw new Error("Local Pinar server is not running");
    const url = withLanguage(`${base}/history`);
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
  const url = withLanguage(body.url);
  await chrome.tabs.create({ url });
  return url;
}

async function saveShot(dataUrl, id, page = {}, pins = [], settings = {}, collectionId = "") {
  // 1. Cloudflare Worker mode
  if (settings.storageMode === "cloud") {
    const endpoint = cloudEndpoint(settings);
    try {
      const init = {
        body: JSON.stringify({ collectionId, id, image: dataUrl, page, pins }),
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
        await storeDestination(settings, "", body.destination);
        return {
          destination: body.destination,
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
        body: JSON.stringify({ collectionId, id, image: dataUrl, page, pins }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (response.ok && body.path) {
        await storeDestination(settings, base, body.destination);
        return {
          destination: body.destination,
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
