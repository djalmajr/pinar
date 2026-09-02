import { pinBox, pinPoint, renderPinsCrop } from "./crop.js";
import {
  addCapture,
  batchSummary,
  copyFinishedBatch,
  finishedBatchToastKey,
  markFailed,
  openBatch,
  planCapturePersistence,
  savedCount,
} from "./batch.js";
import { CAPTURE_TILE_DELAY_MS, planFullPageCapture, shiftMaskRegions, shiftPinsToCapture } from "./full-page.js";
import { collectionDestination, destinationKey, resolveDestinationPreference } from "./destination.js";
import { formatClipboardPayload } from "./format.js";
import { getBestLanguage, translations } from "./i18n.js";
import { acceptedRemoteLegalAcceptance, parseLegalBundle } from "./legal-consent.js";
import { getPinColor } from "./pin-colors.js";
import {
  clearDeviceToken,
  createInstallationIdentity,
  deviceAuthHeaders,
  ensureInstallationIdentity,
  getDeviceToken,
  installationAuthHeaders,
  replaceInstallationIdentity,
  storeDeviceToken,
} from "./identity.js";
import { pinarPorts } from "./ports.js";
import {
  bindTabHydration,
  canInjectInto,
  CONTENT_INJECTION_FILES,
  dropHydrationIfTabLeftOrigin,
  endTabPins,
  hydrationForTab,
  isPinarHelperOrigin,
  originOf,
  pinFrameIds,
  planSessionEnd,
  planSessionReopen,
} from "./session.js";
import { createSingleFlight } from "./single-flight.js";
import "./privacy.js";

const tabPins = new Map();
const tabHydrations = new Map();
const registeredInstallations = new Set();
const registerInstallationOnce = createSingleFlight();
// Keeping the original command id preserves every shortcut a user already bound;
// Chrome keys bindings by name, so renaming it to "toggle-batch" would drop them.
const BATCH_COMMAND = "finish-batch";
const CANCEL_BATCH_COMMAND = "cancel-batch";
const PANEL_COMMAND = "open-panel";
const OPEN_PANEL_MENU_ID = "pinar-open-panel";
const BATCH_MENU_ID = "pinar-batch-toggle";
const CANCEL_BATCH_MENU_ID = "pinar-cancel-batch";

function normalizePins(pins = []) {
  return pins.map((pin, index) => {
    const number = index + 1;
    const pinId = pin.pinId || pin.id;
    return {
      ...pin,
      areaBox: pin.kind === "area" ? pinBox(pin) : undefined,
      color: getPinColor(number),
      coords: pinPoint(pin),
      domPath: pin.path,
      fingerprint: pin.fingerprint,
      id: pinId,
      innerText: pin.text,
      location: pin.location,
      number,
      pinId,
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

async function batchState() {
  const settings = await getSettings();
  const messages = translations[getBestLanguage(settings.language)];
  const batch = await readBatch();
  const count = batch ? savedCount(batch) : 0;
  const commands = await chrome.commands.getAll().catch(() => []);
  return {
    active: Boolean(batch),
    count,
    label: batch ? (count > 0 ? messages.batch_active.replace("{count}", String(count)) : messages.batch_on) : messages.batch_idle,
    shortcut: commands.find((command) => command.name === BATCH_COMMAND)?.shortcut || "",
    summary: batchSummary(batch),
  };
}

// Every surface that shows batch state refreshes from one snapshot: the action
// badge and the overlay pill. The keyboard commands replaced the action context
// menu, which could never be localized - Chrome shows one title to everyone.
async function syncBatchSurfaces(extra = {}) {
  const state = await batchState();
  await syncActionMenu(state).catch(() => null);
  // The badge mirrors the toolbar: "on" while the batch is empty, then the count.
  const badge = state.active ? (state.count > 0 ? String(state.count) : "on") : "";
  await chrome.action.setBadgeText({ text: badge }).catch(() => null);
  await chrome.action.setBadgeBackgroundColor({ color: "#5794FF" }).catch(() => null);
  await chrome.action.setBadgeTextColor({ color: "#FFFFFF" }).catch(() => null);
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(tabs.map((tab) => (tab.id == null
    ? null
    : chrome.tabs.sendMessage(tab.id, { type: "batch:changed", ...state, ...extra }).catch(() => null))));
}

function overlayMessages(language) {
  const catalog = translations[language] || translations.en;
  const messages = {};
  for (const key of Object.keys(catalog)) {
    if (key.startsWith("overlay_")) messages[key] = catalog[key];
  }
  return messages;
}

async function uiMessagesState() {
  const settings = await getSettings();
  const language = getBestLanguage(settings.language);
  return { language, messages: overlayMessages(language) };
}

// Same fan-out as the batch pill: every open tab gets a fresh overlay dictionary
// when the Options language changes. Missing content scripts are ignored.
async function syncUiMessages() {
  const state = await uiMessagesState();
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(tabs.map((tab) => (tab.id == null
    ? null
    : chrome.tabs.sendMessage(tab.id, { type: "ui:messages", ...state }).catch(() => null))));
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.language) return;
  void syncUiMessages();
  void batchState().then(syncActionMenu).catch(() => null);
});

chrome.runtime.onStartup?.addListener(() => void batchState().then(syncActionMenu).catch(() => null));

chrome.runtime.onInstalled.addListener(() => {
  void initializeInstallationIdentity();
  void batchState().then(syncActionMenu).catch(() => null);
});

void initializeInstallationIdentity();

chrome.action.onClicked.addListener(async (tab) => {
  // Chrome refuses injection on its own surfaces (chrome://, the Web Store,
  // extension pages); there is nothing to annotate there, so the click is a
  // deliberate no-op. Any other rejection is a real defect and stays visible.
  if (!tab.id || !canInjectInto(tab.url)) return;
  try {
    await chrome.scripting.executeScript({
      files: CONTENT_INJECTION_FILES,
      target: { allFrames: true, tabId: tab.id },
    });
  } catch (error) {
    console.error("Unable to open the Pinar toolbar on this tab", tab.url, error);
  }
});

chrome.commands?.onCommand.addListener((command) => {
  if (command === PANEL_COMMAND) {
    void openApp().catch((error) => console.error("Unable to open Pinar app", error));
    return;
  }
  if (command === CANCEL_BATCH_COMMAND) {
    void finishBatch({ copy: false }).catch((error) => console.error("Unable to close the capture batch", error));
    return;
  }
  if (command !== BATCH_COMMAND) return;
  void toggleBatch().catch((error) => console.error("Unable to toggle the capture batch", error));
});

// The action's context menu mirrors the commands, for people who reach for
// the mouse: open the panel, start or finish the batch, and - only while a
// batch is running - close it without copying. Every title is our own string
// set at runtime in the language chosen in Options and refreshed whenever the
// language or the batch changes; Chrome never sees a fixed English label.
function menuItem(id, props) {
  return new Promise((resolve) => chrome.contextMenus.update(id, props, () => {
    if (!chrome.runtime.lastError) return resolve();
    chrome.contextMenus.create({ id, ...props }, () => { void chrome.runtime.lastError; resolve(); });
  }));
}

async function syncActionMenu(state) {
  if (!chrome.contextMenus) return;
  const settings = await getSettings();
  const messages = translations[getBestLanguage(settings.language)];
  const contexts = ["action"];
  const active = Boolean(state?.active);
  const batchTitle = active
    ? `${messages.batch_finish} · ${state.label}`
    : messages.batch_start;
  await menuItem(OPEN_PANEL_MENU_ID, { contexts, title: messages.context_open_panel });
  await menuItem(BATCH_MENU_ID, { contexts, title: batchTitle });
  await menuItem(CANCEL_BATCH_MENU_ID, { contexts, title: messages.batch_close_menu, visible: active });
}

chrome.contextMenus?.onClicked.addListener((info) => {
  if (info.menuItemId === OPEN_PANEL_MENU_ID) {
    void openApp().catch((error) => console.error("Unable to open Pinar app", error));
    return;
  }
  if (info.menuItemId === BATCH_MENU_ID) {
    void toggleBatch().catch((error) => console.error("Unable to toggle the capture batch", error));
    return;
  }
  if (info.menuItemId !== CANCEL_BATCH_MENU_ID) return;
  void finishBatch({ copy: false }).catch((error) => console.error("Unable to close the capture batch", error));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabPins.delete(tabId);
  tabHydrations.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const binding = hydrationForTab(tabHydrations, tabId);
  if (!binding) return;
  const dropped = dropHydrationIfTabLeftOrigin(tabHydrations, tabPins, tabId, tab.url || "");
  if (dropped.dropped) {
    void notifyTabUnavailable(tabId, dropped.reason);
    return;
  }
  void hydrateBoundTab(tabId, binding).catch((error) => {
    console.error("Unable to rehydrate Pinar session", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "app:open") {
    openApp()
      .then((url) => sendResponse({ ok: true, url }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "auth:get") {
    getAuthSession()
      .then((session) => sendResponse({ ok: true, session }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "auth:extension-code") {
    createExtensionCodeForCurrentSession()
      .then((challenge) => sendResponse({ ...challenge, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "auth:email-code:request") {
    requestAccountEmailCode(message.email)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "auth:email-code:verify") {
    verifyAccountEmailCode(message.email, message.code)
      .then((session) => sendResponse({ ok: true, session }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "auth:logout") {
    logoutAccount()
      .then((session) => sendResponse({ ok: true, session }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "auth:billing") {
    openBillingPortal()
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

  if (message.type === "storage:status") {
    getStorageStatus()
      .then((status) => sendResponse({ ...status, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "batch:get") {
    batchState()
      .then((state) => sendResponse({ ...state, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "ui:messages") {
    uiMessagesState()
      .then((state) => sendResponse({ ...state, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "batch:start") {
    startBatch()
      .then((batch) => sendResponse({ ok: true, summary: batchSummary(batch) }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "batch:finish") {
    finishBatch()
      .then((result) => sendResponse({ ...result, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "batch:cancel") {
    // Same door as the shortcut and the action menu: close without copying.
    // Forgetting the batch locally would leave its server row open forever.
    finishBatch({ copy: false })
      .then((result) => sendResponse({ ...result, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "destination:set") {
    setCaptureDestination(message.collectionId)
      .then((context) => sendResponse({ ...context, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "preferences:get") {
    getDeliveryPreferences()
      .then((prefs) => sendResponse({ ...prefs, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "preferences:set") {
    setDeliveryPreferences(deliveryPatchFromMessage(message))
      .then((prefs) => sendResponse({ ...prefs, ok: true }))
      .catch((error) => sendResponse({ error: String(error), ok: false }));
    return true;
  }

  if (message.type === "session:reopen") {
    reopenSavedSession(message.sessionId, sender)
      .then((result) => sendResponse(result))
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
    const hydration = hydrationForTab(tabHydrations, tabId);
    if (hydration && message.sessionId && message.sessionId !== hydration.sessionId) {
      sendResponse({ ok: false, error: "session_mismatch" });
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
    const frameIds = pinFrameIds(tabPins.get(tabId));
    if (frameIds.length === 0) {
      sendResponse({ ok: true });
      return false;
    }
    Promise.all(frameIds.map((frameId) => chrome.scripting.executeScript({
      func: () => globalThis.__pinarSyncPins?.(),
      target: { frameIds: [frameId], tabId },
    })))
      .then((results) => {
        const synced = results.every(([result]) => result?.result === true);
        sendResponse(synced
          ? { ok: true }
          : { error: "pin positions could not be refreshed", ok: false });
      })
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
          globalThis.__pinarSetHidden?.(hidden);
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
    if (plan.clearPins) {
      endTabPins(tabPins, plan.tabId);
      tabHydrations.delete(plan.tabId);
    }
    chrome.scripting
      .executeScript({
        func: () => {
          globalThis.__pinarDismiss?.();
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
    captureTabBundle(tabId, windowId, pins, message.maskRegions)
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
      cloudUrl: "https://pinar.dev",
      copyOnFinishBatch: "prompt",
      copyViewerContent: false,
      enableHistory: true,
      handoffMode: "compact",
      includeScreenshot: true,
      includeViewer: true,
      language: "",
      sensitiveQueryKeys: "",
      storageMode: "local",
    });
  } catch {
    settings = {
      cloudUrl: "https://pinar.dev",
      copyOnFinishBatch: "prompt",
      copyViewerContent: false,
      enableHistory: true,
      handoffMode: "compact",
      includeScreenshot: true,
      includeViewer: true,
      language: "",
      sensitiveQueryKeys: "",
      storageMode: "local",
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

const SUPPORTED_PREF_LANGUAGES = new Set(["de", "en", "es", "fr", "ja", "pt", "zh"]);

function booleanPref(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === "0" || value === "false") return false;
  if (value === 1 || value === "1" || value === "true") return true;
  return fallback;
}

function parseCaptureDestinationPref(value) {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  if (typeof value.projectId !== "string" || typeof value.collectionId !== "string") return undefined;
  if (!value.projectId || !value.collectionId) return undefined;
  return { collectionId: value.collectionId, projectId: value.projectId };
}

function localDeliveryPreferences(settings) {
  return {
    captureDestination: null,
    copyOnFinishBatch: settings.copyOnFinishBatch === "off" || settings.copyOnFinishBatch === "link" || settings.copyOnFinishBatch === "prompt"
      ? settings.copyOnFinishBatch
      : "prompt",
    copyViewerContent: settings.copyViewerContent === true,
    handoffMode: settings.handoffMode === "full" ? "full" : "compact",
    includeScreenshot: settings.includeScreenshot !== false,
    includeViewer: settings.includeViewer !== false,
    language: SUPPORTED_PREF_LANGUAGES.has(settings.language) ? settings.language : null,
    sensitiveQueryKeys: typeof settings.sensitiveQueryKeys === "string" ? settings.sensitiveQueryKeys.slice(0, 2000) : "",
  };
}

function mergeDeliveryPreferencesPatch(current, patch) {
  if (!patch || typeof patch !== "object") return current;
  const captureDestination = "captureDestination" in patch
    ? parseCaptureDestinationPref(patch.captureDestination)
    : current.captureDestination;
  return {
    captureDestination: captureDestination === undefined ? current.captureDestination : captureDestination,
    copyOnFinishBatch: "copyOnFinishBatch" in patch
      ? (patch.copyOnFinishBatch === "off" || patch.copyOnFinishBatch === "link" || patch.copyOnFinishBatch === "prompt"
        ? patch.copyOnFinishBatch
        : current.copyOnFinishBatch)
      : current.copyOnFinishBatch,
    copyViewerContent: "copyViewerContent" in patch
      ? booleanPref(patch.copyViewerContent, current.copyViewerContent)
      : current.copyViewerContent,
    handoffMode: "handoffMode" in patch
      ? (patch.handoffMode === "full" || patch.handoffMode === "compact" ? patch.handoffMode : current.handoffMode)
      : current.handoffMode,
    includeScreenshot: "includeScreenshot" in patch
      ? booleanPref(patch.includeScreenshot, current.includeScreenshot)
      : current.includeScreenshot,
    includeViewer: "includeViewer" in patch
      ? booleanPref(patch.includeViewer, current.includeViewer)
      : current.includeViewer,
    language: "language" in patch
      ? (patch.language === null ? null : (SUPPORTED_PREF_LANGUAGES.has(patch.language) ? patch.language : current.language))
      : current.language,
    sensitiveQueryKeys: "sensitiveQueryKeys" in patch
      ? (typeof patch.sensitiveQueryKeys === "string" ? patch.sensitiveQueryKeys.slice(0, 2000) : current.sensitiveQueryKeys)
      : current.sensitiveQueryKeys,
  };
}

function deliveryPatchFromMessage(message) {
  const patch = {};
  if ("captureDestination" in message) {
    const destination = parseCaptureDestinationPref(message.captureDestination);
    if (destination !== undefined) patch.captureDestination = destination;
  }
  if ("copyOnFinishBatch" in message) {
    patch.copyOnFinishBatch = message.copyOnFinishBatch === "off" || message.copyOnFinishBatch === "link" || message.copyOnFinishBatch === "prompt"
      ? message.copyOnFinishBatch
      : "prompt";
  }
  if ("copyViewerContent" in message) patch.copyViewerContent = message.copyViewerContent === true;
  if ("handoffMode" in message) patch.handoffMode = message.handoffMode === "full" ? "full" : "compact";
  if ("includeScreenshot" in message) patch.includeScreenshot = message.includeScreenshot !== false;
  if ("includeViewer" in message) patch.includeViewer = message.includeViewer !== false;
  if ("language" in message) {
    patch.language = message.language === null
      ? null
      : (SUPPORTED_PREF_LANGUAGES.has(message.language) ? message.language : undefined);
    if (patch.language === undefined) delete patch.language;
  }
  if ("sensitiveQueryKeys" in message) {
    patch.sensitiveQueryKeys = typeof message.sensitiveQueryKeys === "string" ? message.sensitiveQueryKeys.slice(0, 2000) : "";
  }
  return patch;
}

async function preferencesFetch(settings, init = {}) {
  if (settings.storageMode === "cloud") {
    return remoteFetch(cloudEndpoint(settings), "/api/preferences", init);
  }
  const base = await findShotBase();
  if (!base) return null;
  return localFetch(base, "/api/preferences", init);
}

async function fetchDeliveryPreferences(settings) {
  try {
    const response = await preferencesFetch(settings);
    if (!response) return null;
    const body = await responseBody(response);
    if (!response.ok || typeof body.includeScreenshot !== "boolean") return null;
    return mergeDeliveryPreferencesPatch(localDeliveryPreferences(settings), body);
  } catch {
    return null;
  }
}

async function cacheDeliveryPreferences(preferences, settings) {
  const syncPatch = {
    copyOnFinishBatch: preferences.copyOnFinishBatch,
    copyViewerContent: preferences.copyViewerContent,
    handoffMode: preferences.handoffMode,
    includeScreenshot: preferences.includeScreenshot,
    includeViewer: preferences.includeViewer,
    sensitiveQueryKeys: preferences.sensitiveQueryKeys,
  };
  if (preferences.language) syncPatch.language = preferences.language;
  try {
    await chrome.storage.sync.set(syncPatch);
  } catch {
    /* ignore cache write */
  }
  if (!preferences.captureDestination) return;
  const resolved = settings || await getSettings();
  const localBase = resolved.storageMode === "cloud" ? "" : (await findShotBase() || "");
  await storeDestination(resolved, localBase, preferences.captureDestination);
}

async function getDeliveryPreferences() {
  const settings = await getSettings();
  const local = localDeliveryPreferences(settings);
  const remote = await fetchDeliveryPreferences(settings);
  if (!remote) return local;
  await cacheDeliveryPreferences(remote, settings);
  return remote;
}

async function setDeliveryPreferences(preferences) {
  const settings = await getSettings();
  const response = await preferencesFetch(settings, {
    body: JSON.stringify(preferences),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  if (!response) throw new Error("Local Pinar server is not running");
  const body = await responseBody(response);
  if (!response.ok || typeof body.includeScreenshot !== "boolean") {
    throw new Error(body.error || "Unable to save preferences");
  }
  const next = mergeDeliveryPreferencesPatch(localDeliveryPreferences(settings), body);
  await cacheDeliveryPreferences(next, settings);
  return next;
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
  const id = message.captureId || generateNanoId(12);
  const settings = await getSettings();
  const remotePrefs = await fetchDeliveryPreferences(settings);
  if (remotePrefs) await cacheDeliveryPreferences(remotePrefs, settings);
  const includeScreenshot = remotePrefs?.includeScreenshot ?? settings.includeScreenshot !== false;
  const includeViewer = remotePrefs?.includeViewer ?? settings.includeViewer !== false;
  const handoffMode = remotePrefs?.handoffMode ?? (settings.handoffMode === "full" ? "full" : "compact");
  const privacyApi = globalThis.__pinarPrivacy;
  if (!privacyApi) throw new Error("privacy sanitizer is unavailable");
  const extraQueryKeys = privacyApi.parseExtraKeys(remotePrefs?.sensitiveQueryKeys ?? settings.sensitiveQueryKeys);
  const sanitized = privacyApi.sanitizeCapture({
    fields: message.fields,
    page: message.page,
    pins: message.pins ?? [],
    unevaluated: message.privacy?.unevaluated === true,
    warnings: message.warnings,
  }, { extraQueryKeys });
  const pins = sanitized.pins;
  const page = sanitized.page;
  const privacy = sanitized.privacy;
  const warnings = [...(sanitized.warnings || [])];
  let savedResult = null;
  const activeBatch = await readBatch();
  const destination = await getCaptureDestinationContext(settings)
    .then((context) => context.destination)
    .catch(() => null);

  // History can only be declined for the remote server; local captures always persist on-device.
  const plan = planCapturePersistence({
    enableHistory: settings.enableHistory,
    hasShot: Boolean(message.shot),
    includeScreenshot,
    storageMode: settings.storageMode,
  });
  if (plan.persist) {
    savedResult = await saveShot(
      message.shot,
      id,
      page,
      pins,
      settings,
      destination?.collectionId,
      privacy,
      warnings,
      includeScreenshot,
      activeBatch,
    );
    if (!savedResult) warnings.push("helper_unavailable");
  } else if (plan.warnScreenshotMissing) {
    warnings.push("screenshot_missing");
  }
  if (activeBatch) {
    const updated = savedResult
      ? addCapture(activeBatch, { captureId: id, title: page?.title, url: page?.url })
      : markFailed(activeBatch, id, warnings.at(-1) || "not_saved");
    await writeBatch(updated);
    await syncBatchSurfaces();
  }

  const shot = includeScreenshot ? (savedResult?.path || message.shot || null) : null;
  const viewerUrl = (includeViewer && savedResult?.viewerUrl) ? savedResult.viewerUrl : null;
  if (plan.historyAllowed && includeViewer && !viewerUrl) warnings.push("viewer_unavailable");
  const uniqueWarnings = [...new Set(warnings)];
  const degraded = uniqueWarnings.some((warning) => (
    warning === "screenshot_missing" || warning === "helper_unavailable" || warning === "viewer_unavailable"
  ));

  const language = getBestLanguage(remotePrefs?.language ?? settings.language);
  const payload = formatClipboardPayload({
    captureId: id,
    createdAt: message.createdAt,
    handoffMode,
    includeScreenshot,
    messages: translations[language],
    page,
    pins,
    privacy,
    schemaVersion: message.schemaVersion || 1,
    shot,
    viewerUrl,
    viewport: message.viewport,
    warnings: uniqueWarnings,
  });

  try {
    await ensureOffscreen();
    const written = await chrome.runtime.sendMessage({
      html: payload.html,
      plain: payload.plain,
      type: "clipboard:write",
    });
    if (!written?.ok) throw new Error(written?.error || "clipboard write failed");
    return { degraded, ok: true, plain: payload.plain, warning: uniqueWarnings[0] || null, warnings: uniqueWarnings };
  } catch (error) {
    // Give the active page a final, user-gesture-compatible clipboard path.
    return { degraded, error: String(error), ok: false, plain: payload.plain, warning: uniqueWarnings[0] || null, warnings: uniqueWarnings };
  }
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

// Markdown is not HTML. Offering it as `text/html` would let a contenteditable
// composer pick that flavor, collapse the newlines and swallow anything shaped
// like a tag, so this path publishes `text/plain` alone.
async function notify(id, message, isError = false) {
  if (!chrome.notifications) return;
  await new Promise((resolve) => chrome.notifications.create(id, {
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    message,
    priority: isError ? 2 : 0,
    title: isError ? "Pinar · error" : "Pinar",
    type: "basic",
  }, () => { void chrome.runtime.lastError; resolve(); }));
}

async function writeClipboardPlain(text) {
  await ensureOffscreen();
  const written = await chrome.runtime.sendMessage({
    plain: text,
    type: "clipboard:write",
  });
  if (!written?.ok) throw new Error(written?.error || "clipboard write failed");
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
  return runInTopFrame(tabId, () => globalThis.__pinarCaptureMetrics?.());
}

async function prepareCapture(tabId, scrollY) {
  return runInTopFrame(
    tabId,
    (targetY) => globalThis.__pinarPrepareCapture?.(targetY),
    [scrollY],
  );
}

async function scrollCapture(tabId, scrollY) {
  return runInTopFrame(
    tabId,
    (targetY) => globalThis.__pinarScrollCapture?.(targetY),
    [scrollY],
  );
}

async function restoreCapture(tabId) {
  return runInTopFrame(tabId, () => globalThis.__pinarRestoreCapture?.());
}

function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function dataUrlBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

async function renderCaptureFrames(frames, pins, metrics, maskRegions = []) {
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

    const origin = { x: 0, y: captureStart };
    const shiftedPins = shiftPinsToCapture(pins, origin);
    const shiftedMasks = shiftMaskRegions(maskRegions, origin);
    const crop = await renderPinsCrop(canvas, shiftedPins, dpr, shiftedMasks);
    return { ok: true, shot: crop ? await blobToDataUrl(crop) : null };
  } finally {
    bitmaps.forEach((bitmap) => bitmap.close());
  }
}

async function captureTabBundle(tabId, windowId, pins, maskRegions = []) {
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
    return await renderCaptureFrames(frames, pins, metrics, maskRegions);
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

let localCapabilityCache = { base: "", token: "" };

async function getLocalCapability(base, forceRefresh = false) {
  if (!forceRefresh && localCapabilityCache.base === base && localCapabilityCache.token) {
    return localCapabilityCache.token;
  }
  const response = await fetch(`${base}/api/local/capability`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.token !== "string" || !body.token) {
    throw new Error("Local Pinar server is not running");
  }
  localCapabilityCache = { base, token: body.token };
  return body.token;
}

async function localFetch(base, path, init = {}) {
  const send = async (forceRefresh = false) => {
    const token = await getLocalCapability(base, forceRefresh);
    return fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        "x-pinar-capability": token,
      },
    });
  };
  let response = await send();
  if (response.status === 401) {
    localCapabilityCache = { base: "", token: "" };
    response = await send(true);
  }
  return response;
}

async function fetchHydratePayload(appOrigin, sessionId) {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}`;
  const response = isPinarHelperOrigin(appOrigin)
    ? await localFetch(appOrigin, path)
    : await remoteFetch(appOrigin, path);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.session) throw new Error(body.error || "Session not found");
  return {
    reviews: Array.isArray(body.reviews) ? body.reviews : [],
    session: body.session,
  };
}

async function notifyTabUnavailable(tabId, reason) {
  try {
    await chrome.scripting.executeScript({
      args: [reason || "unavailable"],
      func: (unavailableReason) => globalThis.__pinarShowUnavailable?.(unavailableReason),
      target: { allFrames: true, tabId },
    });
  } catch {
    /* Tab may already be gone or not injectable. */
  }
}

async function tabHasHydrate(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      func: () => typeof globalThis.__pinarHydrateSession === "function",
      target: { allFrames: false, tabId },
    });
    return results.some((entry) => entry?.result === true);
  } catch {
    return false;
  }
}

async function hydrateBoundTab(tabId, binding) {
  if (binding.hydrated) return { ok: true, tabId };
  const payload = {
    reviews: binding.payload.reviews,
    session: binding.payload.session,
    sessionId: binding.sessionId,
  };
  if (payload.session?.id !== binding.sessionId && payload.session?.captureId !== binding.sessionId) {
    return { ok: false, error: "session_mismatch" };
  }
  binding.hydrated = true;
  endTabPins(tabPins, tabId);
  if (!await tabHasHydrate(tabId)) {
    await chrome.scripting.executeScript({
      files: CONTENT_INJECTION_FILES,
      target: { allFrames: true, tabId },
    });
  }
  await chrome.scripting.executeScript({
    args: [payload],
    func: (hydratePayload) => globalThis.__pinarHydrateSession?.(hydratePayload),
    target: { allFrames: true, tabId },
  });
  return { ok: true, tabId };
}

async function reopenSavedSession(sessionId, sender) {
  const appUrl = sender?.url || "";
  const appOrigin = originOf(appUrl);
  const fetched = await fetchHydratePayload(appOrigin, sessionId);
  const plan = planSessionReopen({
    appUrl,
    requestedSessionId: sessionId,
    session: fetched.session,
  });
  if (!plan.ok) return plan;
  const tab = await chrome.tabs.create({ url: plan.pageUrl });
  if (tab.id == null) return { ok: false, error: "missing tab" };
  bindTabHydration(tabHydrations, tab.id, {
    hydrated: false,
    origin: plan.origin,
    pageUrl: plan.pageUrl,
    payload: fetched,
    sessionId: plan.sessionId,
  });
  return { ok: true, tabId: tab.id };
}

async function fetchDestinationTree(settings, localBase) {
  if (settings.storageMode === "cloud") {
    const endpoint = cloudEndpoint(settings);
    const response = await remoteFetch(endpoint, "/api/project-tree");
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.tree) throw new Error(body.error || "Remote destinations are unavailable");
    return body.tree;
  }
  if (!localBase) throw new Error("Local Pinar server is not running");
  const response = await localFetch(localBase, "/api/project-tree");
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.tree) throw new Error(body.error || "Local destinations are unavailable");
  return body.tree;
}

async function getCaptureDestinationContext(providedSettings) {
  const settings = providedSettings || await getSettings();
  const localBase = settings.storageMode === "cloud" ? "" : await findShotBase();
  const key = destinationKey(settings, localBase || "");
  // The server owns the destination; a choice made in the workspace dialog
  // must win over whatever this browser cached. Unreachable server: keep the
  // cache, same as every other preference.
  await getDeliveryPreferences().catch(() => null);
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
  try {
    await setDeliveryPreferences({ captureDestination: destination });
  } catch {
    /* Local destination already saved. */
  }
  return { ...context, destination };
}

function registerRemoteInstallation(endpoint, identity, force = false) {
  const cacheKey = `${endpoint}:${identity.id}`;
  return registerInstallationOnce(cacheKey, async () => {
    const [legalResponse, stored] = await Promise.all([
      fetch(`${endpoint}/api/legal/current`),
      chrome.storage.local.get({ remoteLegalAcceptance: null }),
    ]);
    const legalBundle = parseLegalBundle(await legalResponse.json().catch(() => null));
    const legalAcceptance = acceptedRemoteLegalAcceptance(stored.remoteLegalAcceptance, legalBundle);
    if (!legalResponse.ok || !legalBundle || !legalAcceptance) {
      throw new Error("Accept the current Pinar Terms in the extension settings before using remote storage");
    }
    if (!force && registeredInstallations.has(cacheKey)) return legalAcceptance;
    const response = await fetch(`${endpoint}/api/installations`, {
      body: JSON.stringify({ installationId: identity.id, installationToken: identity.token, legalAcceptance }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Remote installation registration failed");
    registeredInstallations.add(cacheKey);
    return legalAcceptance;
  });
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

async function resetToFreshInstallation(endpoint) {
  const replacement = createInstallationIdentity();
  await clearDeviceToken(chrome.storage.local);
  await replaceInstallationIdentity(chrome.storage.local, replacement);
  registeredInstallations.clear();
  await registerRemoteInstallation(endpoint, replacement, true);
  return replacement;
}

async function remoteFetch(endpoint, path, init = {}) {
  const deviceToken = await getDeviceToken(chrome.storage.local);
  if (deviceToken) {
    const response = await fetch(`${endpoint}${path}`, {
      ...init,
      headers: {
        ...deviceAuthHeaders(deviceToken),
        ...(init.headers || {}),
      },
    });
    if (response.status !== 401) return response;
    await resetToFreshInstallation(endpoint);
  }
  return installationFetch(endpoint, path, await initializeInstallationIdentity(), init);
}

async function responseBody(response) {
  return response.json().catch(() => ({}));
}

const BATCH_STORAGE_KEY = "captureBatch";

// Session storage, not memory: the service worker hibernates between captures.
async function readBatch() {
  const stored = await chrome.storage.session.get({ [BATCH_STORAGE_KEY]: null });
  return stored[BATCH_STORAGE_KEY] || null;
}

async function writeBatch(batch) {
  if (batch) await chrome.storage.session.set({ [BATCH_STORAGE_KEY]: batch });
  else await chrome.storage.session.remove(BATCH_STORAGE_KEY);
  return batch;
}

async function startBatch() {
  const settings = await getSettings();
  const language = getBestLanguage(settings.language);
  const startedAt = new Date();
  const when = new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" }).format(startedAt);
  const label = translations[language].batch_label.replace("{when}", when);
  const batch = await writeBatch(openBatch({
    id: crypto.randomUUID(),
    label,
    startedAt: startedAt.toISOString(),
  }));
  await syncBatchSurfaces();
  return batch;
}

async function finishBatch({ copy = true } = {}) {
  const batch = await readBatch();
  if (!batch) return { summary: null };
  const settings = await getSettings();
  const remotePrefs = await fetchDeliveryPreferences(settings);
  if (remotePrefs) await cacheDeliveryPreferences(remotePrefs, settings);
  const path = `/api/batches/${encodeURIComponent(batch.id)}/finish`;
  const init = {
    body: JSON.stringify({ finishedAt: new Date().toISOString() }),
    headers: { "content-type": "application/json" },
    method: "POST",
  };
  const helperBase = settings.storageMode === "cloud"
    ? cloudEndpoint(settings)
    : await findShotBase();
  // A missing server must not keep the batch open, but the user must hear
  // about it: the row stays open server-side until the next finish.
  let serverError = null;
  try {
    if (settings.storageMode === "cloud") {
      await remoteFetch(helperBase, path, init);
    } else if (helperBase) {
      await localFetch(helperBase, path, init);
    } else {
      serverError = new Error("helper unavailable");
    }
  } catch (error) {
    serverError = error;
  }
  await writeBatch(null);
  const summary = batchSummary(batch);
  // A batch row only exists once a capture landed in it, so an empty batch has
  // nothing to hand over and its bundle URL would legitimately 404.
  let copied = null;
  let copyError = null;
  if (copy && summary.saved > 0) {
    try {
      const result = await copyFinishedBatch({
        base: helperBase,
        batchId: batch.id,
        fetchText: async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`batch markdown ${response.status}`);
          return response.text();
        },
        mode: remotePrefs?.copyOnFinishBatch ?? settings.copyOnFinishBatch,
        writeClipboard: writeClipboardPlain,
      });
      copied = result.copied;
    } catch (error) {
      copyError = error;
      console.error("Unable to copy the finished batch", error);
    }
  }
  const language = getBestLanguage(remotePrefs?.language ?? settings.language);
  const messages = translations[language];
  const failed = Boolean(serverError || copyError);
  const toastKey = serverError ? "batch_finish_failed" : copyError ? "batch_copy_failed" : copy ? finishedBatchToastKey(copied) : "batch_closed";
  const toast = messages[toastKey].replace("{count}", String(summary.saved));
  await syncBatchSurfaces({ toast, toastKind: failed ? "error" : "ok" });
  // The overlay toast only exists on a tab with the toolbar open; the batch is
  // usually finished from the shortcut or the action menu, so the outcome also
  // goes out as a system notification - success and failure alike.
  await notify(`pinar-batch-${batch.id}`, toast, failed);
  return { copied, failed, summary, toast };
}

async function toggleBatch() {
  const batch = await readBatch();
  if (!batch) return startBatch();
  return finishBatch();
}

async function getAuthSession() {
  const settings = await getSettings();
  if (settings.storageMode !== "cloud") return { kind: "local", plan: "free" };
  const endpoint = cloudEndpoint(settings);
  const response = await remoteFetch(endpoint, "/api/auth/session");
  const body = await responseBody(response);
  if (!response.ok || !body.session) throw new Error(body.error || "Account session is unavailable");
  return body.session;
}

async function getStorageStatus() {
  const settings = await getSettings();
  if (settings.storageMode !== "cloud") {
    const base = await findShotBase();
    return { mode: "local", port: base ? new URL(base).port : null, reachable: Boolean(base) };
  }
  const response = await remoteFetch(cloudEndpoint(settings), "/api/account/entitlements");
  const body = await responseBody(response);
  const storage = body.storage || {};
  return {
    mode: "cloud",
    quotaBytes: Number(storage.quotaBytes || 0),
    reachable: response.ok,
    uploadAllowed: storage.uploadAllowed !== false,
    usedBytes: Number(storage.usedBytes || 0),
  };
}

async function createExtensionCodeForCurrentSession() {
  const settings = await getSettings();
  if (settings.storageMode !== "cloud") throw new Error("Temporary codes are only used by the remote server");
  const endpoint = cloudEndpoint(settings);
  const response = await remoteFetch(endpoint, "/api/auth/extension-codes", { method: "POST" });
  const body = await responseBody(response);
  if (!response.ok || !body.code) throw new Error(body.error || "Temporary code is unavailable");
  return { code: body.code, expiresAt: body.expiresAt };
}

async function requestAccountEmailCode(email) {
  const settings = await getSettings();
  const endpoint = cloudEndpoint(settings);
  const response = await fetch(`${endpoint}/api/auth/email-codes`, {
    body: JSON.stringify({ email }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = await responseBody(response);
  if (!response.ok) throw new Error(body.error || "Unable to request an email code");
}

async function verifyAccountEmailCode(email, code) {
  const settings = await getSettings();
  const endpoint = cloudEndpoint(settings);
  const identity = await initializeInstallationIdentity();
  const legalAcceptance = await registerRemoteInstallation(endpoint, identity);
  const response = await fetch(`${endpoint}/api/auth/email-codes/verify`, {
    body: JSON.stringify({
      code,
      email,
      installationId: identity.id,
      installationToken: identity.token,
      legalAcceptance,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = await responseBody(response);
  if (!response.ok || !body.device?.token || !body.session) {
    throw new Error(body.error || "The code is invalid or expired");
  }
  await storeDeviceToken(chrome.storage.local, body.device.token);
  registeredInstallations.clear();
  return body.session;
}

async function logoutAccount() {
  const settings = await getSettings();
  const endpoint = cloudEndpoint(settings);
  const token = await getDeviceToken(chrome.storage.local);
  if (token) {
    const response = await fetch(`${endpoint}/api/auth/logout`, {
      headers: deviceAuthHeaders(token),
      method: "POST",
    });
    if (!response.ok && response.status !== 401) {
      const body = await responseBody(response);
      throw new Error(body.error || "Unable to sign out");
    }
  }
  const identity = await resetToFreshInstallation(endpoint);
  return { installationId: identity.id, kind: "installation", plan: "free" };
}

async function openBillingPortal() {
  const settings = await getSettings();
  const endpoint = cloudEndpoint(settings);
  const response = await remoteFetch(endpoint, "/api/stripe/portal", { method: "POST" });
  const body = await responseBody(response);
  if (!response.ok || !body.url) throw new Error(body.error || "Billing portal is unavailable");
  await chrome.tabs.create({ url: body.url });
  return body.url;
}

async function openApp() {
  const settings = await getSettings();
  const withLanguage = (value) => {
    const url = new URL(value);
    if (settings.language) url.searchParams.set("lang", settings.language);
    return url.toString();
  };
  const base = settings.storageMode === "cloud" ? cloudEndpoint(settings) : await findShotBase();
  if (!base) throw new Error("Local Pinar server is not running");
  const url = withLanguage(`${base}/app`);
  await chrome.tabs.create({ url });
  return url;
}

async function saveShot(dataUrl, id, page = {}, pins = [], settings = {}, collectionId = "", privacy = null, warnings = [], includeScreenshot = true, batch = null) {
  const payload = {
    captureId: id,
    collectionId,
    id,
    image: dataUrl,
    includeScreenshot,
    page,
    pins,
    privacy,
    schemaVersion: 1,
    warnings,
  };
  if (batch) payload.batch = { id: batch.id, label: batch.label, startedAt: batch.startedAt };
  // 1. Cloudflare Worker mode
  if (settings.storageMode === "cloud") {
    const endpoint = cloudEndpoint(settings);
    try {
      const init = {
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
        method: "POST",
      };
      const response = await remoteFetch(endpoint, "/api/shots", init);
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
      const response = await localFetch(base, "/api/shots", {
        body: JSON.stringify(payload),
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
